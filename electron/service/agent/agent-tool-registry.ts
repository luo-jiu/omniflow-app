import Ajv, { type ValidateFunction } from 'ajv';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentMemoryItem,
  AgentMemoryProposal,
  AgentPerceptionSnapshot,
  AgentToolProgress,
  AgentToolResult,
  AgentToolRisk,
} from '@/shared/agent/agent.types';

const INVALID_TOOL_INPUT_MESSAGE = 'Agent Tool 参数不符合输入约束';
const INVALID_TOOL_SCHEMA_MESSAGE = 'Agent Tool 输入约束无效';
const MAX_INPUT_SCAN_DEPTH = 16;
const MAX_INPUT_SCAN_NODES = 4_096;
const MAX_SCHEMA_CLONE_DEPTH = 32;
const MAX_SCHEMA_CLONE_NODES = 10_000;
const UNSAFE_INPUT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface AgentToolExecutionContext {
  appContext: AgentAppContext;
  onProgress: (progress: AgentToolProgress) => void;
  perception?: AgentPerceptionSnapshot;
  requestInteraction?: (request: AgentInteractionRequest) => Promise<AgentInteractionResponse>;
  saveMemoryProposal?: (
    proposal: AgentMemoryProposal,
    signal: AbortSignal,
  ) => Promise<AgentMemoryItem>;
  signal: AbortSignal;
}

export type AgentToolExecutor = 'main' | 'renderer';

export type AgentToolValidation =
  | { ok: true }
  | { message: string; ok: false };

export type AgentToolPermissionDecision =
  | { behavior: 'allow'; risk: AgentToolRisk }
  | { behavior: 'ask'; preview: AgentActionPreview; risk: AgentToolRisk }
  | { behavior: 'deny'; message: string; risk: AgentToolRisk };

export interface AgentTool {
  readonly assess?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolPermissionDecision | Promise<AgentToolPermissionDecision>;
  readonly createRendererRequest?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => unknown;
  readonly description: string;
  readonly execute?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => Promise<AgentToolResult>;
  readonly executor?: AgentToolExecutor;
  readonly inputSchema: unknown;
  readonly name: string;
  readonly risk: AgentToolRisk;
  readonly timeoutMs?: number;
  readonly validate?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolValidation | Promise<AgentToolValidation>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function cloneSchemaValue(
  value: unknown,
  state: { active: WeakSet<object>; nodes: number },
  depth: number,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_CLONE_NODES || depth > MAX_SCHEMA_CLONE_DEPTH) {
    throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
  if (state.active.has(value)) throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
  state.active.add(value);

  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map(item => cloneSchemaValue(item, state, depth + 1)));
    }
    if (!isPlainObject(value)) throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_INPUT_KEYS.has(key)) throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
      clone[key] = cloneSchemaValue(item, state, depth + 1);
    }
    return Object.freeze(clone);
  } finally {
    state.active.delete(value);
  }
}

function cloneToolInputSchema(inputSchema: unknown): Readonly<Record<string, unknown>> {
  try {
    if (!isPlainObject(inputSchema) || inputSchema.type !== 'object') {
      throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
    }
    return cloneSchemaValue(inputSchema, {
      active: new WeakSet<object>(),
      nodes: 0,
    }, 0) as Readonly<Record<string, unknown>>;
  } catch {
    throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
  }
}

function createToolInputSchemaCompiler(): Ajv {
  return new Ajv({
    allErrors: false,
    coerceTypes: false,
    messages: false,
    ownProperties: true,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
    verbose: false,
  });
}

function compileToolInputSchema(compiler: Ajv, inputSchema: unknown): ValidateFunction {
  try {
    const validator = compiler.compile(inputSchema as object);
    if ((validator as ValidateFunction & { $async?: boolean }).$async) {
      throw new Error('async schemas are not supported');
    }
    return validator;
  } catch {
    throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
  }
}

function hasUnsafeInputStructure(input: unknown): boolean {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: input }];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    visited += 1;
    if (visited > MAX_INPUT_SCAN_NODES || current.depth > MAX_INPUT_SCAN_DEPTH) return true;
    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) return true;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      current.value.forEach(value => pending.push({ depth: current.depth + 1, value }));
      continue;
    }

    let prototype: object | null;
    let entries: Array<[string, unknown]>;
    try {
      prototype = Object.getPrototypeOf(current.value);
      entries = Object.entries(current.value);
    } catch {
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return true;
    for (const [key, value] of entries) {
      if (UNSAFE_INPUT_KEYS.has(key)) return true;
      pending.push({ depth: current.depth + 1, value });
    }
  }

  return false;
}

export function createAgentToolRegistry(initialTools: AgentTool[] = []) {
  const tools = new Map<string, AgentTool>();
  const inputValidators = new Map<string, ValidateFunction>();
  const inputSchemaCompiler = createToolInputSchemaCompiler();

  function register(tool: AgentTool): void {
    const name = String(tool.name || '').trim();
    if (!name) {
      throw new Error('Agent Tool 名称不能为空');
    }
    if (tools.has(name)) {
      throw new Error(`Agent Tool 已注册：${name}`);
    }
    if (name.startsWith('agent.')) {
      throw new Error(`Agent Tool 不能占用控制协议名称：${name}`);
    }
    const inputSchema = cloneToolInputSchema(tool.inputSchema);
    const validator = compileToolInputSchema(inputSchemaCompiler, inputSchema);
    tools.set(name, Object.freeze({ ...tool, inputSchema, name }));
    inputValidators.set(name, validator);
  }

  function get(name: string): AgentTool | null {
    return tools.get(String(name || '').trim()) || null;
  }

  function list(): AgentTool[] {
    return Array.from(tools.values());
  }

  function validateInput(name: string, input: unknown): AgentToolValidation {
    const normalizedName = String(name || '').trim();
    if (!tools.has(normalizedName)) {
      throw new Error(`Agent Tool 不存在：${normalizedName}`);
    }
    const validator = inputValidators.get(normalizedName);
    if (!validator) throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
    if (hasUnsafeInputStructure(input)) {
      return { message: INVALID_TOOL_INPUT_MESSAGE, ok: false };
    }
    try {
      return validator(input)
        ? { ok: true }
        : { message: INVALID_TOOL_INPUT_MESSAGE, ok: false };
    } catch {
      return { message: INVALID_TOOL_INPUT_MESSAGE, ok: false };
    }
  }

  async function execute(
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolResult> {
    const tool = get(name);
    if (!tool) {
      throw new Error(`Agent Tool 不存在：${String(name || '').trim()}`);
    }
    if (context.signal.aborted) {
      throw new Error('Agent Tool 执行已取消');
    }
    if ((tool.executor || 'main') !== 'main' || !tool.execute) {
      throw new Error(`Agent Tool 不能在主进程直接执行：${tool.name}`);
    }
    const validation = validateInput(tool.name, input);
    if (!validation.ok) throw new Error(validation.message);
    return tool.execute(input, context);
  }

  initialTools.forEach(register);

  return {
    execute,
    get,
    list,
    register,
    validateInput,
  };
}

export const agentToolRegistry = createAgentToolRegistry();

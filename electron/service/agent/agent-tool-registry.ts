import crypto from 'node:crypto';

import Ajv, { type ValidateFunction } from 'ajv';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentMemoryItem,
  AgentMemoryProposal,
  AgentPreparedActionPublic,
  AgentPerceptionSnapshot,
  AgentToolProgress,
  AgentToolResult,
  AgentToolRisk,
} from '@/shared/agent/agent.types';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './skills/agent-skill.types';
import type { AgentRunCapabilitySnapshot } from './agent-run-capability-snapshot';

const INVALID_TOOL_INPUT_MESSAGE = 'Agent Tool 参数不符合输入约束';
const INVALID_TOOL_SCHEMA_MESSAGE = 'Agent Tool 输入约束无效';
const MAX_INPUT_SCAN_DEPTH = 16;
const MAX_INPUT_SCAN_NODES = 4_096;
const MAX_SCHEMA_CLONE_DEPTH = 32;
const MAX_SCHEMA_CLONE_NODES = 10_000;
const MAX_TOOL_REGISTRATION_ID_LENGTH = 200;
const UNSAFE_INPUT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const INVALID_TOOL_REGISTRATION_ID_MESSAGE = 'Agent Tool registration identity 无效';
const DUPLICATE_TOOL_REGISTRATION_ID_MESSAGE = 'Agent Tool registration identity 已注册';
const STALE_TOOL_SNAPSHOT_MESSAGE = 'Agent Tool registration identity 不匹配';

export interface AgentToolExecutionContext {
  appContext: AgentAppContext;
  onProgress: (progress: AgentToolProgress) => void;
  perception?: AgentPerceptionSnapshot;
  /** Immutable Tool + Skill capabilities captured when the current Run started. */
  runCapabilitySnapshot?: AgentRunCapabilitySnapshot;
  /** Skill already active in this Run, if any. */
  activeSkillId?: string;
  requestInteraction?: (request: AgentInteractionRequest) => Promise<AgentInteractionResponse>;
  saveMemoryProposal?: (
    proposal: AgentMemoryProposal,
    signal: AbortSignal,
  ) => Promise<AgentMemoryItem>;
  signal: AbortSignal;
}

export type AgentToolExecutor = 'main' | 'renderer';

/** Closed classification used by Run capability snapshots. */
export type AgentToolKind = 'business' | 'control';

export interface AgentToolAvailabilityPolicy {
  readonly optionalCapabilities: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

export type AgentToolValidation =
  | { ok: true }
  | { message: string; ok: false };

export type AgentToolPermissionDecision =
  | { behavior: 'allow'; risk: AgentToolRisk }
  | { behavior: 'ask'; preview: AgentActionPreview; risk: AgentToolRisk }
  | { behavior: 'deny'; message: string; risk: AgentToolRisk };

export interface AgentToolPreparationResult {
  decision: AgentToolPermissionDecision;
  executionInput: unknown;
  publicAction: AgentPreparedActionPublic;
  /** Main-only material included in the approval hash and never persisted or projected. */
  snapshotMaterial?: unknown;
}

export interface AgentTool {
  readonly availability?: Partial<AgentToolAvailabilityPolicy>;
  readonly assess?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolPermissionDecision | Promise<AgentToolPermissionDecision>;
  readonly createRendererRequest?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => unknown;
  readonly createRendererPrepareRequest?: (
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
  /** Control Tools are application-owned protocol calls, never Skill-granted work. */
  readonly kind?: AgentToolKind;
  readonly name: string;
  readonly risk: AgentToolRisk;
  /**
   * Optional stable identity for this implementation. Built-in tools should
   * provide one when a future implementation replacement must be distinguishable
   * from the previous implementation. When omitted, the registry derives an
   * identity from the immutable public definition and schema.
   */
  readonly registrationId?: string;
  readonly finalizeRendererPreparation?: (
    input: unknown,
    rendererResult: unknown,
    requestedAction: AgentPreparedActionPublic | undefined,
    context: AgentToolExecutionContext,
  ) => AgentToolPreparationResult | Promise<AgentToolPreparationResult>;
  readonly timeoutMs?: number;
  readonly validate?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolValidation | Promise<AgentToolValidation>;
}

/** A registered Tool with an identity guaranteed by the registry. */
export type AgentToolSnapshot = AgentTool & {
  readonly availability: AgentToolAvailabilityPolicy;
  readonly kind: AgentToolKind;
  readonly registrationId: string;
};

export interface AgentToolSnapshotIdentity {
  readonly name: string;
  readonly registrationId: string;
}

/**
 * Immutable view of the Tool registry captured at one Run boundary.
 *
 * The callbacks intentionally close over the captured validator and Tool
 * objects. They must not consult the live registry after the snapshot is made.
 */
export interface AgentToolRegistrySnapshot {
  readonly revision: number;
  readonly tools: readonly AgentToolSnapshot[];
  readonly execute: (
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
    expectedRegistrationId?: string,
  ) => Promise<AgentToolResult>;
  readonly get: (name: string) => AgentToolSnapshot | null;
  readonly list: () => AgentToolSnapshot[];
  readonly validateInput: (
    name: string,
    input: unknown,
    expectedRegistrationId?: string,
  ) => AgentToolValidation;
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

const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const MAX_TOOL_CAPABILITIES = 32;
const MAX_CAPABILITY_ID_LENGTH = 128;

function normalizeCapabilityList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_TOOL_CAPABILITIES) {
    throw new Error(`Agent Tool ${label} 无效`);
  }
  const seen = new Set<string>();
  const normalized = value.map((item) => {
    const capabilityId = String(item || '').trim();
    if (
      !capabilityId
      || capabilityId.length > MAX_CAPABILITY_ID_LENGTH
      || !CAPABILITY_ID_PATTERN.test(capabilityId)
      || seen.has(capabilityId)
    ) {
      throw new Error(`Agent Tool ${label} 无效`);
    }
    seen.add(capabilityId);
    return capabilityId;
  });
  return Object.freeze(normalized);
}

function normalizeAvailabilityPolicy(
  input: AgentTool['availability'],
): AgentToolAvailabilityPolicy {
  if (input !== undefined && !isPlainObject(input)) {
    throw new Error('Agent Tool availability policy 无效');
  }
  const source = input || {};
  const unknownKey = Object.keys(source).find(key => (
    key !== 'optionalCapabilities' && key !== 'requiredCapabilities'
  ));
  if (unknownKey) throw new Error('Agent Tool availability policy 无效');
  const requiredCapabilities = normalizeCapabilityList(
    source.requiredCapabilities,
    'required Capability',
  );
  const optionalCapabilities = normalizeCapabilityList(
    source.optionalCapabilities,
    'optional Capability',
  );
  const requiredSet = new Set(requiredCapabilities);
  if (optionalCapabilities.some(capabilityId => requiredSet.has(capabilityId))) {
    throw new Error('Agent Tool required / optional Capability 不能重复');
  }
  return Object.freeze({ optionalCapabilities, requiredCapabilities });
}

/**
 * Serialize the JSON-shaped Tool schema in a key-order-independent way. Ajv
 * receives the original insertion order, but registration identity should not
 * change merely because a caller constructed equivalent object literals in a
 * different order.
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(INVALID_TOOL_REGISTRATION_ID_MESSAGE);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  }
  if (!isPlainObject(value)) throw new Error(INVALID_TOOL_REGISTRATION_ID_MESSAGE);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function normalizeRegistrationId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (
    !normalized
    || normalized.length > MAX_TOOL_REGISTRATION_ID_LENGTH
    || Array.from(normalized).some(character => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(INVALID_TOOL_REGISTRATION_ID_MESSAGE);
  }
  return normalized;
}

function deriveRegistrationId(input: {
  availability: AgentToolAvailabilityPolicy;
  description: string;
  executor: AgentToolExecutor;
  inputSchema: Readonly<Record<string, unknown>>;
  kind: AgentToolKind;
  name: string;
  risk: AgentToolRisk;
  timeoutMs?: number;
  usesRendererPreparation: boolean;
  explicitRegistrationId?: unknown;
}): string {
  const explicit = normalizeRegistrationId(input.explicitRegistrationId);
  if (explicit) return explicit;
  const fingerprint = crypto.createHash('sha256').update(stableSerialize({
    schemaVersion: 1,
    availability: input.availability,
    description: input.description,
    executor: input.executor,
    inputSchema: input.inputSchema,
    kind: input.kind,
    name: input.name,
    risk: input.risk,
    timeoutMs: input.timeoutMs ?? null,
    usesRendererPreparation: input.usesRendererPreparation,
  })).digest('hex');
  return `derived:${fingerprint}`;
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
  const tools = new Map<string, AgentToolSnapshot>();
  const registrationIds = new Map<string, string>();
  const inputValidators = new Map<string, ValidateFunction>();
  const inputSchemaCompiler = createToolInputSchemaCompiler();
  let revision = 0;

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
    const kind = tool.kind || 'business';
    if (kind !== 'business' && kind !== 'control') {
      throw new Error(`Agent Tool 分类无效：${name}`);
    }
    if (name === AGENT_SKILL_ACTIVATE_TOOL_NAME && kind !== 'control') {
      throw new Error(`Agent Tool 不能以业务分类占用控制协议名称：${name}`);
    }
    if (kind === 'control' && (
      name !== AGENT_SKILL_ACTIVATE_TOOL_NAME
      || tool.registrationId !== AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID
      || (tool.executor || 'main') !== 'main'
      || tool.risk !== 'read'
    )) {
      throw new Error(`Agent Tool 不能注册未声明的控制能力：${name}`);
    }
    const availability = normalizeAvailabilityPolicy(tool.availability);
    if (
      kind === 'control'
      && (availability.requiredCapabilities.length > 0
        || availability.optionalCapabilities.length > 0)
    ) {
      throw new Error(`Agent 控制 Tool 不能声明业务 Capability：${name}`);
    }
    const inputSchema = cloneToolInputSchema(tool.inputSchema);
    const hasPrepareRequest = typeof tool.createRendererPrepareRequest === 'function';
    const hasPrepareFinalizer = typeof tool.finalizeRendererPreparation === 'function';
    if (hasPrepareRequest !== hasPrepareFinalizer) {
      throw new Error(`Agent Tool prepare 契约不完整：${name}`);
    }
    if (hasPrepareRequest && (tool.executor || 'main') !== 'renderer') {
      throw new Error(`Agent Tool prepare 只支持 Renderer executor：${name}`);
    }
    if (hasPrepareRequest && typeof tool.createRendererRequest === 'function') {
      throw new Error(`Agent Tool prepare 与旧 Renderer request 契约不能并存：${name}`);
    }
    const validator = compileToolInputSchema(inputSchemaCompiler, inputSchema);
    const registrationId = deriveRegistrationId({
      availability,
      description: String(tool.description || '').trim(),
      executor: tool.executor || 'main',
      explicitRegistrationId: tool.registrationId,
      inputSchema,
      kind,
      name,
      risk: tool.risk,
      timeoutMs: tool.timeoutMs,
      usesRendererPreparation: hasPrepareRequest,
    });
    const existingName = registrationIds.get(registrationId);
    if (existingName && existingName !== name) {
      throw new Error(`${DUPLICATE_TOOL_REGISTRATION_ID_MESSAGE}：${registrationId}`);
    }
    tools.set(name, Object.freeze({
      ...tool,
      availability,
      inputSchema,
      kind,
      name,
      registrationId,
    }));
    inputValidators.set(name, validator);
    registrationIds.set(registrationId, name);
    revision += 1;
  }

  function get(name: string): AgentToolSnapshot | null {
    return tools.get(String(name || '').trim()) || null;
  }

  function list(): AgentToolSnapshot[] {
    return Array.from(tools.values());
  }

  function validateInputFromMaps(
    toolMap: ReadonlyMap<string, AgentToolSnapshot>,
    validatorMap: ReadonlyMap<string, ValidateFunction>,
    name: string,
    input: unknown,
    expectedRegistrationId?: string,
  ): AgentToolValidation {
    const normalizedName = String(name || '').trim();
    const tool = toolMap.get(normalizedName);
    if (!tool) {
      throw new Error(`Agent Tool 不存在：${normalizedName}`);
    }
    if (
      expectedRegistrationId !== undefined
      && tool.registrationId !== String(expectedRegistrationId || '').trim()
    ) {
      throw new Error(STALE_TOOL_SNAPSHOT_MESSAGE);
    }
    const validator = validatorMap.get(normalizedName);
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

  function validateInput(
    name: string,
    input: unknown,
    expectedRegistrationId?: string,
  ): AgentToolValidation {
    return validateInputFromMaps(
      tools,
      inputValidators,
      name,
      input,
      expectedRegistrationId,
    );
  }

  async function executeFromMaps(
    toolMap: ReadonlyMap<string, AgentToolSnapshot>,
    validatorMap: ReadonlyMap<string, ValidateFunction>,
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
    expectedRegistrationId?: string,
  ): Promise<AgentToolResult> {
    const normalizedName = String(name || '').trim();
    const tool = toolMap.get(normalizedName);
    if (!tool) {
      throw new Error(`Agent Tool 不存在：${normalizedName}`);
    }
    if (context.signal.aborted) {
      throw new Error('Agent Tool 执行已取消');
    }
    if (
      expectedRegistrationId !== undefined
      && tool.registrationId !== String(expectedRegistrationId || '').trim()
    ) {
      throw new Error(STALE_TOOL_SNAPSHOT_MESSAGE);
    }
    if ((tool.executor || 'main') !== 'main' || !tool.execute) {
      throw new Error(`Agent Tool 不能在主进程直接执行：${tool.name}`);
    }
    const validation = validateInputFromMaps(
      toolMap,
      validatorMap,
      tool.name,
      input,
      expectedRegistrationId,
    );
    if (!validation.ok) throw new Error(validation.message);
    return tool.execute(input, context);
  }

  async function execute(
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
    expectedRegistrationId?: string,
  ): Promise<AgentToolResult> {
    return executeFromMaps(
      tools,
      inputValidators,
      name,
      input,
      context,
      expectedRegistrationId,
    );
  }

  function listSnapshot(): readonly AgentToolSnapshot[] {
    return Object.freeze(Array.from(tools.values()));
  }

  function getSnapshot(name: string): AgentToolSnapshot | null {
    return tools.get(String(name || '').trim()) || null;
  }

  function createSnapshot(): AgentToolRegistrySnapshot {
    const snapshotTools = listSnapshot();
    const snapshotToolMap = new Map<string, AgentToolSnapshot>(
      snapshotTools.map(tool => [tool.name, tool]),
    );
    const snapshotValidatorMap = new Map<string, ValidateFunction>(
      snapshotTools.map((tool) => {
        const validator = inputValidators.get(tool.name);
        if (!validator) throw new Error(INVALID_TOOL_SCHEMA_MESSAGE);
        return [tool.name, validator];
      }),
    );
    const snapshot: AgentToolRegistrySnapshot = {
      execute: (name, input, context, expectedRegistrationId) => executeFromMaps(
        snapshotToolMap,
        snapshotValidatorMap,
        name,
        input,
        context,
        expectedRegistrationId,
      ),
      get: (name) => snapshotToolMap.get(String(name || '').trim()) || null,
      list: () => Array.from(snapshotTools),
      revision,
      tools: snapshotTools,
      validateInput: (name, input, expectedRegistrationId) => validateInputFromMaps(
        snapshotToolMap,
        snapshotValidatorMap,
        name,
        input,
        expectedRegistrationId,
      ),
    };
    return Object.freeze(snapshot);
  }

  function validateInputAgainstSnapshot(
    snapshot: AgentToolRegistrySnapshot,
    name: string,
    input: unknown,
    expectedRegistrationId?: string,
  ): AgentToolValidation {
    if (!snapshot || typeof snapshot.validateInput !== 'function') {
      throw new Error(STALE_TOOL_SNAPSHOT_MESSAGE);
    }
    return snapshot.validateInput(name, input, expectedRegistrationId);
  }

  async function executeAgainstSnapshot(
    snapshot: AgentToolRegistrySnapshot,
    name: string,
    input: unknown,
    context: AgentToolExecutionContext,
    expectedRegistrationId?: string,
  ): Promise<AgentToolResult> {
    if (!snapshot || typeof snapshot.execute !== 'function') {
      throw new Error(STALE_TOOL_SNAPSHOT_MESSAGE);
    }
    return snapshot.execute(name, input, context, expectedRegistrationId);
  }

  initialTools.forEach(register);

  return {
    createSnapshot,
    execute,
    executeAgainstSnapshot,
    get,
    getSnapshot,
    list,
    listSnapshot,
    register,
    validateInput,
    validateInputAgainstSnapshot,
  };
}

export const agentToolRegistry = createAgentToolRegistry();

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentPerceptionSnapshot,
  AgentToolProgress,
  AgentToolResult,
  AgentToolRisk,
} from '@/shared/agent/agent.types';

export interface AgentToolExecutionContext {
  appContext: AgentAppContext;
  onProgress: (progress: AgentToolProgress) => void;
  perception?: AgentPerceptionSnapshot;
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
  assess?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolPermissionDecision | Promise<AgentToolPermissionDecision>;
  createRendererRequest?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => unknown;
  description: string;
  execute?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => Promise<AgentToolResult>;
  executor?: AgentToolExecutor;
  inputSchema: unknown;
  name: string;
  risk: AgentToolRisk;
  timeoutMs?: number;
  validate?: (
    input: unknown,
    context: AgentToolExecutionContext,
  ) => AgentToolValidation | Promise<AgentToolValidation>;
}

export function createAgentToolRegistry(initialTools: AgentTool[] = []) {
  const tools = new Map<string, AgentTool>();

  function register(tool: AgentTool): void {
    const name = String(tool.name || '').trim();
    if (!name) {
      throw new Error('Agent Tool 名称不能为空');
    }
    if (tools.has(name)) {
      throw new Error(`Agent Tool 已注册：${name}`);
    }
    tools.set(name, { ...tool, name });
  }

  function get(name: string): AgentTool | null {
    return tools.get(String(name || '').trim()) || null;
  }

  function list(): AgentTool[] {
    return Array.from(tools.values());
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
    return tool.execute(input, context);
  }

  initialTools.forEach(register);

  return {
    execute,
    get,
    list,
    register,
  };
}

export const agentToolRegistry = createAgentToolRegistry();

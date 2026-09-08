import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolPermissionDecision,
} from './agent-tool-registry';
import type { AgentPreparedActionPublic } from '@/shared/agent/agent.types';
import type { AgentShellPermissionMode } from '@/shared/agent/shell/agent-shell.types';

/** Apply the frozen Run mode only to known, validated, non-destructive built-ins. */
export function resolveAgentRunPermissionDecision(
  toolName: string,
  decision: AgentToolPermissionDecision,
  mode: AgentShellPermissionMode | undefined,
  action?: AgentPreparedActionPublic,
): AgentToolPermissionDecision {
  if (mode !== 'full-access' || decision.behavior !== 'ask' || decision.risk !== 'write') return decision;
  if (toolName === 'directory.create' && !action) return { behavior: 'allow', risk: 'write' };
  if (!action || action.kind !== toolName) return decision;
  if (action.kind === 'media.extractAudio' && action.conflictPolicy !== 'replace') {
    return { behavior: 'allow', risk: 'write' };
  }
  if (action.kind === 'file.stage' || action.kind === 'file.publish' || action.kind === 'file.upload') {
    return { behavior: 'allow', risk: 'write' };
  }
  return decision;
}

export async function assessAgentToolPermission(
  tool: AgentTool,
  input: unknown,
  context: AgentToolExecutionContext,
): Promise<AgentToolPermissionDecision> {
  const validation = await tool.validate?.(input, context);
  if (validation && !validation.ok) {
    return {
      behavior: 'deny',
      message: validation.message,
      risk: tool.risk,
    };
  }

  if (tool.assess) {
    return tool.assess(input, context);
  }

  if (tool.risk === 'read' && (tool.executor || 'main') === 'main') {
    return { behavior: 'allow', risk: 'read' };
  }

  return {
    behavior: 'deny',
    message: `工具 ${tool.name} 尚未配置受控执行策略`,
    risk: tool.risk,
  };
}

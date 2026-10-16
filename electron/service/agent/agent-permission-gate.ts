import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolPermissionDecision,
  AgentToolSnapshot,
} from './agent-tool-registry';
import type { AgentPreparedActionPublic } from '@/shared/agent/agent.types';
import type { AgentShellPermissionMode } from '@/shared/agent/shell/agent-shell.types';
import { isAgentRendererMutationTool } from '../../../src/shared/agent/agent-library-actions';

const BUILTIN_COMPUTER_TOOL_RISKS = new Map<string, 'read' | 'write'>([
  ['computer.windows', 'read'],
  ['computer.observe', 'read'],
  ['computer.click', 'write'],
  ['computer.setText', 'write'],
  ['computer.scroll', 'write'],
  ['computer.input', 'write'],
  ['computer.menu', 'write'],
]);

function isBuiltinPreparedComputerTool(
  toolName: string,
  action: AgentPreparedActionPublic | undefined,
  tool: AgentToolSnapshot | undefined,
): tool is AgentToolSnapshot {
  const risk = BUILTIN_COMPUTER_TOOL_RISKS.get(toolName);
  if (!risk || !action || action.kind !== toolName || !tool
    || tool.name !== toolName || tool.registrationId !== `builtin:${toolName}@1`
    || tool.executor !== 'main' || tool.kind !== 'business' || tool.risk !== risk
    || tool.preparedRisk || tool.pluginSource || tool.pluginOperation
    || typeof tool.prepareMain !== 'function' || typeof tool.execute !== 'function') return false;
  // Historical display-wide actions never inherit the current single-window grant.
  if (action.kind === 'computer.observe') return action.version === 2;
  if (action.kind === 'computer.click') return action.version === 2 || action.version === 3;
  return true;
}

/** Apply the frozen Run mode to known writes and trusted prepared single-window computer tools. */
export function resolveAgentRunPermissionDecision(
  toolName: string,
  decision: AgentToolPermissionDecision,
  mode: AgentShellPermissionMode | undefined,
  action?: AgentPreparedActionPublic,
  tool?: AgentToolSnapshot,
): AgentToolPermissionDecision {
  if (mode !== 'full-access' || decision.behavior !== 'ask') return decision;
  if (isBuiltinPreparedComputerTool(toolName, action, tool) && decision.risk === tool.risk) {
    return { behavior: 'allow', risk: decision.risk };
  }
  if (decision.risk !== 'write') return decision;
  if (isAgentRendererMutationTool(toolName) && !action) return { behavior: 'allow', risk: 'write' };
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

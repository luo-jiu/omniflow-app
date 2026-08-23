import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolPermissionDecision,
} from './agent-tool-registry';

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

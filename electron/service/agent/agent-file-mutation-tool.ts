import type { AgentTool } from './agent-tool-registry';

/** Keep capability grants identical in the orchestrator and Broker, including frozen older Runs. */
export function isAgentBuiltinFileMutationTool(tool: AgentTool | null | undefined, name: string): boolean {
  return tool?.name === name && tool.executor === 'main' && tool.kind === 'business' && tool.risk === 'write'
    && !tool.pluginSource && !tool.pluginOperation
    && (name === 'file.write' && tool.registrationId === 'builtin:file.write@2'
      || name === 'file.patch' && (tool.registrationId === 'builtin:file.patch@1' || tool.registrationId === 'builtin:file.patch@2'));
}

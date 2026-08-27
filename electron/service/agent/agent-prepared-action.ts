import type { AgentPreparedActionPublic } from '../../../src/shared/agent/agent.types';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import { AGENT_SHELL_RUN_TOOL_NAME } from '../../../src/shared/agent/shell/agent-shell.types';
import { validateAgentShellPreparedActionCommandHashV1 } from './shell/agent-shell-prepared-action';

/** Main-owned canonical boundary for prepared actions that carry private integrity semantics. */
export function normalizeAgentPreparedActionPublicForMain(
  input: unknown,
): AgentPreparedActionPublic {
  const normalized = normalizeAgentPreparedActionPublic(input);
  if (normalized.kind === AGENT_SHELL_RUN_TOOL_NAME) {
    return validateAgentShellPreparedActionCommandHashV1(normalized);
  }
  return normalized;
}

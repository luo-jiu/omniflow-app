import { agentToolRegistry } from '../agent-tool-registry';
import { estimateAgentTextTokens } from '../agent-context-projection';
import { createAgentSkillRegistry } from './agent-skill-registry';
import { getBuiltInAgentSkills } from './agent-skill-catalog';
import { getBuiltInSkillControlTools } from './skill-activate-tool';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './agent-skill.types';

// These built-ins register only after the host Provider is ready. Declaring
// them as optional does not make them executable in a Run without a Tool snapshot.
const DEFERRED_HOST_TOOLS = new Set(['shell.run', 'file.stage', 'file.publish', 'file.upload']);

/**
 * Application-owned Skill registry.  Definitions are registered only after
 * the orchestrator has registered the built-in Tools, so their allowlists are
 * checked against the same Tool registry used by execution.
 */
export const builtInAgentSkillRegistry = createAgentSkillRegistry({
  estimateTokens: estimateAgentTextTokens,
  maxActivationTokens: 10_000,
  toolExists: toolName => {
    const tool = agentToolRegistry.get(toolName);
    return tool ? tool.kind === 'business' : DEFERRED_HOST_TOOLS.has(toolName);
  },
});

let initialized = false;

export function ensureBuiltInAgentCapabilities(): void {
  if (initialized) return;
  getBuiltInSkillControlTools().forEach((tool) => {
    const existing = agentToolRegistry.get(tool.name);
    if (!existing) {
      agentToolRegistry.register(tool);
      return;
    }
    if (
      existing.name !== AGENT_SKILL_ACTIVATE_TOOL_NAME
      || existing.kind !== 'control'
      || existing.registrationId !== AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID
    ) {
      throw new Error('Agent Skill 控制 Tool 注册身份不匹配');
    }
  });
  getBuiltInAgentSkills().forEach((skill) => {
    if (!builtInAgentSkillRegistry.get(skill.id)) builtInAgentSkillRegistry.register(skill);
  });
  initialized = true;
}

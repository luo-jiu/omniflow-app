import { agentToolRegistry } from '../agent-tool-registry';
import { estimateAgentTextTokens } from '../agent-context-projection';
import { createAgentSkillRegistry } from './agent-skill-registry';
import { getBuiltInAgentSkills } from './agent-skill-catalog';
import { getBuiltInSkillControlTools } from './skill-activate-tool';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './agent-skill.types';

/**
 * Application-owned Skill registry.  Definitions are registered only after
 * the orchestrator has registered the built-in Tools, so their allowlists are
 * checked against the same Tool registry used by execution.
 */
export const builtInAgentSkillRegistry = createAgentSkillRegistry({
  estimateTokens: estimateAgentTextTokens,
  toolExists: toolName => agentToolRegistry.get(toolName)?.kind === 'business',
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

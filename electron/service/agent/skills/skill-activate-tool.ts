import type { AgentToolResult } from '@/shared/agent/agent.types';
import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
} from './agent-skill.types';

export { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './agent-skill.types';

const MAX_SKILL_ID_LENGTH = 128;
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export type AgentSkillActivationExecutionContext = Pick<
  AgentToolExecutionContext,
  'activeSkillId' | 'runCapabilitySnapshot'
>;

function normalizedSkillId(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>).skillId;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || [...normalized].length > MAX_SKILL_ID_LENGTH
    || !SKILL_ID_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

/**
 * Resolve the deterministic activation result without executing any Tool or
 * consulting a live registry. The orchestrator may use this exact result for
 * its pre-side-effect provider-budget check.
 */
export function resolveAgentSkillActivationResult(
  input: unknown,
  context: AgentSkillActivationExecutionContext,
): AgentToolResult {
  const skillId = normalizedSkillId(input);
  if (!skillId) return { message: 'Skill ID 无效', ok: false as const };
  if (context.activeSkillId && context.activeSkillId !== skillId) {
    return { message: '当前 Run 已激活另一个 Skill，请为新的流程新建 Run', ok: false as const };
  }
  const snapshot = context.runCapabilitySnapshot?.skillSnapshot;
  if (!snapshot) {
    return { message: '当前 Agent 运行未提供 Skill 快照', ok: false as const };
  }
  // A Skill that was omitted from the initial summary catalog is not
  // discoverable by guessing its ID, even when it exists in another source.
  if (!snapshot.getSummary(skillId)) {
    return { message: `当前运行不可激活 Skill：${skillId}`, ok: false as const };
  }
  const envelope = snapshot.getActivationEnvelope(skillId);
  if (!envelope) {
    return { message: `当前运行不可激活 Skill：${skillId}`, ok: false as const };
  }
  return {
    data: envelope,
    message: `已加载 Skill ${envelope.skillId}（${envelope.version}）`,
    ok: true,
  };
}

/**
 * Fixed, read-only control Tool used for progressive Skill disclosure.
 * `kind` is intentionally an explicit closed classification; the registry
 * owns and freezes it when the Tool is registered.
 */
export const skillActivateTool: AgentTool & { readonly kind: 'control' } = {
  assess() {
    return { behavior: 'allow', risk: 'read' };
  },
  description: '加载当前运行中可见的内置 Skill 流程说明。只接受 Skill ID，不读取路径、URL 或模型提供的正文。',
  execute(input, context) {
    return Promise.resolve(resolveAgentSkillActivationResult(input, context));
  },
  executor: 'main',
  inputSchema: {
    additionalProperties: false,
    properties: {
      skillId: {
        maxLength: MAX_SKILL_ID_LENGTH,
        minLength: 1,
        pattern: '^[a-z0-9]+(?:[._-][a-z0-9]+)*$',
        type: 'string',
      },
    },
    required: ['skillId'],
    type: 'object',
  },
  kind: 'control',
  name: AGENT_SKILL_ACTIVATE_TOOL_NAME,
  registrationId: AGENT_SKILL_ACTIVATE_TOOL_REGISTRATION_ID,
  risk: 'read',
  validate(input) {
    return normalizedSkillId(input)
      ? { ok: true }
      : { message: 'Skill ID 无效', ok: false };
  },
};

export function getBuiltInSkillControlTools(): Array<AgentTool & { readonly kind: 'control' }> {
  return [skillActivateTool];
}

import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import type {
  AgentSkillSnapshotV1,
} from './agent-skill.types';
import { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './agent-skill.types';

export { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './agent-skill.types';

const MAX_SKILL_ID_LENGTH = 128;
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

type SkillActivationExecutionContext = AgentToolExecutionContext & {
  /** Frozen at Run start; the Tool must never consult the live registry. */
  readonly skillSnapshot?: AgentSkillSnapshotV1;
};

function normalizedSkillId(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>).skillId;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || [...normalized].length > MAX_SKILL_ID_LENGTH
    || !SKILL_ID_PATTERN.test(normalized)
  ) return null;
  return normalized;
}

function getActivationEnvelope(
  input: unknown,
  context: SkillActivationExecutionContext,
) {
  const skillId = normalizedSkillId(input);
  if (!skillId) return { message: 'Skill ID 无效', ok: false as const };
  const snapshot = context.skillSnapshot;
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
  return { envelope, ok: true as const };
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
  execute(input, rawContext) {
    const result = getActivationEnvelope(
      input,
      rawContext as SkillActivationExecutionContext,
    );
    if (!result.ok) return Promise.resolve(result);
    return Promise.resolve({
      data: result.envelope,
      message: `已加载 Skill ${result.envelope.skillId}（${result.envelope.version}）`,
      ok: true,
    });
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
  registrationId: 'builtin:skill.activate@1',
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

import type {
  AgentChatStreamEvent,
  AgentSessionSnapshot,
  AgentToolActivitySnapshot,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './skills/agent-skill.types';

function compactSkillActivationResult(result: AgentToolResult): AgentToolResult {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return {
      ...(result.message ? { message: result.message } : {}),
      ok: result.ok,
    };
  }
  const source = result.data as Record<string, unknown>;
  const skillId = String(source.skillId || '').trim().slice(0, 128);
  const version = String(source.version || '').trim().slice(0, 64);
  const instructionsHash = String(source.instructionsHash || '').trim();
  const hasCanonicalIdentity = Boolean(
    skillId
    && version
    && /^[a-f0-9]{64}$/u.test(instructionsHash),
  );
  return {
    ...(hasCanonicalIdentity
      ? { data: { instructionsHash, skillId, version } }
      : {}),
    ...(result.message ? { message: result.message } : {}),
    ok: result.ok,
  };
}

export function projectAgentToolActivityForRenderer(
  activity: AgentToolActivitySnapshot,
): AgentToolActivitySnapshot {
  if (activity.call.name !== AGENT_SKILL_ACTIVATE_TOOL_NAME || !activity.result) return activity;
  return {
    ...activity,
    result: compactSkillActivationResult(activity.result),
  };
}

export function projectAgentSessionForRenderer(
  session: AgentSessionSnapshot,
): AgentSessionSnapshot {
  return {
    ...session,
    toolActivities: session.toolActivities.map(projectAgentToolActivityForRenderer),
  };
}

export function projectAgentChatStreamEventForRenderer(
  event: AgentChatStreamEvent,
): AgentChatStreamEvent {
  const source = event as AgentChatStreamEvent & {
    activity?: AgentToolActivitySnapshot;
    call?: { name?: string };
    result?: AgentToolResult;
    toolActivities?: AgentToolActivitySnapshot[];
  };
  const projectedActivity = source.activity
    ? projectAgentToolActivityForRenderer(source.activity)
    : undefined;
  const skillCall = source.call?.name === AGENT_SKILL_ACTIVATE_TOOL_NAME
    || source.activity?.call.name === AGENT_SKILL_ACTIVATE_TOOL_NAME;
  return {
    ...event,
    ...(projectedActivity ? { activity: projectedActivity } : {}),
    ...(source.result && skillCall
      ? { result: compactSkillActivationResult(source.result) }
      : {}),
    ...(source.toolActivities
      ? { toolActivities: source.toolActivities.map(projectAgentToolActivityForRenderer) }
      : {}),
  } as AgentChatStreamEvent;
}

import type {
  AgentChatStreamEvent,
  AgentSessionSnapshot,
  AgentToolActivitySnapshot,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './skills/agent-skill.types';
import { AGENT_SHELL_RUN_TOOL_NAME } from '../../../src/shared/agent/shell/agent-shell.types';
import {
  agentToolRegistry,
  type AgentToolSnapshot,
} from './agent-tool-registry';

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

function compactShellResult(result: AgentToolResult): AgentToolResult {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return {
      ...(result.message ? { message: result.message } : {}),
      ok: result.ok,
    };
  }
  const rendererData = { ...result.data } as Record<string, unknown>;
  delete rendererData.executionId;
  delete rendererData.logRef;
  delete rendererData.providerOutput;
  return {
    data: rendererData,
    ...(result.message ? { message: result.message } : {}),
    ok: result.ok,
  };
}

export function projectAgentToolActivityForRenderer(
  activity: AgentToolActivitySnapshot,
  resolveTool: (name: string) => AgentToolSnapshot | null = name => agentToolRegistry.get(name),
): AgentToolActivitySnapshot {
  const tool = resolveTool(activity.call.name);
  const toolMetadata = tool
    ? {
        kind: tool.kind,
        ...(tool.presentation ? {
          groupKind: tool.presentation.groupKind,
          operationKind: tool.presentation.operationKind,
        } : {}),
        risk: tool.risk,
      } as const
    : undefined;
  const projectedActivity = toolMetadata
    ? { ...activity, toolMetadata }
    : activity.toolMetadata
      ? { ...activity, toolMetadata: undefined }
      : activity;
  if (!activity.result) return projectedActivity;
  if (activity.call.name === AGENT_SHELL_RUN_TOOL_NAME) {
    return {
      ...projectedActivity,
      result: compactShellResult(activity.result),
    };
  }
  if (activity.call.name !== AGENT_SKILL_ACTIVATE_TOOL_NAME) return projectedActivity;
  return {
    ...projectedActivity,
    result: compactSkillActivationResult(activity.result),
  };
}

export function projectAgentSessionForRenderer(
  session: AgentSessionSnapshot,
): AgentSessionSnapshot {
  return {
    ...session,
    toolActivities: session.toolActivities.map(
      activity => projectAgentToolActivityForRenderer(activity),
    ),
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
  const shellCall = source.call?.name === AGENT_SHELL_RUN_TOOL_NAME
    || source.activity?.call.name === AGENT_SHELL_RUN_TOOL_NAME;
  return {
    ...event,
    ...(projectedActivity ? { activity: projectedActivity } : {}),
    ...(source.result && skillCall
      ? { result: compactSkillActivationResult(source.result) }
      : source.result && shellCall
        ? { result: compactShellResult(source.result) }
      : {}),
    ...(source.toolActivities
      ? {
          toolActivities: source.toolActivities.map(
            activity => projectAgentToolActivityForRenderer(activity),
          ),
        }
      : {}),
  } as AgentChatStreamEvent;
}

import type {
  AgentChatStreamEvent,
  AgentComputerSetTextPreparedActionPublicV1,
  AgentSessionSnapshot,
  AgentToolActivitySnapshot,
  AgentToolApprovalSnapshot,
  AgentToolCallSnapshot,
  AgentToolProgress,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { AGENT_SKILL_ACTIVATE_TOOL_NAME } from './skills/agent-skill.types';
import { AGENT_SHELL_RUN_TOOL_NAME } from '../../../src/shared/agent/shell/agent-shell.types';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import {
  agentToolRegistry,
  type AgentToolSnapshot,
} from './agent-tool-registry';
import { isAgentComputerTextLegacyAuditName, projectAgentComputerTextInput,
  projectAgentComputerTextPreview, projectAgentComputerTextResult } from './agent-tool-audit';

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

function builtinComputerTool(activity: AgentToolActivitySnapshot, tool: AgentToolSnapshot): 'observe' | 'click' | 'setText' | 'scroll' | undefined {
  const operation = activity.call.name === 'computer.observe' ? 'observe'
    : activity.call.name === 'computer.click' ? 'click'
    : activity.call.name === 'computer.setText' ? 'setText'
    : activity.call.name === 'computer.scroll' ? 'scroll' : undefined;
  if (!operation || tool.registrationId !== `builtin:computer.${operation}@1`
    || tool.name !== activity.call.name || tool.executor !== 'main' || tool.kind !== 'business'
    || tool.pluginSource || tool.pluginOperation || activity.pluginSource
    || ((operation === 'setText' || operation === 'scroll') && (tool.risk !== 'write' || typeof tool.prepareMain !== 'function'))) return undefined;
  // This classification may keep the initial prepare row in its display group; it grants no prepared action or approval.
  if (activity.status === 'preparing' && activity.preparation === undefined && activity.result === undefined
    && activity.approval === undefined && activity.interaction === undefined && activity.finishedAt === undefined
    && (activity.permissionBehavior === 'allow' || activity.permissionBehavior === 'ask')
    && tool.risk === (operation === 'observe' ? 'read' : 'write') && typeof tool.prepareMain === 'function') return operation;
  try {
    const action = normalizeAgentPreparedActionPublic(activity.preparation?.action);
    return action.kind === activity.call.name ? operation : undefined;
  } catch { return undefined; }
}

function computerTextAction(input: unknown): AgentComputerSetTextPreparedActionPublicV1 | undefined {
  try {
    const action = normalizeAgentPreparedActionPublic(input);
    return action.kind === 'computer.setText' ? action : undefined;
  } catch { return undefined; }
}

function compactComputerTextActivity(activity: AgentToolActivitySnapshot): AgentToolActivitySnapshot {
  const action = activity.call.name === 'computer.setText' ? computerTextAction(activity.preparation?.action) : undefined;
  return { ...activity, call: { ...activity.call, input: projectAgentComputerTextInput(activity.call.input) },
    ...(activity.preparation ? { preparation: action ? { ...activity.preparation, action } : undefined } : {}),
    ...(activity.approval ? { approval: { ...activity.approval, preview: projectAgentComputerTextPreview(action) } } : {}),
    ...(activity.progress ? { progress: { message: '正在输入文字' } } : {}),
    ...(activity.result ? { result: projectAgentComputerTextResult(activity.result, action) } : {}) };
}

/** A rejected legacy alias needs privacy cleanup, not builtin display provenance. */
function hasPrivateComputerTextActivity(activity: AgentToolActivitySnapshot): boolean {
  return activity.call.name === 'computer.setText'
    || activity.permissionBehavior === 'deny' && isAgentComputerTextLegacyAuditName(activity.call.name);
}

export function projectAgentToolActivityForRenderer(
  activity: AgentToolActivitySnapshot,
  resolveTool: (name: string) => AgentToolSnapshot | null = name => agentToolRegistry.get(name),
): AgentToolActivitySnapshot {
  const tool = resolveTool(activity.call.name);
  const computerTool = tool ? builtinComputerTool(activity, tool) : undefined;
  const toolMetadata = tool
    ? {
        ...(computerTool ? { builtinComputerTool: computerTool } : {}),
        kind: tool.kind,
        ...(tool.presentation ? {
          groupKind: tool.presentation.groupKind,
          operationKind: tool.presentation.operationKind,
        } : {}),
        risk: tool.risk,
      } as const
    : undefined;
  let projectedActivity = toolMetadata
    ? { ...activity, toolMetadata }
    : activity.toolMetadata
      ? { ...activity, toolMetadata: undefined }
      : activity;
  if (hasPrivateComputerTextActivity(activity)) projectedActivity = compactComputerTextActivity(projectedActivity);
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
    approval?: AgentToolApprovalSnapshot;
    call?: AgentToolCallSnapshot;
    progress?: AgentToolProgress;
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
  const textCall = source.call?.name === 'computer.setText'
    || !!source.activity && hasPrivateComputerTextActivity(source.activity)
    || source.approval?.call.name === 'computer.setText'
    || !source.activity && source.result?.ok === false && isAgentComputerTextLegacyAuditName(source.call?.name);
  const textAction = computerTextAction(source.activity?.call.name === 'computer.setText'
    ? source.activity.preparation?.action
    : source.approval?.call.name === 'computer.setText' ? source.approval.preparation?.action : undefined);
  const textApproval = source.approval?.call.name === 'computer.setText' ? {
    ...source.approval,
    call: { ...source.approval.call, input: projectAgentComputerTextInput(source.approval.call.input) },
    preview: projectAgentComputerTextPreview(textAction),
    ...(source.approval.preparation ? { preparation: textAction
      ? { ...source.approval.preparation, action: textAction } : undefined } : {}),
  } : undefined;
  return {
    ...event,
    ...(textCall && source.call ? { call: { ...source.call, input: projectAgentComputerTextInput(source.call.input) } } : {}),
    ...(textCall && source.progress ? { progress: { message: '正在输入文字' } } : {}),
    ...(textApproval ? { approval: textApproval } : {}),
    ...(projectedActivity ? { activity: projectedActivity } : {}),
    ...(source.result && textCall ? { result: projectAgentComputerTextResult(source.result, textAction) }
      : source.result && skillCall
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

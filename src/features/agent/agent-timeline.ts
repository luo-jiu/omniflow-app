import type {
  AgentAssistantItemSnapshot,
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  isAgentAssistantItem,
  isAgentConversationMessage,
} from '@/shared/agent/agent.types';
import {
  buildAgentWorkflowProjectionFromRunActivities,
  type AgentWorkflowProjection,
} from './agent-workflow-projection';

type TimelineLayer = 'conversation' | 'work-journal' | 'execution-facts';

export type AgentTimelineItem =
  | {
      key: string;
      layer: 'execution-facts';
      occurredAt: string;
      run: AgentRunSnapshot;
      type: 'run-status';
    }
  | {
      activity: AgentToolActivitySnapshot;
      key: string;
      layer: 'execution-facts';
      occurredAt: string;
      type: 'tool-activity';
    }
  | {
      activities: AgentToolActivitySnapshot[];
      groupKind: 'resource-read';
      key: string;
      layer: 'execution-facts';
      occurredAt: string;
      runId: string;
      type: 'tool-group';
    }
  | {
      key: string;
      layer: 'conversation';
      message: AgentMessage;
      occurredAt: string;
      type: 'message';
    }
  | {
      item: AgentAssistantItemSnapshot;
      key: string;
      layer: 'work-journal';
      occurredAt: string;
      type: 'assistant-work-item';
    }
  | {
      key: string;
      layer: 'execution-facts';
      occurredAt: string;
      type: 'workflow';
      workflow: AgentWorkflowProjection;
    };

type ToolActivityTimelineItem = Extract<AgentTimelineItem, { type: 'tool-activity' }>;
type WorkflowTimelineItem = Extract<AgentTimelineItem, { type: 'workflow' }>;

export interface PreparedAgentTimelineProjection {
  terminalRuns: ReadonlyMap<string, AgentRunSnapshot>;
  activitiesByCall: ReadonlyMap<string, AgentToolActivitySnapshot>;
  activityItems: ToolActivityTimelineItem[];
  activityItemsByRun: ReadonlyMap<string, ToolActivityTimelineItem[]>;
  activityRunById: ReadonlyMap<string, string>;
  workflowItems: WorkflowTimelineItem[];
  workflowsByRun: ReadonlyMap<string, WorkflowTimelineItem>;
}

export interface AgentTimelineLayers {
  conversation: AgentTimelineItem[];
  executionFacts: AgentTimelineItem[];
  workJournal: AgentTimelineItem[];
}

function toolCallKey(runId: string | undefined, callId: string | undefined): string {
  return runId && callId ? `${runId}\u0000${callId}` : '';
}

function stableSortByOccurredAt<T extends AgentTimelineItem>(items: T[]): T[] {
  return items
    .map((item, index) => ({ index, item }))
    .sort((left, right) => (
      left.item.occurredAt.localeCompare(right.item.occurredAt)
      || left.index - right.index
    ))
    .map(entry => entry.item);
}

function stableSortToolItems(items: ToolActivityTimelineItem[]): ToolActivityTimelineItem[] {
  return [...items].sort((left, right) => {
    const leftOrdinal = left.activity.ordinal > 0
      ? left.activity.ordinal
      : Number.MAX_SAFE_INTEGER;
    const rightOrdinal = right.activity.ordinal > 0
      ? right.activity.ordinal
      : Number.MAX_SAFE_INTEGER;
    return leftOrdinal - rightOrdinal
      || left.activity.createdAt.localeCompare(right.activity.createdAt)
      || left.activity.id.localeCompare(right.activity.id);
  });
}

function stableMergeByOccurredAt(
  existing: AgentTimelineItem[],
  fallback: AgentTimelineItem[],
): AgentTimelineItem[] {
  const merged: AgentTimelineItem[] = [];
  let existingIndex = 0;
  let fallbackIndex = 0;
  while (existingIndex < existing.length && fallbackIndex < fallback.length) {
    if (existing[existingIndex].occurredAt <= fallback[fallbackIndex].occurredAt) {
      merged.push(existing[existingIndex]);
      existingIndex += 1;
    } else {
      merged.push(fallback[fallbackIndex]);
      fallbackIndex += 1;
    }
  }
  if (existingIndex < existing.length) merged.push(...existing.slice(existingIndex));
  if (fallbackIndex < fallback.length) merged.push(...fallback.slice(fallbackIndex));
  return merged;
}

function isRenderableWorkItem(item: AgentAssistantItemSnapshot): boolean {
  if (!item.content.trim()) return item.assistantItem.status === 'streaming';
  return !(item.assistantItem.phase === 'final' && item.assistantItem.status === 'completed');
}

function canJoinReadGroup(activity: AgentToolActivitySnapshot): boolean {
  return activity.status === 'completed'
    && activity.result?.ok !== false
    && activity.permissionBehavior === 'allow'
    && !activity.approval
    && !activity.interaction
    && activity.toolMetadata?.kind === 'business'
    && activity.toolMetadata.risk === 'read'
    && activity.toolMetadata.groupKind === 'resource-read';
}

function groupReadActivities(items: AgentTimelineItem[]): AgentTimelineItem[] {
  const grouped: AgentTimelineItem[] = [];
  items.forEach((item) => {
    const groupKind = item.type === 'tool-activity'
      ? item.activity.toolMetadata?.groupKind
      : undefined;
    const operationKind = item.type === 'tool-activity'
      ? item.activity.toolMetadata?.operationKind
      : undefined;
    if (
      item.type !== 'tool-activity'
      || groupKind !== 'resource-read'
      || !operationKind
    ) {
      grouped.push(item);
      return;
    }
    const activity = item.activity;
    const previous = grouped.at(-1);
    if (
      canJoinReadGroup(activity)
      && previous?.type === 'tool-group'
      && previous.runId === activity.runId
      && previous.groupKind === groupKind
      && previous.activities.every(canJoinReadGroup)
    ) {
      previous.activities.push(activity);
      return;
    }
    grouped.push({
      activities: [activity],
      groupKind,
      key: `activity-group:${activity.id}`,
      layer: 'execution-facts',
      occurredAt: item.occurredAt,
      runId: activity.runId,
      type: 'tool-group',
    });
  });
  return grouped;
}

export function splitAgentTimelineLayers(items: AgentTimelineItem[]): AgentTimelineLayers {
  const layers: AgentTimelineLayers = {
    conversation: [],
    executionFacts: [],
    workJournal: [],
  };
  items.forEach((item) => {
    const target: Record<TimelineLayer, AgentTimelineItem[]> = {
      conversation: layers.conversation,
      'execution-facts': layers.executionFacts,
      'work-journal': layers.workJournal,
    };
    target[item.layer].push(item);
  });
  return layers;
}

export function prepareAgentTimelineProjection(
  messages: AgentMessage[],
  runs: AgentRunSnapshot[],
  toolActivities: AgentToolActivitySnapshot[],
): PreparedAgentTimelineProjection {
  const activitiesByCall = new Map<string, AgentToolActivitySnapshot>();
  const activitiesByRun = new Map<string, AgentToolActivitySnapshot[]>();
  const activityRunById = new Map<string, string>();
  const activityItemsByRun = new Map<string, ToolActivityTimelineItem[]>();
  const activityItems: ToolActivityTimelineItem[] = [];
  const messagesByRun = new Map<string, AgentMessage[]>();

  messages.forEach((message) => {
    if (!message.runId) return;
    const runMessages = messagesByRun.get(message.runId);
    if (runMessages) runMessages.push(message);
    else messagesByRun.set(message.runId, [message]);
  });
  toolActivities.forEach((activity) => {
    const runId = activity.runId;
    activitiesByCall.set(toolCallKey(runId, activity.call.id), activity);
    activityRunById.set(activity.id, runId);
    const runActivities = activitiesByRun.get(runId);
    if (runActivities) runActivities.push(activity);
    else activitiesByRun.set(runId, [activity]);
    const item: ToolActivityTimelineItem = {
      activity,
      key: `activity:${activity.id}`,
      layer: 'execution-facts',
      occurredAt: activity.createdAt,
      type: 'tool-activity',
    };
    activityItems.push(item);
    const runItems = activityItemsByRun.get(runId);
    if (runItems) runItems.push(item);
    else activityItemsByRun.set(runId, [item]);
  });

  const workflowsByRun = new Map<string, WorkflowTimelineItem>();
  const workflowItems: WorkflowTimelineItem[] = [];
  runs.forEach((run) => {
    const workflow = buildAgentWorkflowProjectionFromRunActivities(
      run,
      activitiesByRun.get(run.id) || [],
      messagesByRun.get(run.id) || [],
    );
    if (!workflow) return;
    const item: WorkflowTimelineItem = {
      key: `workflow:${run.id}`,
      layer: 'execution-facts',
      occurredAt: run.createdAt,
      type: 'workflow',
      workflow,
    };
    workflowsByRun.set(run.id, item);
    workflowItems.push(item);
  });

  return {
    activitiesByCall,
    activityItems: stableSortByOccurredAt(activityItems),
    activityItemsByRun: new Map(
      [...activityItemsByRun].map(([runId, items]) => [runId, stableSortToolItems(items)]),
    ),
    activityRunById,
    terminalRuns: new Map(runs.filter(run => (
      run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted'
    )).map(run => [run.id, run])),
    workflowItems: stableSortByOccurredAt(workflowItems),
    workflowsByRun,
  };
}

export function buildAgentTimelineItemsFromProjection(
  messages: AgentMessage[],
  prepared: PreparedAgentTimelineProjection,
): AgentTimelineItem[] {
  const renderedActivityIds = new Set<string>();
  const messageItems: AgentTimelineItem[] = [];
  const messageItemRunIds: Array<string | undefined> = [];

  messages.forEach((message) => {
    const messageRunId = message.runId;
    const matchingActivity = message.role === 'tool'
      ? prepared.activitiesByCall.get(toolCallKey(messageRunId, message.toolCallId))
      : undefined;
    if (matchingActivity) {
      if (!renderedActivityIds.has(matchingActivity.id)) {
        renderedActivityIds.add(matchingActivity.id);
        messageItems.push({
          activity: matchingActivity,
          key: `activity:${matchingActivity.id}`,
          layer: 'execution-facts',
          occurredAt: matchingActivity.createdAt,
          type: 'tool-activity',
        });
        messageItemRunIds.push(messageRunId);
      }
      return;
    }
    if (message.role === 'tool' || message.role === 'system') return;
    if (isAgentAssistantItem(message) && isRenderableWorkItem(message)) {
      messageItems.push({
        item: message,
        key: `message:${message.id}`,
        layer: 'work-journal',
        occurredAt: message.createdAt,
        type: 'assistant-work-item',
      });
      messageItemRunIds.push(messageRunId);
      return;
    }
    if (!isAgentConversationMessage(message)) return;
    if (message.role === 'assistant' && !message.content.trim()) return;
    messageItems.push({
      key: `message:${message.id}`,
      layer: 'conversation',
      message,
      occurredAt: message.createdAt,
      type: 'message',
    });
    messageItemRunIds.push(messageRunId);
  });

  const lastMessageItemIndexByRun = new Map<string, number>();
  messageItemRunIds.forEach((runId, index) => {
    if (runId) lastMessageItemIndexByRun.set(runId, index);
  });
  const itemsWithFallbackActivities: AgentTimelineItem[] = [];
  const terminalItem = (run: AgentRunSnapshot): AgentTimelineItem => ({
    key: `run-status:${run.id}`, layer: 'execution-facts',
    occurredAt: run.finishedAt || run.updatedAt, run, type: 'run-status',
  });

  messageItems.forEach((item, index) => {
    itemsWithFallbackActivities.push(item);
    const runId = messageItemRunIds[index];
    if (!runId) return;
    if (lastMessageItemIndexByRun.get(runId) !== index) return;
    prepared.activityItemsByRun.get(runId)?.forEach((fallback) => {
      if (!renderedActivityIds.has(fallback.activity.id)) {
        itemsWithFallbackActivities.push(fallback);
      }
    });
    const terminal = prepared.terminalRuns.get(runId);
    if (terminal) itemsWithFallbackActivities.push(terminalItem(terminal));
  });

  const orphanActivities = prepared.activityItems.filter(item => (
    !renderedActivityIds.has(item.activity.id)
    && !lastMessageItemIndexByRun.has(prepared.activityRunById.get(item.activity.id) || '')
  ));
  return groupReadActivities(stableMergeByOccurredAt(
    itemsWithFallbackActivities,
    stableSortByOccurredAt([
      ...orphanActivities,
      ...Array.from(prepared.terminalRuns.values())
        .filter(run => !lastMessageItemIndexByRun.has(run.id)).map(terminalItem),
    ]),
  ));
}

export function buildAgentTimelineItems(
  messages: AgentMessage[],
  runs: AgentRunSnapshot[],
  toolActivities: AgentToolActivitySnapshot[],
): AgentTimelineItem[] {
  return buildAgentTimelineItemsFromProjection(
    messages,
    prepareAgentTimelineProjection(messages, runs, toolActivities),
  );
}

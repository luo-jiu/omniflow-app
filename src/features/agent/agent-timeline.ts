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
type ToolGroupKind = 'tool-sequence';

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
      groupKind: ToolGroupKind;
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

function compareToolItems(left: ToolActivityTimelineItem, right: ToolActivityTimelineItem): number {
  const leftOrdinal = left.activity.ordinal > 0 ? left.activity.ordinal : Number.MAX_SAFE_INTEGER;
  const rightOrdinal = right.activity.ordinal > 0 ? right.activity.ordinal : Number.MAX_SAFE_INTEGER;
  return leftOrdinal - rightOrdinal
    || left.activity.createdAt.localeCompare(right.activity.createdAt)
    || left.activity.id.localeCompare(right.activity.id);
}

function stableSortToolItems(items: ToolActivityTimelineItem[]): ToolActivityTimelineItem[] {
  return [...items].sort(compareToolItems);
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

function isApprovedAccessRecord(activity: AgentToolActivitySnapshot): boolean {
  // Directory scope approval is a permission transition, not a separate task step.
  // Keep its canonical snapshot and ordinal anchors; omit only the successful display row.
  return activity.call.name === 'agent.access.request' && !activity.pluginSource
    && activity.status === 'completed' && activity.approval?.status === 'approved'
    && activity.result?.ok === true && !activity.interaction && !activity.preparation;
}

function needsStandaloneToolEntry(activity: AgentToolActivitySnapshot): boolean {
  // Pending decisions must remain directly reachable. Interaction answers are real
  // conversation content, unlike a successful permission-only approval.
  return activity.status === 'awaiting_approval' || activity.status === 'awaiting_interaction'
    || activity.approval?.status === 'pending' || !!activity.interaction
    || activity.call.name === 'agent.access.request';
}

function groupToolActivities(items: AgentTimelineItem[]): AgentTimelineItem[] {
  const grouped: AgentTimelineItem[] = [];
  items.forEach((item) => {
    if (item.type !== 'tool-activity') {
      grouped.push(item);
      return;
    }
    const activity = item.activity;
    if (isApprovedAccessRecord(activity)) return;
    if (needsStandaloneToolEntry(activity)) {
      grouped.push(item);
      return;
    }
    const previous = grouped.at(-1);
    if (
      previous?.type === 'tool-group'
      && previous.runId === activity.runId
      && previous.activities[0].sessionId === activity.sessionId
    ) {
      previous.activities.push(activity);
      return;
    }
    grouped.push({
      activities: [activity],
      groupKind: 'tool-sequence',
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

  const messageIndexesByRun = new Map<string, number[]>();
  messageItemRunIds.forEach((runId, index) => {
    if (!runId) return;
    const indexes = messageIndexesByRun.get(runId);
    if (indexes) indexes.push(index);
    else messageIndexesByRun.set(runId, [index]);
  });
  const beforeMessage = new Map<number, AgentTimelineItem[]>();
  const afterMessage = new Map<number, AgentTimelineItem[]>();
  const insertAt = (target: Map<number, AgentTimelineItem[]>, index: number, item: AgentTimelineItem) => {
    const items = target.get(index);
    if (items) items.push(item);
    else target.set(index, [item]);
  };
  const terminalItem = (run: AgentRunSnapshot): AgentTimelineItem => ({
    key: `run-status:${run.id}`, layer: 'execution-facts',
    occurredAt: run.finishedAt || run.updatedAt, run, type: 'run-status',
  });

  messageIndexesByRun.forEach((indexes, runId) => {
    const missing = (prepared.activityItemsByRun.get(runId) || [])
      .filter(item => !renderedActivityIds.has(item.activity.id));
    const lastIndex = indexes[indexes.length - 1];
    let missingIndex = 0;
    let segmentStart = 0;

    // Tool ordinals bound each gap between canonical anchors. Timestamps only
    // place missing records among commentary inside that gap; messages never move.
    const mergeGap = (end: number, missingEnd: number, nextAnchor?: number) => {
      let cursor = segmentStart;
      while (missingIndex < missingEnd) {
        const fallback = missing[missingIndex++];
        while (cursor < end) {
          const candidate = messageItems[indexes[cursor]];
          if (candidate.type === 'message' && candidate.message.role === 'assistant') break;
          if (!(candidate.type === 'message' && candidate.message.role === 'user')
            && candidate.occurredAt > fallback.occurredAt) break;
          cursor += 1;
        }
        if (cursor < end) insertAt(beforeMessage, indexes[cursor], fallback);
        else if (nextAnchor !== undefined) insertAt(beforeMessage, nextAnchor, fallback);
        else insertAt(afterMessage, lastIndex, fallback);
      }
    };

    indexes.forEach((index, position) => {
      const item = messageItems[index];
      if (item.type !== 'tool-activity') return;
      let missingEnd = missingIndex;
      while (missingEnd < missing.length && compareToolItems(missing[missingEnd], item) < 0) missingEnd += 1;
      mergeGap(position, missingEnd, index);
      segmentStart = position + 1;
    });
    mergeGap(indexes.length, missing.length);
    const terminal = prepared.terminalRuns.get(runId);
    if (terminal) insertAt(afterMessage, lastIndex, terminalItem(terminal));
  });

  const itemsWithFallbackActivities = messageItems.flatMap((item, index) => [
    ...(beforeMessage.get(index) || []), item, ...(afterMessage.get(index) || []),
  ]);
  const orphanActivities = prepared.activityItems.filter(item => (
    !renderedActivityIds.has(item.activity.id)
    && !messageIndexesByRun.has(prepared.activityRunById.get(item.activity.id) || '')
  ));
  return groupToolActivities(stableMergeByOccurredAt(
    itemsWithFallbackActivities,
    stableSortByOccurredAt([
      ...orphanActivities,
      ...Array.from(prepared.terminalRuns.values())
        .filter(run => !messageIndexesByRun.has(run.id)).map(terminalItem),
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

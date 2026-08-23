import type {
  AgentMessage,
  AgentRunSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  buildAgentWorkflowProjectionFromRunActivities,
  type AgentWorkflowProjection,
} from './agent-workflow-projection';

export type AgentTimelineItem =
  | {
      activity: AgentToolActivitySnapshot;
      key: string;
      occurredAt: string;
      type: 'tool-activity';
    }
  | {
      key: string;
      message: AgentMessage;
      occurredAt: string;
      type: 'message';
    }
  | {
      key: string;
      occurredAt: string;
      type: 'workflow';
      workflow: AgentWorkflowProjection;
    };

type ToolActivityTimelineItem = Extract<AgentTimelineItem, { type: 'tool-activity' }>;
type WorkflowTimelineItem = Extract<AgentTimelineItem, { type: 'workflow' }>;

export interface PreparedAgentTimelineProjection {
  activitiesByCall: ReadonlyMap<string, AgentToolActivitySnapshot>;
  activityItems: ToolActivityTimelineItem[];
  activityItemsByRun: ReadonlyMap<string, ToolActivityTimelineItem[]>;
  activityRunById: ReadonlyMap<string, string>;
  workflowItems: WorkflowTimelineItem[];
  workflowsByRun: ReadonlyMap<string, WorkflowTimelineItem>;
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

export function prepareAgentTimelineProjection(
  runs: AgentRunSnapshot[],
  toolActivities: AgentToolActivitySnapshot[],
): PreparedAgentTimelineProjection {
  const activitiesByCall = new Map<string, AgentToolActivitySnapshot>();
  const activitiesByRun = new Map<string, AgentToolActivitySnapshot[]>();
  const activityRunById = new Map<string, string>();
  const activityItemsByRun = new Map<string, ToolActivityTimelineItem[]>();
  const activityItems: ToolActivityTimelineItem[] = [];

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
    const runId = run.id;
    const workflow = buildAgentWorkflowProjectionFromRunActivities(
      run,
      activitiesByRun.get(runId) || [],
    );
    if (!workflow) return;
    const item: WorkflowTimelineItem = {
      key: `workflow:${runId}`,
      occurredAt: run.createdAt,
      type: 'workflow',
      workflow,
    };
    workflowsByRun.set(runId, item);
    workflowItems.push(item);
  });

  return {
    activitiesByCall,
    activityItems: stableSortByOccurredAt(activityItems),
    activityItemsByRun: new Map(
      [...activityItemsByRun].map(([runId, items]) => [runId, stableSortToolItems(items)]),
    ),
    activityRunById,
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
          occurredAt: matchingActivity.createdAt,
          type: 'tool-activity',
        });
        messageItemRunIds.push(messageRunId);
      }
      return;
    }
    messageItems.push({
      key: `message:${message.id}`,
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
  const anchoredWorkflowKeys = new Set<string>();
  const itemsWithAnchoredWorkflows: AgentTimelineItem[] = [];

  messageItems.forEach((item, index) => {
    itemsWithAnchoredWorkflows.push(item);
    const runId = messageItemRunIds[index];
    if (!runId) return;
    if (item.type === 'message' && item.message.role === 'user') {
      const workflow = prepared.workflowsByRun.get(runId);
      if (workflow && !anchoredWorkflowKeys.has(workflow.key)) {
        anchoredWorkflowKeys.add(workflow.key);
        itemsWithAnchoredWorkflows.push(workflow);
      }
    }
    if (lastMessageItemIndexByRun.get(runId) !== index) return;
    prepared.activityItemsByRun.get(runId)?.forEach((fallback) => {
      if (!renderedActivityIds.has(fallback.activity.id)) {
        itemsWithAnchoredWorkflows.push(fallback);
      }
    });
  });

  const orphanActivities = prepared.activityItems.filter(item => (
    !renderedActivityIds.has(item.activity.id)
    && !lastMessageItemIndexByRun.has(prepared.activityRunById.get(item.activity.id) || '')
  ));
  const fallbackWorkflows = prepared.workflowItems.filter(
    item => !anchoredWorkflowKeys.has(item.key),
  );
  return stableMergeByOccurredAt(
    itemsWithAnchoredWorkflows,
    stableMergeByOccurredAt(orphanActivities, fallbackWorkflows),
  );
}

export function buildAgentTimelineItems(
  messages: AgentMessage[],
  runs: AgentRunSnapshot[],
  toolActivities: AgentToolActivitySnapshot[],
): AgentTimelineItem[] {
  return buildAgentTimelineItemsFromProjection(
    messages,
    prepareAgentTimelineProjection(runs, toolActivities),
  );
}

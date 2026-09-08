import {
  isAgentAssistantItem,
  type AgentAssistantItemSnapshot,
  type AgentChatStreamEvent,
  type AgentMessage,
} from '@/shared/agent/agent.types';
import { mergeAgentRun } from './agent-runs';

type AgentAssistantStreamEvent = Extract<AgentChatStreamEvent, {
  type: 'assistant-item-delta' | 'assistant-item-finished' | 'assistant-item-started';
}>;

export interface AgentAssistantStreamMergeResult {
  issue?: Readonly<{
    itemId: string;
    kind: 'conflict' | 'gap';
  }>;
  messages: AgentMessage[];
}

function replaceMessage(
  current: AgentMessage[],
  index: number,
  message: AgentMessage,
): AgentMessage[] {
  if (current[index] === message) return current;
  return current.map((candidate, candidateIndex) => (
    candidateIndex === index ? message : candidate
  ));
}

function sameAssistantIdentity(
  left: AgentAssistantItemSnapshot,
  right: AgentAssistantItemSnapshot,
): boolean {
  return left.id === right.id
    && left.runId === right.runId
    && left.sessionId === right.sessionId
    && left.createdAt === right.createdAt
    && left.assistantItem.turnOrdinal === right.assistantItem.turnOrdinal;
}

function sameTerminalItem(
  left: AgentAssistantItemSnapshot,
  right: AgentAssistantItemSnapshot,
): boolean {
  return sameAssistantIdentity(left, right)
    && left.content === right.content
    && left.assistantItem.phase === right.assistantItem.phase
    && left.assistantItem.status === right.assistantItem.status
    && left.assistantItem.revision === right.assistantItem.revision
    && left.assistantItem.updatedAt === right.assistantItem.updatedAt
    && left.assistantItem.finishedAt === right.assistantItem.finishedAt;
}

function issue(
  current: AgentMessage[],
  itemId: string,
  kind: 'conflict' | 'gap',
): AgentAssistantStreamMergeResult {
  return { issue: { itemId, kind }, messages: current };
}

function mergeStartedItem(
  current: AgentMessage[],
  item: AgentAssistantItemSnapshot,
  runId: string,
  sessionId: string,
): AgentAssistantStreamMergeResult {
  if (
    item.runId !== runId
    || item.sessionId !== sessionId
    || item.assistantItem.phase !== 'unknown'
    || item.assistantItem.status !== 'streaming'
  ) return issue(current, item.id, 'conflict');
  const index = current.findIndex(message => message.id === item.id);
  if (index < 0) return { messages: [...current, item] };
  const existing = current[index];
  if (!isAgentAssistantItem(existing) || !sameAssistantIdentity(existing, item)) {
    return issue(current, item.id, 'conflict');
  }
  if (existing.assistantItem.status !== 'streaming') {
    return issue(current, item.id, 'conflict');
  }
  if (item.assistantItem.revision < existing.assistantItem.revision) {
    return { messages: current };
  }
  if (item.content.startsWith(existing.content)) {
    return { messages: replaceMessage(current, index, item) };
  }
  if (existing.content.startsWith(item.content)) {
    return {
      messages: replaceMessage(current, index, {
        ...item,
        content: existing.content,
      }),
    };
  }
  return issue(current, item.id, 'conflict');
}

function mergeDelta(
  current: AgentMessage[],
  event: Extract<AgentAssistantStreamEvent, { type: 'assistant-item-delta' }>,
): AgentAssistantStreamMergeResult {
  if (!Number.isSafeInteger(event.offset) || event.offset < 0) {
    return issue(current, event.itemId, 'conflict');
  }
  const index = current.findIndex(message => message.id === event.itemId);
  if (index < 0) return issue(current, event.itemId, 'gap');
  const existing = current[index];
  if (
    !isAgentAssistantItem(existing)
    || existing.runId !== event.runId
    || existing.sessionId !== event.sessionId
  ) return issue(current, event.itemId, 'conflict');
  if (existing.assistantItem.status !== 'streaming') return { messages: current };
  if (event.offset > existing.content.length) return issue(current, event.itemId, 'gap');
  const overlapLength = Math.min(
    event.delta.length,
    existing.content.length - event.offset,
  );
  if (
    existing.content.slice(event.offset, event.offset + overlapLength)
    !== event.delta.slice(0, overlapLength)
  ) return issue(current, event.itemId, 'conflict');
  const suffix = event.delta.slice(overlapLength);
  if (!suffix) return { messages: current };
  return {
    messages: replaceMessage(current, index, {
      ...existing,
      content: `${existing.content}${suffix}`,
    }),
  };
}

function mergeFinishedItem(
  current: AgentMessage[],
  item: AgentAssistantItemSnapshot,
  runId: string,
  sessionId: string,
): AgentAssistantStreamMergeResult {
  if (
    item.runId !== runId
    || item.sessionId !== sessionId
    || item.assistantItem.status === 'streaming'
  ) return issue(current, item.id, 'conflict');
  const index = current.findIndex(message => message.id === item.id);
  if (index < 0) return { messages: [...current, item] };
  const existing = current[index];
  if (!isAgentAssistantItem(existing) || !sameAssistantIdentity(existing, item)) {
    return issue(current, item.id, 'conflict');
  }
  if (existing.assistantItem.status !== 'streaming') {
    if (item.assistantItem.revision < existing.assistantItem.revision) {
      return { messages: current };
    }
    return sameTerminalItem(existing, item)
      ? { messages: current }
      : issue(current, item.id, 'conflict');
  }
  if (item.assistantItem.revision <= existing.assistantItem.revision) {
    return issue(current, item.id, 'conflict');
  }
  return { messages: replaceMessage(current, index, item) };
}

export function mergeAgentAssistantStreamEvent(
  current: AgentMessage[],
  event: AgentAssistantStreamEvent,
): AgentAssistantStreamMergeResult {
  if (event.type === 'assistant-item-started') {
    return mergeStartedItem(current, event.item, event.runId, event.sessionId);
  }
  if (event.type === 'assistant-item-delta') return mergeDelta(current, event);
  return mergeFinishedItem(current, event.item, event.runId, event.sessionId);
}

export function appendBufferedAgentEvent(
  current: AgentChatStreamEvent[],
  event: AgentChatStreamEvent,
): AgentChatStreamEvent[] {
  const previous = current.at(-1);
  if (
    previous?.type === 'assistant-item-delta'
    && event.type === 'assistant-item-delta'
    && previous.itemId === event.itemId
    && previous.runId === event.runId
    && previous.sessionId === event.sessionId
    && previous.offset + previous.delta.length === event.offset
  ) {
    return [
      ...current.slice(0, -1),
      {
        ...event,
        delta: `${previous.delta}${event.delta}`,
        offset: previous.offset,
      },
    ];
  }
  if (
    previous?.type === 'run-updated'
    && event.type === 'run-updated'
    && previous.runId === event.runId
    && previous.sessionId === event.sessionId
  ) {
    const mergedRun = mergeAgentRun(previous.run, event.run);
    return [
      ...current.slice(0, -1),
      mergedRun === previous.run ? previous : { ...event, run: mergedRun },
    ];
  }
  return [...current, event];
}

export function reconcileCanonicalAgentRunMessages(
  current: AgentMessage[],
  runId: string,
  canonical: AgentMessage[],
): AgentMessage[] {
  const firstRunMessageIndex = current.findIndex(message => message.runId === runId);
  if (firstRunMessageIndex < 0) return [...current, ...canonical];
  return [
    ...current.slice(0, firstRunMessageIndex),
    ...canonical,
    ...current.slice(firstRunMessageIndex).filter(message => message.runId !== runId),
  ];
}

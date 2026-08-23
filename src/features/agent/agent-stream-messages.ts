import type { AgentChatStreamEvent, AgentMessage } from '@/shared/agent/agent.types';

export function appendBufferedAgentEvent(
  current: AgentChatStreamEvent[],
  event: AgentChatStreamEvent,
): AgentChatStreamEvent[] {
  const previous = current.at(-1);
  if (
    previous?.type === 'delta'
    && event.type === 'delta'
    && previous.runId === event.runId
    && previous.sessionId === event.sessionId
  ) {
    return [
      ...current.slice(0, -1),
      { ...event, delta: `${previous.delta}${event.delta}` },
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

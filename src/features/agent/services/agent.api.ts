import type {
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentOwnerScope,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
} from '@/shared/agent/agent.types';

function bridge() {
  if (!window.electronAgent) {
    throw new Error('当前环境不支持内置 Agent');
  }
  return window.electronAgent;
}

export function startAgentChat(input: AgentChatRequest): Promise<AgentChatStartResult> {
  return bridge().startChat(input);
}

export function stopAgentChat(sessionId: string): Promise<boolean> {
  return bridge().stopChat(sessionId);
}

export function releaseAgentOwnerRuns(): Promise<boolean> {
  return bridge().releaseOwner();
}

export function listAgentSessions(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  query?: string,
  cursor?: AgentSessionCursor,
): Promise<AgentSessionPage> {
  return bridge().listSessions(ownerScope, libraryId, query, cursor);
}

export function getAgentSession(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  sessionId: string,
): Promise<AgentSessionSnapshot> {
  return bridge().getSession(ownerScope, libraryId, sessionId);
}

export function renameAgentSession(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  sessionId: string,
  title: string,
): Promise<AgentSessionSummary> {
  return bridge().renameSession(ownerScope, libraryId, sessionId, title);
}

export function deleteAgentSession(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  sessionId: string,
): Promise<boolean> {
  return bridge().deleteSession(ownerScope, libraryId, sessionId);
}

export function subscribeAgentChat(
  listener: (event: AgentChatStreamEvent) => void,
): () => void {
  return bridge().onEvent(listener);
}

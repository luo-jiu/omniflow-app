import type {
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentMediaArtifactReleaseRequest,
  AgentMediaAudioExtractionRequest,
  AgentMediaAudioExtractionResult,
  AgentMediaInspectionRequest,
  AgentOwnerScope,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolApprovalDecisionRequest,
  AgentToolApprovalDecisionResult,
  AgentToolExecutionCompletion,
  AgentToolExecutionCommit,
  AgentToolExecutionProgressRequest,
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

export function resolveAgentToolApproval(
  input: AgentToolApprovalDecisionRequest,
): Promise<AgentToolApprovalDecisionResult> {
  return bridge().resolveToolApproval(input);
}

export function completeAgentToolExecution(
  input: AgentToolExecutionCompletion,
): Promise<boolean> {
  return bridge().completeToolExecution(input);
}

export function markAgentToolExecutionCommitted(
  input: AgentToolExecutionCommit,
): Promise<boolean> {
  return bridge().markToolExecutionCommitted(input);
}

export function reportAgentToolExecutionProgress(
  input: AgentToolExecutionProgressRequest,
): Promise<boolean> {
  return bridge().reportToolExecutionProgress(input);
}

export function inspectAgentMedia(
  input: AgentMediaInspectionRequest,
): Promise<import('@/shared/agent/agent.types').AgentToolResult> {
  return bridge().inspectMedia(input);
}

export function extractAgentMediaAudio(
  input: AgentMediaAudioExtractionRequest,
): Promise<AgentMediaAudioExtractionResult> {
  return bridge().extractMediaAudio(input);
}

export function releaseAgentMediaArtifact(
  input: AgentMediaArtifactReleaseRequest,
): Promise<boolean> {
  return bridge().releaseMediaArtifact(input);
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

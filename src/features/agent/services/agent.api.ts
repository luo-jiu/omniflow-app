import type {
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentInteractionSubmissionRequest,
  AgentInteractionSubmissionResult,
  AgentMediaArtifactReleaseRequest,
  AgentMediaArtifactSaveRequest,
  AgentMediaArtifactSaveResult,
  AgentMediaAudioExtractionRequest,
  AgentMediaAudioExtractionResult,
  AgentMediaInspectionRequest,
  AgentMemoryCursor,
  AgentMemoryDeleteRequest,
  AgentMemoryItem,
  AgentMemoryPage,
  AgentMemoryUpdateRequest,
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
  AgentToolPrepareCompletion,
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

export function completeAgentToolPreparation(
  input: AgentToolPrepareCompletion,
): Promise<boolean> {
  return bridge().completeToolPreparation(input);
}

export function resolveAgentToolApproval(
  input: AgentToolApprovalDecisionRequest,
): Promise<AgentToolApprovalDecisionResult> {
  return bridge().resolveToolApproval(input);
}

export function submitAgentInteraction(
  input: AgentInteractionSubmissionRequest,
): Promise<AgentInteractionSubmissionResult> {
  return bridge().submitInteraction(input);
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

export function saveAgentMediaArtifact(
  input: AgentMediaArtifactSaveRequest,
): Promise<AgentMediaArtifactSaveResult> {
  return bridge().saveMediaArtifact(input);
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

export function listAgentMemories(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  query?: string,
  cursor?: AgentMemoryCursor,
): Promise<AgentMemoryPage> {
  return bridge().listMemories(ownerScope, libraryId, query, cursor);
}

export function updateAgentMemory(
  input: AgentMemoryUpdateRequest,
): Promise<AgentMemoryItem> {
  return bridge().updateMemory(input);
}

export function deleteAgentMemory(
  input: AgentMemoryDeleteRequest,
): Promise<boolean> {
  return bridge().deleteMemory(input);
}

export function subscribeAgentChat(
  listener: (event: AgentChatStreamEvent) => void,
): () => void {
  return bridge().onEvent(listener);
}

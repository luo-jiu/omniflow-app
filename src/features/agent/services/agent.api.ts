import type {
  AgentChatRequest,
  AgentChatStartResult,
  AgentChatStreamEvent,
  AgentFileAuthorityCompletionV1,
  AgentFileAuthorityRequestV1,
  AgentInteractionSubmissionRequest,
  AgentInteractionSubmissionResult,
  AgentMediaArtifactReleaseRequest,
  AgentMediaArtifactSaveRequest,
  AgentMediaArtifactSaveResult,
  AgentMediaArtifactUploadRequest,
  AgentMediaArtifactUploadResult,
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
  AgentToolExecutionRequest,
  AgentToolExecutionProgressRequest,
  AgentToolPrepareCompletion,
} from '@/shared/agent/agent.types';
import type {
  AgentShellLogPageRequestV1,
  AgentShellLogPageV1,
  AgentShellPermissionMode,
  AgentShellSettingsSnapshot,
} from '@/shared/agent/shell/agent-shell.types';
import { clearAuthSessionAndDisposeWorkspaces } from '@/service/auth-session-release';
import { auth } from '@/utils/auth';
import type { AgentSessionListFilter, AgentSessionGroupInput, AgentSessionOrganizationInput } from '@/shared/agent/agent-session-management';

function bridge() {
  if (!window.electronAgent) {
    throw new Error('当前环境不支持内置 Agent');
  }
  return window.electronAgent;
}

export function startAgentChat(input: AgentChatRequest): Promise<AgentChatStartResult> {
  return bridge().startChat(input);
}

export function importAgentAttachment(input: import('@/shared/agent/agent-attachments').AgentAttachmentImport) {
  return bridge().importAttachment(input);
}
export function discardAgentAttachment(input: import('@/shared/agent/agent-attachments').AgentAttachmentScope & { id: string }) {
  return bridge().discardAttachment(input);
}
export function previewAgentAttachment(input: import('@/shared/agent/agent-attachments').AgentAttachmentPreviewRequest): Promise<string> {
  return bridge().previewAttachment(input);
}

export function stopAgentChat(sessionId: string): Promise<boolean> {
  return bridge().stopChat(sessionId);
}

export function reconcileAgentPluginOperation(input: Omit<import('@/shared/agent/agent.types').AgentPluginOperationReconcileRequest, 'credentials'>) {
  const token = String(auth.getToken() || '').trim();
  const username = String(auth.getUsername() || '').trim();
  if (!token || !username) throw new Error('登录状态已失效，请重新登录后查询回执');
  return bridge().reconcilePluginOperation({ ...input, credentials: { token, username } });
}

export function verifyAgentToolAccess(request: AgentToolExecutionRequest): Promise<boolean> {
  return bridge().verifyToolAccess({ executionId: request.executionId, ownerScope: request.ownerScope,
    libraryId: Number(request.appContext.libraryId), sessionId: request.sessionId, runId: request.runId });
}

export function releaseAgentOwnerRuns(): Promise<boolean> {
  return bridge().releaseOwner();
}

export function getAgentShellSettings(): Promise<AgentShellSettingsSnapshot> {
  return bridge().getShellSettings();
}

export function updateAgentShellPermissionMode(
  permissionMode: AgentShellPermissionMode,
): Promise<AgentShellSettingsSnapshot> {
  return bridge().updateShellPermissionMode(permissionMode);
}

export function readAgentShellLogPage(
  input: AgentShellLogPageRequestV1,
): Promise<AgentShellLogPageV1> {
  return bridge().readShellLogPage(input);
}

export function completeAgentFileAuthority(
  input: AgentFileAuthorityCompletionV1,
): Promise<boolean> {
  return bridge().completeFileAuthority(input);
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

export interface UploadAgentMediaArtifactInput {
  artifactId: string;
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
}

export async function uploadAgentMediaArtifact(
  input: UploadAgentMediaArtifactInput,
): Promise<AgentMediaArtifactUploadResult> {
  const token = String(auth.getToken() || '').trim();
  const username = String(auth.getUsername() || '').trim();
  if (!token || !username) throw new Error('登录状态已失效，请重新登录');
  const request: AgentMediaArtifactUploadRequest = {
    ...input,
    credentials: { token, username },
  };
  try {
    return await bridge().uploadMediaArtifact(request);
  } catch (error) {
    if (error instanceof Error && error.message.includes('auth_expired')) {
      await clearAuthSessionAndDisposeWorkspaces({
        reason: 'agent media upload auth expired',
        redirectToLogin: true,
      });
      throw new Error('登录状态已失效，请重新登录');
    }
    throw error;
  }
}

export function listAgentSessions(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  query?: string,
  cursor?: AgentSessionCursor,
  filter?: AgentSessionListFilter,
): Promise<AgentSessionPage> {
  return bridge().listSessions(ownerScope, libraryId, query, cursor, filter);
}

export function getAgentSession(
  ownerScope: AgentOwnerScope,
  libraryId: number,
  sessionId: string,
  includeArchived?: boolean,
): Promise<AgentSessionSnapshot> {
  return bridge().getSession(ownerScope, libraryId, sessionId, includeArchived);
}

export const listAgentSessionGroups = (owner: AgentOwnerScope, libraryId: number) => bridge().listGroups(owner, libraryId);
export const saveAgentSessionGroup = (owner: AgentOwnerScope, libraryId: number, input: AgentSessionGroupInput) => bridge().saveGroup(owner, libraryId, input);
export const deleteAgentSessionGroup = (owner: AgentOwnerScope, libraryId: number, id: string, revision: number) => bridge().deleteGroup(owner, libraryId, id, revision);
export const organizeAgentSession = (owner: AgentOwnerScope, libraryId: number, id: string, input: AgentSessionOrganizationInput) => bridge().organizeSession(owner, libraryId, id, input);
export const archiveAgentSession = (owner: AgentOwnerScope, libraryId: number, id: string, archived: boolean, revision: number) => bridge().archiveSession(owner, libraryId, id, archived, revision);

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

export function subscribeAgentFileAuthorityRequests(
  listener: (request: AgentFileAuthorityRequestV1) => void,
): () => void {
  return bridge().onFileAuthorityRequest(listener);
}

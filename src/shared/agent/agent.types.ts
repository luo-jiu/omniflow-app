export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentToolRisk = 'read' | 'write' | 'destructive' | 'external';

export type AgentReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export type AgentRunStatus =
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface AgentOwnerScope {
  accountScope: string;
  backendScope: string;
}

export interface AgentAppContext {
  activeToolId?: string;
  currentDirectory?: {
    id: number;
    name: string;
  };
  libraryId?: number;
  platform: 'darwin' | 'win32' | 'linux' | 'unknown';
  selectedNodeIds: number[];
}

export interface AgentMessage {
  content: string;
  createdAt: string;
  id: string;
  role: AgentMessageRole;
  runId?: string;
  sessionId: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentChatRequest {
  appContext: AgentAppContext;
  model: string;
  ownerScope: AgentOwnerScope;
  perception?: AgentPerceptionSnapshot;
  profileId: string;
  reasoningEffort?: AgentReasoningEffort;
  sessionId?: string;
  userPrompt: string;
}

export interface AgentChatStartResult {
  runId: string;
  sessionId: string;
}

export interface AgentDirectoryEntry {
  ext?: string;
  fileSize?: number;
  id: number;
  mimeType?: string;
  name: string;
  type: 'dir' | 'file';
  updatedAt?: string;
}

export interface AgentPerceptionSnapshot {
  currentDirectory?: {
    entryCount: number;
    entries: AgentDirectoryEntry[];
    id: number;
    name: string;
  };
  selectedNodes: AgentDirectoryEntry[];
  collectedAt: string;
}

export interface AgentToolCallSnapshot {
  id: string;
  input: unknown;
  name: string;
}

export interface AgentActionPreview {
  description: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  risk: AgentToolRisk;
  title: string;
}

export interface AgentToolApprovalSnapshot {
  approvalId: string;
  call: AgentToolCallSnapshot;
  preview: AgentActionPreview;
  runId: string;
  sessionId: string;
}

export interface AgentToolApprovalDecisionRequest {
  approvalId: string;
  approved: boolean;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
}

export interface AgentToolExecutionRequest {
  appContext: AgentAppContext;
  executionId: string;
  input: unknown;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
  toolName: string;
}

export interface AgentMediaInspectionRequest {
  executionId: string;
  fileName: string;
  libraryId: number;
  mimeType?: string;
  nodeId: number;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
  sourceUrl: string;
}

export interface AgentMediaAudioExtractionRequest {
  executionId: string;
  fileName: string;
  libraryId: number;
  mimeType?: string;
  nodeId: number;
  outputFileName: string;
  outputFormat: 'm4a' | 'mp3' | 'wav';
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
  sourceUrl: string;
}

export interface AgentMediaAudioExtractionResult {
  artifactId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AgentMediaArtifactReleaseRequest {
  artifactId: string;
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  runId: string;
  sessionId: string;
}

export type AgentToolApprovalDecisionResult =
  | { approved: false }
  | { approved: true; execution?: AgentToolExecutionRequest };

export interface AgentToolExecutionCompletion {
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  perception?: AgentPerceptionSnapshot;
  result: AgentToolResult;
  runId: string;
  sessionId: string;
}

export interface AgentToolExecutionCommit {
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  result: AgentToolResult;
  runId: string;
  sessionId: string;
}

export interface AgentToolExecutionProgressRequest {
  executionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  progress: AgentToolProgress;
  runId: string;
  sessionId: string;
}

export type AgentChatStreamEvent =
  | { runId: string; sessionId: string; type: 'started' }
  | { delta: string; runId: string; sessionId: string; type: 'delta' }
  | { call: AgentToolCallSnapshot; runId: string; sessionId: string; type: 'tool-started' }
  | { callId: string; progress: AgentToolProgress; runId: string; sessionId: string; type: 'tool-progress' }
  | {
      execution: AgentToolExecutionRequest;
      runId: string;
      sessionId: string;
      type: 'tool-execution-requested';
    }
  | {
      executionId: string;
      runId: string;
      sessionId: string;
      type: 'tool-execution-cancelled';
    }
  | { approval: AgentToolApprovalSnapshot; runId: string; sessionId: string; type: 'tool-approval-required' }
  | {
      approvalId: string;
      approved: boolean;
      runId: string;
      sessionId: string;
      type: 'tool-approval-resolved';
    }
  | { call: AgentToolCallSnapshot; result: AgentToolResult; runId: string; sessionId: string; type: 'tool-completed' }
  | { content: string; messages?: AgentMessage[]; runId: string; sessionId: string; type: 'completed' }
  | { content: string; messages?: AgentMessage[]; runId: string; sessionId: string; type: 'cancelled' }
  | {
      content: string;
      message: string;
      messages?: AgentMessage[];
      runId: string;
      sessionId: string;
      type: 'error';
    };

export interface AgentSessionCursor {
  id: string;
  updatedAt: string;
}

export interface AgentSessionPage {
  nextCursor?: AgentSessionCursor;
  sessions: AgentSessionSummary[];
  total: number;
}

export interface AgentSessionSummary {
  createdAt: string;
  id: string;
  lastMessagePreview: string;
  lastRunStatus?: AgentRunStatus;
  libraryId: number;
  messageCount: number;
  title: string;
  updatedAt: string;
}

export interface AgentSessionSnapshot extends AgentSessionSummary {
  messages: AgentMessage[];
  pendingApprovals: AgentToolApprovalSnapshot[];
}

export interface AgentToolProgress {
  message: string;
  percent?: number;
}

export interface AgentToolResult {
  data?: unknown;
  message?: string;
  ok: boolean;
}

export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentToolRisk = 'read' | 'write' | 'destructive' | 'external';

export type AgentToolPermissionBehavior = 'allow' | 'ask' | 'deny';

export type AgentToolActivityStatus =
  | 'awaiting_approval'
  | 'awaiting_interaction'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentToolApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'interrupted';

export type AgentReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export type AgentRunStatus =
  | 'awaiting_approval'
  | 'awaiting_interaction'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface AgentRunPlanStepSnapshot {
  expectedToolName: string;
  id: string;
  ordinal: number;
  title: string;
}

export interface AgentRunPlanSnapshot {
  createdAt: string;
  steps: AgentRunPlanStepSnapshot[];
  title?: string;
  version: 1;
}

export interface AgentRunSnapshot {
  createdAt: string;
  currentStep?: string;
  error?: string;
  finishedAt?: string;
  id: string;
  model: string;
  plan?: AgentRunPlanSnapshot;
  profileId: string;
  reasoningEffort: AgentReasoningEffort;
  revision: number;
  sessionId: string;
  status: AgentRunStatus;
  updatedAt: string;
  userPrompt: string;
}

export interface AgentOwnerScope {
  accountScope: string;
  backendScope: string;
}

export type AgentMemoryKind = 'preference' | 'project' | 'reference';

export type AgentMemoryScope = 'global' | 'library';

export interface AgentMemoryProposal {
  application: string;
  content: string;
  kind: AgentMemoryKind;
  reason: string;
  scope: AgentMemoryScope;
  title: string;
}

export interface AgentMemoryItem extends AgentMemoryProposal {
  createdAt: string;
  id: string;
  libraryId?: number;
  revision: number;
  sourceRunId?: string;
  sourceSessionId?: string;
  updatedAt: string;
}

export interface AgentMemoryCursor {
  id: string;
  updatedAt: string;
}

export interface AgentMemoryPage {
  memories: AgentMemoryItem[];
  nextCursor?: AgentMemoryCursor;
  total: number;
}

export interface AgentMemoryUpdateRequest {
  application: string;
  content: string;
  id: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  reason: string;
  revision: number;
  title: string;
}

export interface AgentMemoryDeleteRequest {
  id: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  revision: number;
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

export interface AgentToolActivityApproval {
  approvalId: string;
  decidedAt?: string;
  preview: AgentActionPreview;
  status: AgentToolApprovalStatus;
}

export type AgentInteractionStatus =
  | 'pending'
  | 'submitted'
  | 'expired'
  | 'cancelled'
  | 'interrupted';

export interface AgentInteractionOption {
  description?: string;
  id: string;
  label: string;
}

export interface AgentInteractionField {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type: 'text' | 'number' | 'boolean' | 'select';
  values?: Array<{ id: string; label: string }>;
}

export type AgentInteractionRequest =
  | {
      kind: 'choice';
      multiple?: boolean;
      options: AgentInteractionOption[];
      prompt: string;
      submitLabel?: string;
      title?: string;
    }
  | {
      fields: AgentInteractionField[];
      kind: 'form';
      prompt: string;
      submitLabel?: string;
      title?: string;
    };

export type AgentInteractionValue = string | number | boolean;

export type AgentInteractionResponse =
  | {
      kind: 'choice';
      selectedOptionIds: string[];
    }
  | {
      kind: 'form';
      values: Record<string, AgentInteractionValue>;
    };

export interface AgentToolActivityInteraction {
  decidedAt?: string;
  interactionId: string;
  request: AgentInteractionRequest;
  response?: AgentInteractionResponse;
  status: AgentInteractionStatus;
}

export interface AgentToolActivitySnapshot {
  approval?: AgentToolActivityApproval;
  call: AgentToolCallSnapshot;
  createdAt: string;
  finishedAt?: string;
  id: string;
  interaction?: AgentToolActivityInteraction;
  ordinal: number;
  permissionBehavior: AgentToolPermissionBehavior;
  planStepId?: string;
  progress?: AgentToolProgress;
  progressUpdatedAt?: string;
  revision: number;
  result?: AgentToolResult;
  runId: string;
  sessionId: string;
  status: AgentToolActivityStatus;
}

export interface AgentInteractionSubmissionRequest {
  interactionId: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  response: AgentInteractionResponse;
  runId: string;
  sessionId: string;
}

export interface AgentInteractionSubmissionResult {
  activity: AgentToolActivitySnapshot;
  accepted: true;
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
  | { run: AgentRunSnapshot; runId: string; sessionId: string; type: 'started' }
  | { run: AgentRunSnapshot; runId: string; sessionId: string; type: 'run-updated' }
  | { delta: string; runId: string; sessionId: string; type: 'delta' }
  | {
      activity?: AgentToolActivitySnapshot;
      call: AgentToolCallSnapshot;
      runId: string;
      sessionId: string;
      type: 'tool-started';
    }
  | {
      activity?: AgentToolActivitySnapshot;
      callId: string;
      progress: AgentToolProgress;
      runId: string;
      sessionId: string;
      type: 'tool-progress';
    }
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
  | {
      activity?: AgentToolActivitySnapshot;
      approval: AgentToolApprovalSnapshot;
      runId: string;
      sessionId: string;
      type: 'tool-approval-required';
    }
  | {
      activity?: AgentToolActivitySnapshot;
      approvalId: string;
      approved: boolean;
      runId: string;
      sessionId: string;
      type: 'tool-approval-resolved';
    }
  | {
      activity: AgentToolActivitySnapshot;
      interactionId: string;
      runId: string;
      sessionId: string;
      type: 'tool-interaction-required';
    }
  | {
      activity: AgentToolActivitySnapshot;
      interactionId: string;
      runId: string;
      sessionId: string;
      type: 'tool-interaction-resolved';
    }
  | {
      activity?: AgentToolActivitySnapshot;
      call: AgentToolCallSnapshot;
      result: AgentToolResult;
      runId: string;
      sessionId: string;
      type: 'tool-completed';
    }
  | {
      content: string;
      messages?: AgentMessage[];
      run?: AgentRunSnapshot;
      runId: string;
      sessionId: string;
      toolActivities?: AgentToolActivitySnapshot[];
      type: 'completed';
    }
  | {
      content: string;
      messages?: AgentMessage[];
      run?: AgentRunSnapshot;
      runId: string;
      sessionId: string;
      toolActivities?: AgentToolActivitySnapshot[];
      type: 'cancelled';
    }
  | {
      content: string;
      message: string;
      messages?: AgentMessage[];
      run?: AgentRunSnapshot;
      runId: string;
      sessionId: string;
      toolActivities?: AgentToolActivitySnapshot[];
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
  runs: AgentRunSnapshot[];
  toolActivities: AgentToolActivitySnapshot[];
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

export type AgentArtifactKind =
  | 'audio'
  | 'directory'
  | 'file'
  | 'image'
  | 'other'
  | 'subtitle'
  | 'video';

export interface AgentArtifactReference {
  id: string;
  kind: AgentArtifactKind;
  libraryId?: number;
  mimeType?: string;
  name: string;
  nodeId?: number;
}

export type AgentPresentationAction =
  | {
      action: 'artifact.preview';
      artifact: AgentArtifactReference;
      label: string;
    }
  | {
      action: 'tree.revealNode';
      label: string;
      libraryId: number;
      nodeId: number;
    }
  | {
      action: 'workspace.openNode';
      label: string;
      libraryId: number;
      nodeId: number;
    }
  | {
      action: 'agent.interaction.submit';
      interactionId: string;
      label: string;
      response: AgentInteractionResponse;
    };

export type AgentPresentationTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type AgentPresentationBlock =
  | {
      detail?: string;
      label: string;
      tone: AgentPresentationTone;
      type: 'status';
    }
  | {
      label: string;
      percent?: number;
      type: 'progress';
    }
  | {
      approvalId: string;
      type: 'approval';
    }
  | {
      actions?: AgentPresentationAction[];
      artifact: AgentArtifactReference;
      type: 'artifact';
    }
  | {
      entries: Array<{ label: string; value: string }>;
      title?: string;
      type: 'details';
    }
  | {
      interactionId: string;
      multiple?: boolean;
      options: AgentInteractionOption[];
      prompt: string;
      response?: Extract<AgentInteractionResponse, { kind: 'choice' }>;
      status: AgentInteractionStatus;
      submitLabel?: string;
      title?: string;
      type: 'choice';
    }
  | {
      fields: AgentInteractionField[];
      interactionId: string;
      prompt: string;
      response?: Extract<AgentInteractionResponse, { kind: 'form' }>;
      status: AgentInteractionStatus;
      submitLabel?: string;
      title?: string;
      type: 'form';
    }
  | {
      message: string;
      title?: string;
      tone: AgentPresentationTone;
      type: 'notice';
    };

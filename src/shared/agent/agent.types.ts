export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentToolRisk = 'read' | 'write' | 'destructive' | 'external';

export type AgentReasoningEffort = 'auto' | 'low' | 'medium' | 'high';

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

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

export type AgentChatStreamEvent =
  | { runId: string; sessionId: string; type: 'started' }
  | { delta: string; runId: string; sessionId: string; type: 'delta' }
  | { call: AgentToolCallSnapshot; runId: string; sessionId: string; type: 'tool-started' }
  | { callId: string; progress: AgentToolProgress; runId: string; sessionId: string; type: 'tool-progress' }
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

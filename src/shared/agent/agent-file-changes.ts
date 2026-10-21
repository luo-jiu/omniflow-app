import type { AgentOwnerScope } from './agent.types';

export interface AgentFileChangeScope {
  ownerScope: AgentOwnerScope;
  libraryId: number;
  sessionId: string;
}

export interface AgentFileChangeListRequest extends AgentFileChangeScope {
  runIds: string[];
}

export interface AgentFileChangeSummary {
  id: string;
  operationId: string;
  runId: string;
  toolRunId: string;
  scope: 'library' | 'host';
  path: string;
  nodeId?: number;
  kind: 'create' | 'update';
  state: 'committed' | 'uncommitted' | 'commit_unknown';
  available: boolean;
  beforeRevision?: string;
  afterRevision: string;
  createdAt: number;
}

export interface AgentFileChangeList {
  changes: AgentFileChangeSummary[];
  truncated: boolean;
  coverage: 'structured-file-writes';
}

export interface AgentFileDiffRequest extends AgentFileChangeScope {
  changeId: string;
  /** Optional end of a continuous, committed chain within one actual Run. */
  throughChangeId?: string;
  /** Opaque main-owned page reference; never a snapshot path. */
  cursor?: string;
  /** Default 200, maximum 500. A long logical line can span pages. */
  pageLines?: number;
  /** Optional request identity used only for cancelling a read in the same frame. */
  requestId?: string;
}

export interface AgentFileDiffCancelRequest extends AgentFileChangeScope {
  requestId: string;
}

export interface AgentFileDiffPage {
  index: number;
  totalPages: number;
  startLine: number;
  endLine: number;
  totalLines: number;
  continuedFromPrevious: boolean;
  continuesOnNext: boolean;
  previousCursor?: string;
  nextCursor?: string;
}

export interface AgentFileDiffResult {
  path: string;
  scope: 'library' | 'host';
  state: AgentFileChangeSummary['state'];
  available: boolean;
  patch: string;
  truncated: boolean;
  baseline: 'operation' | 'run';
  warning?: string;
  /** Absent only on legacy responses or when no retained snapshot is available. */
  page?: AgentFileDiffPage;
}

/** Private IPC only: never a Tool input/result or a provider history field. */
export interface AgentFileChangePrepareRequest extends AgentFileChangeScope {
  executionId: string;
  runId: string;
  snapshot: {
    path: string;
    nodeId?: number;
    beforeBase64: string | null;
    afterBase64: string;
    beforeRevision?: string;
    afterRevision: string;
  };
}

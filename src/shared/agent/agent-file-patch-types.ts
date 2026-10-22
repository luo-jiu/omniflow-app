import { AgentFileMutationError } from './agent-file-write';

export type AgentFilePatchFormat = 'unified-v1' | 'context-v1';
export type AgentFileFinalNewline = 'preserve' | 'ensure' | 'remove';
export interface AgentFilePatchSpec {
  patch: string;
  path: string;
  format: AgentFilePatchFormat;
  finalNewline?: AgentFileFinalNewline;
}
export interface AgentFilePatchDiagnostic {
  code: string;
  phase: 'parse' | 'match' | 'finalize';
  hunkIndex?: number;
  patchLine?: number;
  candidateRanges?: { startLine: number; endLine: number }[];
  candidatesTruncated?: boolean;
  suggestedRead?: { offset: number; limit: number };
  nextAction?: 'fix_input' | 'read_context' | 'reduce_patch';
}
export class AgentFilePatchError extends AgentFileMutationError {
  constructor(message: string, readonly diagnostic: AgentFilePatchDiagnostic) {
    super(diagnostic.code, message);
    this.name = 'AgentFilePatchError';
  }
}
export interface AgentFilePatchResult {
  bytes: Uint8Array;
  additions: number;
  deletions: number;
  hunks: number;
  changed: boolean;
  matchMode: 'exact' | 'context-trailing-whitespace';
  warnings: string[];
  endsWithNewline: boolean;
}
export interface AgentFilePatchExecutionOptions {
  signal?: AbortSignal;
  /** Absolute Unix timestamp in milliseconds; default is ten seconds after invocation. */
  deadlineMs?: number;
  /** Number of source characters / comparison characters charged during planning. */
  maxScanWork?: number;
  /** Called periodically between bounded increments; defaults to a zero-delay timer. */
  yieldControl?: () => Promise<void>;
}

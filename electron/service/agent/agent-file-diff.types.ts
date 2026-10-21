export const AGENT_DIFF_PAGE_CHARACTERS = 32 * 1024;
export const AGENT_DIFF_MAX_CHARACTERS = 4 * 1024 * 1024;
export const AGENT_DIFF_MAX_SOURCE_LINES = 200_000;
export const AGENT_DIFF_MAX_PAGES = 4096;

export interface AgentFileDiffJob {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  pageLines: number;
}

export interface AgentFileDiffWorkerPage {
  patch: string;
  startLine: number;
  endLine: number;
  continuedFromPrevious: boolean;
  continuesOnNext: boolean;
}

export interface AgentFileDiffComputation {
  pages: AgentFileDiffWorkerPage[];
  totalLines: number;
  truncated: boolean;
  warning?: string;
}

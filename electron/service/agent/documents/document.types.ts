export type AgentDocumentFormat = 'pdf' | 'docx';
export interface AgentDocumentJob {
  format: AgentDocumentFormat;
  operation: 'inspect' | 'read' | 'render';
  bytes: Uint8Array;
  page?: number;
}
export interface AgentDocumentResult {
  pageCount?: number;
  page?: number;
  text?: string;
  png?: Uint8Array;
  width?: number;
  height?: number;
  warnings?: string[];
}

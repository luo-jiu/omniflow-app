export type AgentDocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx';
export interface AgentSheetFilter { column: string; operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'; value: string | number | boolean }
export interface AgentSheetAggregate { column: string; operation: 'sum' | 'average' | 'min' | 'max' | 'count' }
export interface AgentDocumentJob {
  format: AgentDocumentFormat;
  operation: 'inspect' | 'read' | 'render' | 'query';
  bytes: Uint8Array;
  page?: number;
  sheet?: string;
  range?: string;
  filters?: AgentSheetFilter[];
  aggregate?: AgentSheetAggregate;
}
export interface AgentDocumentResult {
  pageCount?: number;
  page?: number;
  text?: string;
  png?: Uint8Array;
  width?: number;
  height?: number;
  warnings?: string[];
  sheets?: Array<{ name: string; rowCount: number; columnCount: number; state: string }>;
  sheet?: string;
  range?: string;
  matchedRows?: number;
  unknownFilterRows?: number;
  statistics?: { operation: string; value: number | null; numericCount: number; missingCachedValues: number; excludedValues: number; complete: boolean };
  renderAllowed?: boolean;
}

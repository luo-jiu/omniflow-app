export const PROTOCOL_VERSION: 1;
export const LIMITS: Readonly<{
  directoryEntries: number; directoryPageSize: number; directoryHandles: number; directoryReadTotalBytes: number; directoryRequests: number;
  requestBytes: number; responseBytes: number; concurrentRequests: number; requestsPerSecond: number;
  requestsPerInstance: number; readChunkBytes: number; readTotalBytes: number; requestTimeoutMs: number;
  clientTimeoutMs: number; settingBytes: number; settingsTotalBytes: number; settingsKeys: number;
  packageBytes: number; packageFiles: number; packageFileBytes: number; instances: number;
  snapshotBytes: number; snapshotsTotalBytes: number; snapshots: number;
  startupTimeoutMs: number; heartbeatMs: number; heartbeatTimeoutMs: number;
  toolResultBytes: number; toolRequestBytes: number; toolTimeoutMs: number;
  fileOutputBytes: number; fileOutputRequestBytes: number;
}>;
export class PluginError extends Error { readonly code: string; constructor(code: string, message: string); }
export interface PluginTransport { exchange(request: string): Promise<string>; subscribe(listener: (event: string) => void): () => void; }
export interface ThemeSnapshot { schemaVersion: 1; revision: number; mode: 'light' | 'dark'; colors: Readonly<Record<string, string>>; }
export interface DirectoryEntry { id: string; name: string; size: number; mimeType: string; }
export interface ResourceReference { kind?: 'file' | 'directory'; handle: string; name: string; size: number; revision: string; }
interface PluginContextBase { pluginId: string; capabilities: readonly string[]; resource: ResourceReference | null; readGranted: boolean; theme: ThemeSnapshot; }
export interface PluginViewerContext extends PluginContextBase { kind?: 'viewer'; viewerId: string; }
export interface PluginToolContext extends PluginContextBase { kind: 'tool'; toolId: string; output?: PluginFileOutputDeclaration; }
export interface PluginWorkspaceContext extends PluginContextBase { kind: 'workspace'; workspaceId: string; commandId: string; }
export type PluginContext = PluginViewerContext | PluginToolContext | PluginWorkspaceContext;
export interface PluginToolSchema {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, PluginToolSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: PluginToolSchema;
  minItems?: number; maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number;
  enum?: Array<string | number | boolean | null>;
}
interface PluginToolContributionBase {
  id: string; title: string; description: string; entry: string;
  inputSchema: PluginToolSchema; timeoutMs: number;
}
interface PluginJsonToolContributionBase extends PluginToolContributionBase {
  outputSchema: PluginToolSchema; maxResultBytes: number;
}
export interface PluginReadToolContribution extends PluginJsonToolContributionBase {
  kind?: undefined;
  resourceAccess: [{ parameter: 'resource'; mode: 'read'; kind: 'file' }];
}
export interface PluginRenameProposalToolContribution extends PluginJsonToolContributionBase {
  kind: 'rename-proposal';
  resourceAccess: [{ parameter: 'resources'; mode: 'metadata'; kind: 'file'; maxItems: 50 }];
}
export type PluginFileOutputMediaType = 'text/csv' | 'application/json';
export interface PluginFileOutputDeclaration { mediaTypes: PluginFileOutputMediaType[]; maxBytes: number; }
export interface PluginFileOutput { mediaType: PluginFileOutputMediaType; text: string; }
export interface PluginFileOutputToolContribution extends PluginToolContributionBase {
  kind: 'file-output';
  resourceAccess: [{ parameter: 'resource'; mode: 'read'; kind: 'file' }];
  output: PluginFileOutputDeclaration;
  outputSchema?: never; maxResultBytes?: never;
}
export type PluginToolContribution = PluginReadToolContribution | PluginRenameProposalToolContribution | PluginFileOutputToolContribution;
export type PluginCommandLocation = 'file-menu' | 'tool-workspace';
/** Declarative manual entry for one tool in the same package; it grants no resource access. */
export interface PluginCommandContribution {
  id: string; title: string; toolId: string; locations: PluginCommandLocation[];
}
/** Isolated custom UI for a single-file manual command in the same package. */
export interface PluginWorkspaceContribution { id: string; title: string; entry: string; commandId: string; }
export interface PluginMetadataFile { id: string; name: string; }
export interface PluginRenameProposal { changes: Array<{ id: string; name: string }>; }
export interface PluginRenameProposalInput { parameters: Record<string, unknown>; files: PluginMetadataFile[]; }
export interface PluginToolInvocation { invocationId: string; toolId: string; input: Record<string, unknown>; }
export type PluginToolFailureCode = 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'FAILED';
export interface Setting { value: unknown; revision: number; schemaVersion: number; }
export type PluginEvent = { version: 1; type: 'theme'; theme: ThemeSnapshot } | { version: 1; type: 'activity'; active: boolean };
export interface PluginClient {
  context(): Promise<PluginContext>;
  ready(): Promise<null>;
  /** Requests host-owned preparation only; no output destination or write approval is accepted. */
  prepareWorkspaceCommand(parameters: Record<string, unknown>): Promise<{ requestId: string }>;
  toolInvocation(): Promise<PluginToolInvocation>;
  completeTool(invocationId: string, output: unknown): Promise<null>;
  completeFileOutput(invocationId: string, output: PluginFileOutput): Promise<null>;
  failTool(invocationId: string, code: PluginToolFailureCode): Promise<null>;
  read(handle: string, offset: number, length: number, options?: { signal?: AbortSignal }): Promise<{ bytes: Uint8Array; nextOffset: number; eof: boolean; revision: string }>;
  listDirectory(handle: string, offset?: number, options?: { signal?: AbortSignal }): Promise<{ entries: DirectoryEntry[]; nextOffset: number; eof: boolean; revision: string }>;
  openDirectoryEntry(handle: string, entryId: string, options?: { signal?: AbortSignal }): Promise<ResourceReference>;
  releaseResource(handle: string): Promise<null>;
  getState(): Promise<Setting | null>;
  setState(value: unknown, expectedRevision: number, schemaVersion?: number): Promise<Setting>;
  getSetting(key: string): Promise<Setting | null>;
  setSetting(key: string, value: unknown, expectedRevision: number, schemaVersion?: number): Promise<Setting>;
  subscribe(listener: (event: PluginEvent) => void): () => void;
  dispose(): void;
}
export function createPluginClient(transport?: PluginTransport): PluginClient;

export const PROTOCOL_VERSION: 1;
export const LIMITS: Readonly<{
  requestBytes: number; responseBytes: number; concurrentRequests: number; requestsPerSecond: number;
  requestsPerInstance: number; readChunkBytes: number; readTotalBytes: number; requestTimeoutMs: number;
  clientTimeoutMs: number; settingBytes: number; settingsTotalBytes: number; settingsKeys: number;
  packageBytes: number; packageFiles: number; packageFileBytes: number; instances: number;
  snapshotBytes: number; snapshotsTotalBytes: number; snapshots: number;
  startupTimeoutMs: number; heartbeatMs: number; heartbeatTimeoutMs: number;
}>;
export class PluginError extends Error { readonly code: string; constructor(code: string, message: string); }
export interface PluginTransport { exchange(request: string): Promise<string>; subscribe(listener: (event: string) => void): () => void; }
export interface ThemeSnapshot { schemaVersion: 1; revision: number; mode: 'light' | 'dark'; colors: Readonly<Record<string, string>>; }
export interface ResourceReference { handle: string; name: string; size: number; revision: string; }
export interface PluginContext { pluginId: string; viewerId: string; capabilities: readonly string[]; resource: ResourceReference | null; readGranted: boolean; theme: ThemeSnapshot; }
export interface Setting { value: unknown; revision: number; schemaVersion: number; }
export type PluginEvent = { version: 1; type: 'theme'; theme: ThemeSnapshot } | { version: 1; type: 'activity'; active: boolean };
export interface PluginClient {
  context(): Promise<PluginContext>;
  ready(): Promise<null>;
  read(handle: string, offset: number, length: number, options?: { signal?: AbortSignal }): Promise<{ bytes: Uint8Array; nextOffset: number; eof: boolean; revision: string }>;
  getState(): Promise<Setting | null>;
  setState(value: unknown, expectedRevision: number, schemaVersion?: number): Promise<Setting>;
  getSetting(key: string): Promise<Setting | null>;
  setSetting(key: string, value: unknown, expectedRevision: number, schemaVersion?: number): Promise<Setting>;
  subscribe(listener: (event: PluginEvent) => void): () => void;
  dispose(): void;
}
export function createPluginClient(transport?: PluginTransport): PluginClient;

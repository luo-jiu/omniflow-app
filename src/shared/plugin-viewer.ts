import type { ThemeSnapshot, Setting } from '../../packages/plugin-sdk/index.js';
export interface PluginViewerSnapshot { packageFingerprint?: string; resourceRevision: string; state: Setting }
export interface PluginViewerOpen {
  clientId: string; viewerId: string; nodeId: number; libraryId: number; token: string; username: string;
  theme: ThemeSnapshot; snapshot: PluginViewerSnapshot | null;
}
export type PluginViewerEvent = { clientId: string; type: 'state'; snapshot: PluginViewerSnapshot } | { clientId: string; type: 'stopped'; reason: string };
export interface PluginViewerBridge {
  available: boolean;
  open(input: PluginViewerOpen): Promise<{ ok: boolean; code?: string }>;
  close(clientId: string): Promise<void>;
  release(): Promise<void>;
  layout(clientId: string, bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  theme(clientId: string, theme: ThemeSnapshot): Promise<void>;
  subscribe(listener: (event: PluginViewerEvent) => void): () => void;
}

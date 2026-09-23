import type { ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import type { AgentOwnerScope } from '../agent/agent.types';

export interface PluginWorkspaceDestination { parentId: number; fileName: string }
export interface PluginWorkspaceOpen {
  clientId: string;
  workspaceId: string;
  libraryId: number;
  nodeId: number;
  ownerScope: AgentOwnerScope;
  token: string;
  username: string;
  theme: ThemeSnapshot;
  destination?: PluginWorkspaceDestination;
}
export type PluginWorkspaceEvent =
  | { clientId: string; type: 'stopped'; reason: string }
  | { clientId: string; type: 'preparing'; requestId: string }
  | { clientId: string; type: 'execution'; requestId: string; executionId: string }
  | { clientId: string; type: 'error'; requestId?: string; code: string };
export interface PluginWorkspaceBridge {
  open(input: PluginWorkspaceOpen): Promise<{ ok: boolean; code?: string }>;
  close(clientId: string): Promise<void>;
  release(): Promise<void>;
  layout(clientId: string, bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  theme(clientId: string, theme: ThemeSnapshot): Promise<void>;
  destination(clientId: string, destination: PluginWorkspaceDestination | null): Promise<void>;
  subscribe(listener: (event: PluginWorkspaceEvent) => void): () => void;
}

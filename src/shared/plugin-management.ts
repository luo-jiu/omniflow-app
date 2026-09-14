export interface ManagedPlugin {
  id: string; version: string; fingerprint: string; enabled: boolean; readApproved: boolean;
  source: 'bundled' | 'local'; installedAt: string; previousVersion?: string;
  viewers: Array<{ id: string; title: string; extensions: string[] }>;
  permissions: string[]; blockedReason?: string; running: number;
}
export interface PluginCatalog { revision: number; safeMode: boolean; settingsRecoveryRequired?: boolean; recoveryReason?: string; plugins: ManagedPlugin[]; logs: Array<{ time: string; pluginId?: string; action: string; code: string; instanceId?: string; requestTag?: string }> }
export interface PluginInstallReview { ticket: string; id: string; version: string; fingerprint: string; previousVersion?: string; permissions: string[]; addedPermissions: string[]; fileName: string }
export type PluginManagementAction = 'enable' | 'disable' | 'approve-read' | 'revoke-read' | 'uninstall' | 'rollback' | 'clear-data';
export interface PluginManagementBridge {
  catalog(): Promise<PluginCatalog>;
  choosePackage(): Promise<PluginInstallReview | null>;
  commit(ticket: string): Promise<PluginCatalog>;
  discard(ticket: string): Promise<void>;
  action(id: string, action: PluginManagementAction): Promise<PluginCatalog>;
  safeMode(enabled: boolean): Promise<PluginCatalog>;
  repairSettings(): Promise<PluginCatalog>;
  subscribe(listener: (catalog: PluginCatalog) => void): () => void;
}

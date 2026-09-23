import type { PluginCommandContribution, PluginToolContribution } from '../../packages/plugin-sdk/index.js';

export interface ManagedPlugin {
  id: string; version: string; fingerprint: string; enabled: boolean; readApproved: boolean; toolApproved?: boolean; renameApproved?: boolean; outputApproved?: boolean;
  source: 'bundled' | 'local'; installedAt: string; previousVersion?: string;
  viewers: Array<{ id: string; title: string; extensions: string[]; directoryTypes?: Array<'COMIC'> }>;
  agentTools?: PluginToolContribution[];
  commands?: PluginCommandContribution[];
  permissions: string[]; blockedReason?: string; running: number;
}
/** Manual commands use declared resource capabilities; Agent access remains an independent grant. */
export function isPluginCommandAllowed(plugin: ManagedPlugin, command: PluginCommandContribution): boolean {
  if (!plugin.enabled || plugin.blockedReason || !command.id.startsWith(`${plugin.id}.`)
    || !plugin.commands?.some(item => item.id === command.id && item.toolId === command.toolId)) return false;
  const tool = plugin.agentTools?.find(item => item.id === command.toolId && item.id.startsWith(`${plugin.id}.`));
  if (!tool) return false;
  return tool.kind === 'rename-proposal'
    ? Boolean(plugin.renameApproved && plugin.permissions.includes('resource.rename.propose'))
    : tool.kind === 'file-output'
      ? Boolean(plugin.readApproved && plugin.outputApproved && plugin.permissions.includes('resource.read') && plugin.permissions.includes('resource.output.propose'))
      : Boolean(plugin.readApproved && plugin.permissions.includes('resource.read'));
}
export interface PluginCatalog { revision: number; safeMode: boolean; settingsRecoveryRequired?: boolean; recoveryReason?: string; plugins: ManagedPlugin[]; logs: Array<{ time: string; pluginId?: string; action: string; code: string; instanceId?: string; requestTag?: string }> }
export interface PluginInstallReview { ticket: string; id: string; version: string; fingerprint: string; previousVersion?: string; permissions: string[]; addedPermissions: string[]; fileName: string }
export type PluginManagementAction = 'enable' | 'disable' | 'approve-read' | 'revoke-read' | 'approve-tools' | 'revoke-tools' | 'approve-rename' | 'revoke-rename' | 'approve-output' | 'revoke-output' | 'uninstall' | 'rollback' | 'clear-data';
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

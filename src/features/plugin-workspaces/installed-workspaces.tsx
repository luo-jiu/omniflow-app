import { createElement, type ComponentType } from 'react';
import { Puzzle } from 'lucide-react';
import { pluginManagementApi } from '@/service/plugins/plugin-management.api';
import { isPluginWorkspaceAllowed } from '@/shared/plugin-management';
import { toolRegistry } from '@/features/tool-workspace/tool-registry';
import type { ToolContributionContext } from '@/features/tool-workspace/tool-contribution.types';
import type { ToolWorkspaceToolId } from '@/features/tool-workspace/types';
import type { PluginWorkspaceProps } from './PluginWorkspace';

/** Catalog changes replace only affected component types, preserving other tool drafts. */
export function installManagedWorkspaceContributions(View: ComponentType<PluginWorkspaceProps>) {
  const installed = new Map<string, { signature: string; release: () => void }>();
  const sync = () => {
    const catalog = pluginManagementApi.getSnapshot();
    if (!catalog) return;
    const available = catalog.plugins.flatMap(plugin => {
      if (catalog.settingsRecoveryRequired || (catalog.safeMode && plugin.source === 'local')) return [];
      const workspaces = (plugin.workspaces ?? []).filter(workspace => isPluginWorkspaceAllowed(plugin, workspace));
      return workspaces.length ? [{ plugin, workspaces }] : [];
    });
    for (const [id, entry] of installed) if (!available.some(item => item.plugin.id === id)) {
      entry.release(); installed.delete(id);
    }
    for (const { plugin, workspaces } of available) {
      const signature = JSON.stringify([plugin.fingerprint, workspaces]);
      if (installed.get(plugin.id)?.signature === signature) continue;
      installed.get(plugin.id)?.release();
      const release = toolRegistry.registerBatch(plugin.id, workspaces.map(workspace => ({
        id: workspace.id as ToolWorkspaceToolId,
        title: workspace.title,
        icon: <Puzzle size={18} aria-hidden="true" />,
        View: (context: ToolContributionContext) => createElement(View, { ...context, workspaceId: workspace.id }),
      })));
      installed.set(plugin.id, { signature, release });
    }
  };
  const unsubscribe = pluginManagementApi.subscribe(sync);
  pluginManagementApi.start(); sync();
  return () => { unsubscribe(); for (const entry of installed.values()) entry.release(); installed.clear(); };
}

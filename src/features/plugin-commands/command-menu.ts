import { isPluginCommandAllowed, type PluginCatalog } from '@/shared/plugin-management';

export const PLUGIN_COMMAND_MENU_PREFIX = 'plugin-command:';

/** Display-only projection. Main revalidates package identity and permissions on invocation. */
export function getPluginCommandMenuItems(catalog: PluginCatalog | null, fileCount: number) {
  if (!catalog || fileCount < 1 || fileCount > 50) return [];
  return catalog.plugins.flatMap(plugin => (plugin.commands ?? []).filter(command => {
    if (!command.locations.includes('file-menu') || !isPluginCommandAllowed(plugin, command)) return false;
    const tool = plugin.agentTools?.find(item => item.id === command.toolId);
    return tool?.kind === 'rename-proposal' || fileCount === 1;
  }).map(command => ({ id: command.id, title: `${command.title} · ${plugin.id}` })));
}

export function resolvePluginCommandMenuAction(action: string, captured: ReadonlyArray<{ id: string }>, current: ReadonlyArray<{ id: string }>) {
  if (!action.startsWith(PLUGIN_COMMAND_MENU_PREFIX)) return null;
  const commandId = action.slice(PLUGIN_COMMAND_MENU_PREFIX.length);
  if (!captured.some(item => item.id === commandId) || !current.some(item => item.id === commandId)) {
    throw new Error('此插件命令当前不可用，请重新打开菜单');
  }
  return commandId;
}

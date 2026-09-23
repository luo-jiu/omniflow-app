import { ipcMain, type BrowserWindow } from 'electron';
import type { PluginWorkspaceBridge } from '../../../src/shared/plugins/workspace.types';
import type { PluginManager } from './plugin-manager';
import { getPluginCommandService } from './plugin-command-ipc';
import { createPluginWorkspaceService } from './plugin-workspace-service';
import { PluginFault } from './resource-broker';

declare const __OMNIFLOW_STORAGE_ORIGINS__: string[];
let service: ReturnType<typeof createPluginWorkspaceService> | undefined;
export function registerPluginWorkspaceIpc(manager: PluginManager, getMainWindow: () => BrowserWindow | null) {
  service = createPluginWorkspaceService({ manager, getMainWindow, commands: getPluginCommandService,
    apiBaseUrl: __OMNIFLOW_API_BASE_URL__, storageOrigins: __OMNIFLOW_STORAGE_ORIGINS__ });
  const tracked = new Set<number>();
  const bind = <K extends Exclude<keyof PluginWorkspaceBridge, 'subscribe'>>(name: K) => {
    ipcMain.handle(`plugin-workspace:${name}`, async (event, ...args: Parameters<PluginWorkspaceBridge[K]>) => {
      const parent = getMainWindow();
      if (!parent || parent.isDestroyed() || event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame) throw new Error('插件工作区来源无效');
      if (!service) throw new Error('插件工作区不可用');
      if (!tracked.has(event.sender.id)) {
        const senderId = event.sender.id;
        tracked.add(senderId);
        const release = () => { service?.releaseOwner(senderId); getPluginCommandService()?.releaseOwner(senderId); };
        event.sender.once('destroyed', () => { release(); tracked.delete(senderId); });
        event.sender.on('render-process-gone', release);
        event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) release(); });
      }
      try {
        return await (service[name] as (sender: Electron.WebContents, ...values: unknown[]) => unknown)(event.sender, ...args);
      } catch (error) {
        const code = error instanceof PluginFault && ['FORBIDDEN', 'BAD_REQUEST', 'CONFLICT', 'LIMIT', 'CANCELLED', 'CONTENT_CHANGED'].includes(error.code) ? error.code : 'UNAVAILABLE';
        throw new Error(`插件工作区操作失败（${code}）`);
      }
    });
  };
  bind('open'); bind('close'); bind('release'); bind('layout'); bind('theme'); bind('destination');
}
export function disposePluginWorkspaceService() { service?.dispose(); service = undefined; }

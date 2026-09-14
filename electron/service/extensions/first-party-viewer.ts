import type { PluginManager } from './plugin-manager';
import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import { PluginDevelopmentHost, type IsolatedPluginInstance } from './isolated-view';
import { PluginReadingStateMemory, PluginFault } from './resource-broker';
import { openLibraryResource } from './library-resource';
import type { PluginViewerOpen, PluginViewerEvent, PluginViewerSnapshot } from '../../../src/shared/plugin-viewer';
import type { ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';

declare const __OMNIFLOW_STORAGE_ORIGINS__: string[];
/** 第一方固定包入口；不接受 renderer 提供包路径或正文 URL。 */
export function registerFirstPartyViewer(getMainWindow: () => BrowserWindow | null, options: { apiBaseUrl?: string; storageOrigins?: readonly string[]; packageDirectory?: string; preloadPath?: string; manager?: PluginManager } = {}) {
  let host: PluginDevelopmentHost | undefined;
  const entries = new Map<string, { controller: AbortController; instance?: IsolatedPluginInstance; bounds: Electron.Rectangle | null; pluginId: string; counted: boolean }>();
  const stop = (id: string) => { const entry = entries.get(id); if (!entry) return; entries.delete(id); entry.controller.abort(); entry.instance?.stop('closed'); if (entry.counted) options.manager?.stopped(entry.pluginId,'closed'); };
  options.manager?.attachRuntime(id => { for (const [clientId, entry] of entries) if (!id || entry.pluginId === id) stop(clientId); });
  const release = () => { for (const id of [...entries.keys()]) stop(id); };
  const send = (event: PluginViewerEvent) => { const parent = getMainWindow(); if (parent && !parent.isDestroyed()) parent.webContents.send('plugin-viewer:event', event); };
  const bind = (name: string, handler: (...args: any[]) => unknown) => ipcMain.handle(`plugin-viewer:${name}`, (event, ...args) => {
    const parent = getMainWindow();
    if (!parent || event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame) throw new Error('Unbound host source');
    return handler(...args);
  });
  bind('open', async (input: PluginViewerOpen) => {
    if (!input || !/^[a-zA-Z0-9-]{1,64}$/.test(input.clientId) || (!options.manager && input.viewerId !== 'example.csv.table') || entries.has(input.clientId) || entries.size >= 4) return { ok: false, code: 'BAD_REQUEST' };
    let spec: ReturnType<PluginManager['resolve']> | undefined;
    try { spec = options.manager?.resolve(input.viewerId); } catch { return { ok:false, code:'FORBIDDEN' }; }
    const parent = getMainWindow()!;
    if (!host) {
      host = new PluginDevelopmentHost(parent, options.preloadPath ?? path.join(process.env.APP_ROOT ?? app.getAppPath(), 'dist-plugins/plugin-preload.cjs'));
      parent.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) release(); });
      parent.webContents.on('render-process-gone', release);
      parent.once('closed', () => { release(); host = undefined; });
    }
    const entry = { pluginId: spec?.plugin.id ?? 'example.csv', counted: false, controller: new AbortController(), instance: undefined as IsolatedPluginInstance | undefined, bounds: null as Electron.Rectangle | null };
    entries.set(input.clientId, entry);
    let stage = 'resource.open';
    try {
      const resource = await openLibraryResource({ apiBaseUrl: options.apiBaseUrl ?? __OMNIFLOW_API_BASE_URL__, storageOrigins: options.storageOrigins ?? __OMNIFLOW_STORAGE_ORIGINS__,
        token: input.token, username: input.username, libraryId: input.libraryId, nodeId: input.nodeId, signal: entry.controller.signal, onStage: next => { stage = next; } });
      if (entries.get(input.clientId) !== entry || (spec && !options.manager!.stillAllowed(input.viewerId,spec.plugin.fingerprint))) throw new PluginFault('CANCELLED', 'Closed');
      const state = new PluginReadingStateMemory();
      let seeded = false;
      const snapshot = input.snapshot;
      stage = 'package.load';
      const instance = await host.load(spec?.directory ?? options.packageDirectory ?? path.join(process.env.APP_ROOT ?? app.getAppPath(), 'dist-plugins/csv'), resource, input.theme, true, {
        viewerId: input.viewerId, externalLayout: true, onDiagnostic: event => options.manager?.requestFailed(entry.pluginId,event), expectedFingerprint: spec?.plugin.fingerprint, settings: spec ? options.manager!.settings.forPackage(spec.plugin.id,spec.plugin.fingerprint) : undefined,
        onStop: reason => { if (entries.get(input.clientId) === entry) { entries.delete(input.clientId); entry.controller.abort(); send({ clientId: input.clientId, type: 'stopped', reason }); options.manager?.stopped(entry.pluginId,reason,entry.counted); } },
        readingState: {
          get(scope) {
            if (!seeded) { seeded = true; if (snapshot?.resourceRevision === resource.revision && (!spec || snapshot.packageFingerprint === spec.plugin.fingerprint) && snapshot.state?.schemaVersion === 1) state.set(scope, snapshot.state.value, 0, 1); }
            return state.get(scope);
          },
          set(scope, value, expectedRevision, schemaVersion) {
            const next = state.set(scope, value, expectedRevision, schemaVersion);
            const nextSnapshot: PluginViewerSnapshot = { packageFingerprint: spec?.plugin.fingerprint, resourceRevision: resource.revision, state: next };
            send({ clientId: input.clientId, type: 'state', snapshot: nextSnapshot }); return next;
          },
        },
      });
      if (entries.get(input.clientId) !== entry || (spec && !options.manager!.stillAllowed(input.viewerId,spec.plugin.fingerprint))) { instance.stop(); throw new PluginFault('CANCELLED', 'Closed'); }
      entry.instance = instance; entry.counted = true; options.manager?.started(entry.pluginId); instance.setBounds(entry.bounds);
      return { ok: true };
    } catch (error) { stop(input.clientId); return { ok: false, code: error instanceof PluginFault ? error.code : 'UNAVAILABLE', diagnostic: stage + ':' + (error instanceof Error && ["Invalid plugin manifest", "Unsupported plugin platform or entry", "Incompatible host version", "Invalid or duplicate viewer id", "Invalid activation conditions", "Plugin root must be a real directory", "Asset escaped package", "Oversized package asset", "Package changed during loading", "Plugin directory depth exceeded", "Package entry limit exceeded", "Invalid package asset path", "Package symlinks are not permitted", "Unsupported or oversized package asset", "Package byte limit exceeded", "Unsafe SVG asset", "Missing or oversized manifest", "Manifest changed during loading", "Plugin entry not found", "Development host instance limit reached", "Host unavailable", "Plugin id already bound to another source", "Stop previous package version before reload", "Unknown viewer contribution", "Selected viewer does not match resource", "Plugin stopped while loading", "Renderer process isolation unavailable", "Invalid plugin theme", "Invalid host resource scope"].includes(error.message) ? error.message : error instanceof Error && 'code' in error && ['ENOENT','EACCES'].includes(String(error.code)) ? String(error.code) : error instanceof TypeError ? 'TypeError' : error instanceof PluginFault ? error.code : 'Error') }; }
  });
  bind('close', (id: string) => stop(id)); bind('release', release);
  bind('theme', (id: string, theme: ThemeSnapshot) => entries.get(id)?.instance?.setTheme(theme));
  bind('layout', (id: string, input: Electron.Rectangle | null) => {
    const entry = entries.get(id); if (!entry) return;
    const parent = getMainWindow()!; const [width, height] = parent.getContentSize();
    if (input && (!['x','y','width','height'].every(key => Number.isFinite(input[key as keyof Electron.Rectangle])) || input.width < 0 || input.height < 0)) return;
    const bounds = input ? { x: Math.max(0, Math.round(input.x)), y: Math.max(0, Math.round(input.y)), width: Math.max(0, Math.min(Math.round(input.width), width - Math.max(0, Math.round(input.x)))), height: Math.max(0, Math.min(Math.round(input.height), height - Math.max(0, Math.round(input.y)))) } : null;
    const wasVisible = Boolean(entry.bounds);
    entry.bounds = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
    entry.instance?.setBounds(entry.bounds); if (wasVisible !== Boolean(entry.bounds)) entry.instance?.setActive(Boolean(entry.bounds));
  });
}

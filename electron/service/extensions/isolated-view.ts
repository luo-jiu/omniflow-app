import { acquirePluginSession } from './plugin-session-pool';
import { app, BrowserWindow, WebContentsView, ipcMain, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { LIMITS, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import { loadPluginPackage, type LoadedPluginPackage } from './manifest';
import { PluginResourceBroker, PluginSettingsMemory, PluginReadingStateMemory, validateTheme, isMetadataResourceAuthority, type PluginSettingsAccess, type PluginReadingStateStore, type PluginResourceAuthority, type PluginToolExecution, type PluginWorkspaceExecution } from './resource-broker';

const SCHEME = 'omniflow-extension';
const CHANNEL = 'omniflow-plugin:rpc';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function registerPluginScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}
export interface PluginDiagnostic { type: string; instanceId: string; code?: string; method?: string; elapsedMs?: number; requestTag?: string }
export interface IsolatedPluginInstance {
  readonly id: string;
  readonly view: WebContentsView;
  readonly broker: PluginResourceBroker;
  readonly package: LoadedPluginPackage;
  readonly partition: string;
  stop(reason?: string): void;
  setTheme(theme: ThemeSnapshot): void;
  setActive(active: boolean): void;
  setBounds(bounds: Electron.Rectangle | null): void;
}


// 全进程只注册一个 RPC handler；多个 Viewer/Tool 宿主按真实 WebContents 来源共享路由。
const routedInstances = new Map<number, { instance: IsolatedPluginInstance; contents: Electron.WebContents }>();
let routingHosts = 0;
let loadingInstances = 0;
function acquireSourceRouter() {
  if (routingHosts === 0) ipcMain.handle(CHANNEL, (event, raw: unknown) => {
    const instance = routedInstances.get(event.sender.id)?.instance;
    if (!instance || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(`${SCHEME}://${instance.id}/`)) {
      return JSON.stringify({ version: 1, id: '', ok: false, error: { code: 'FORBIDDEN', message: 'Unbound plugin source' } });
    }
    return instance.broker.exchange(raw);
  });
  routingHosts++;
  let released = false;
  return () => { if (released) return; released = true; if (--routingHosts === 0) ipcMain.removeHandler(CHANNEL); };
}
export interface IsolatedPluginLoadOptions {
  viewerId?: string; externalLayout?: boolean; onStop?: (reason: string) => void;
  readingState?: PluginReadingStateStore; settings?: PluginSettingsAccess;
  expectedFingerprint?: string; memoryLimitKiB?: number; onDiagnostic?: (event: PluginDiagnostic) => void;
  toolExecution?: PluginToolExecution; workspaceExecution?: PluginWorkspaceExecution; signal?: AbortSignal;
}

// 共同隔离底座；生产调用仍必须由宿主提供已授权资源。
export class PluginDevelopmentHost {
  private instances = new Map<number, IsolatedPluginInstance>();
  private settings = new PluginSettingsMemory();
  private readingState = new PluginReadingStateMemory();
  private activationCount = 0;
  private disposed = false;
  private sources = new Map<string, string>();
  readonly diagnostics: PluginDiagnostic[] = [];
  private releaseRouter: () => void;
  private disposeListeners = new Set<() => void>();
  private readonly parentClosed = () => this.dispose();
  constructor(private readonly parent: BrowserWindow, private readonly preloadPath: string) {
    this.releaseRouter = acquireSourceRouter();
    parent.once('closed', this.parentClosed);
  }
  private record(event: PluginDiagnostic) { this.diagnostics.push(event); if (this.diagnostics.length > 256) this.diagnostics.shift(); }
  async load(directory: string, resource: PluginResourceAuthority, theme: ThemeSnapshot, granted = false, options: IsolatedPluginLoadOptions = {}): Promise<IsolatedPluginInstance> {
    if (this.disposed) throw new Error('Host unavailable');
    if (loadingInstances + routedInstances.size >= LIMITS.instances) throw new Error('Development host instance limit reached');
    loadingInstances++;
    try { return await this.loadExecution(directory, resource, theme, granted, options); }
    finally { loadingInstances--; }
  }
  private async loadExecution(directory: string, resource: PluginResourceAuthority, theme: ThemeSnapshot, granted: boolean, options: IsolatedPluginLoadOptions): Promise<IsolatedPluginInstance> {
    options.signal?.throwIfAborted();
    if (app.commandLine.hasSwitch('no-sandbox')) throw new Error('Plugin sandbox is disabled');
    if (this.instances.size >= LIMITS.instances || (!options.expectedFingerprint && this.activationCount >= 64)) throw new Error('Development host instance limit reached');
    const loaded = await loadPluginPackage(directory);
    options.signal?.throwIfAborted();
    if (this.disposed || this.parent.isDestroyed() || this.instances.size >= LIMITS.instances || (!options.expectedFingerprint && this.activationCount >= 64)) throw new Error('Host unavailable');
    if (options.expectedFingerprint && loaded.fingerprint !== options.expectedFingerprint) throw new Error('Plugin integrity check failed');
    validateTheme(theme);
    const source = this.sources.get(loaded.manifest.id);
    if (!options.expectedFingerprint && source && source !== loaded.source) throw new Error('Plugin id already bound to another source');
    if ([...this.instances.values()].some(item => item.package.manifest.id === loaded.manifest.id && item.package.fingerprint !== loaded.fingerprint)) throw new Error('Stop previous package version before reload');
    let entry = loaded.manifest.entry;
    const execution = options.toolExecution;
    const workspaceExecution = options.workspaceExecution;
    if (workspaceExecution) {
      const workspace = loaded.manifest.workspaces?.find(item => item.id === workspaceExecution.contribution.id);
      if (execution || options.viewerId || !workspace || JSON.stringify(workspace) !== JSON.stringify(workspaceExecution.contribution)
        || isMetadataResourceAuthority(resource) || resource.directory) throw new Error('Unknown workspace contribution');
      entry = workspace.entry;
    } else if (execution) {
      const tool = loaded.manifest.agentTools?.find(item => item.id === execution.contribution.id);
      if (!tool || JSON.stringify(tool) !== JSON.stringify(execution.contribution)
        || (isMetadataResourceAuthority(resource) ? tool.kind !== 'rename-proposal' : tool.kind === 'rename-proposal' || resource.directory)) throw new Error('Unknown Tool contribution');
      entry = tool.entry;
    } else {
      if (isMetadataResourceAuthority(resource)) throw new Error('Metadata scope requires a proposal Tool');
      const selectedViewer = loaded.manifest.viewers.find(viewer => viewer.id === (options.viewerId ?? loaded.manifest.viewers[0]?.id));
      if (!selectedViewer) throw new Error('Unknown viewer contribution');
      const extension = resource.name.split('.').pop()?.toLowerCase();
      if (resource.directory ? !selectedViewer.directoryTypes?.includes(resource.directory.type) : selectedViewer.directoryTypes || !extension || !selectedViewer.extensions.includes(extension)) throw new Error('Selected viewer does not match resource');
      loaded.manifest = { ...loaded.manifest, viewers: [selectedViewer] };
    }
    if (!entry) throw new Error('Plugin entry not found');
    if (!options.expectedFingerprint) { this.sources.set(loaded.manifest.id, loaded.source); this.activationCount += 1; }
    const id = randomUUID();
    const broker = new PluginResourceBroker(loaded.manifest, resource, theme, options.settings ?? this.settings, event => { const diagnostic = { type: 'rpc', instanceId: id, ...event }; this.record(diagnostic); if(event.code !== 'OK') options.onDiagnostic?.(diagnostic); }, options.readingState ?? this.readingState, execution, workspaceExecution);
    broker.setReadGrant(granted);
    const lease = await acquirePluginSession();
    const isolatedSession = lease.session;
    const partition = lease.partition;
    const origin = `${SCHEME}://${id}`;
    let view: WebContentsView | undefined;
    let contents: Electron.WebContents | undefined;
    let contentsId: number | undefined;
    let instance: IsolatedPluginInstance | undefined;
    let stopped = false; let sessionReleased = false; let protocolBound = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let startup: ReturnType<typeof setTimeout> | undefined;
    const denyDownload = (event: Electron.Event) => { event.preventDefault(); this.record({ type: 'download-denied', instanceId: id }); };
    const resize = () => { if (view && !execution && !options.externalLayout && !stopped && !this.parent.isDestroyed()) view.setBounds({ x: 20, y: 90, width: Math.max(1, this.parent.getContentSize()[0] - 40), height: Math.max(1, this.parent.getContentSize()[1] - 110) }); };
    const abort = () => stop('cancelled');
    const releaseSession = () => {
      if (sessionReleased) return;
      sessionReleased = true;
      try { isolatedSession.webRequest.onBeforeRequest(null); }
      finally { isolatedSession.removeListener('will-download', denyDownload); lease.release(); }
    };
    // Covers failures before an instance exists as well as normal instance shutdown.
    const stop = (reason = 'stopped') => {
      if (stopped) return;
      stopped = true;
      clearTimeout(startup); clearInterval(heartbeat);
      options.signal?.removeEventListener('abort', abort);
      this.parent.removeListener('resize', resize);
      broker.dispose();
      if (contentsId !== undefined) { this.instances.delete(contentsId); routedInstances.delete(contentsId); }
      try {
        if (protocolBound) isolatedSession.protocol.unhandle(SCHEME);
      } finally {
        if (!contents || contents.isDestroyed()) releaseSession();
        else {
          contents.once('destroyed', releaseSession);
          try { if (view) this.parent.contentView.removeChildView(view); } catch { /* parent already closed or view never attached */ }
          // Reuse a session only after its renderer can no longer access it.
          try {
            const pid = contents.getOSProcessId();
            if (pid && (this.parent.isDestroyed() || pid !== this.parent.webContents.getOSProcessId())) contents.forcefullyCrashRenderer();
          } finally {
            if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
            if (contents.isDestroyed()) releaseSession();
          }
        }
      }
      this.record({ type: 'stopped', instanceId: id, code: reason });
      options.onStop?.(reason);
    };
    try {
      if (this.parent.isDestroyed() || this.disposed || options.signal?.aborted) throw new Error('Host unavailable');
      isolatedSession.protocol.handle(SCHEME, request => {
        const url = new URL(request.url);
        let key: string;
        try { key = decodeURIComponent(url.pathname.slice(1)); } catch { return new Response(null, { status: 400 }); }
        const asset = url.protocol === `${SCHEME}:` && url.hostname === id && !url.username && !url.password && !url.port && !url.search && !url.hash ? loaded.assets.get(key) : undefined;
        return asset ? new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 });
      });
      protocolBound = true;
      let assetWindowStart = 0; let assetRequests = 0;
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        const now = Date.now();
        if (now - assetWindowStart >= 1000) { assetWindowStart = now; assetRequests = 0; }
        const allowed = details.url.length <= 512 && ++assetRequests <= 128 && details.url.startsWith(`${origin}/`) && details.method === 'GET';
        if (!allowed) this.record({ type: 'network-denied', instanceId: id });
        callback({ cancel: !allowed });
      });
      isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolatedSession.setPermissionCheckHandler(() => false);
      isolatedSession.on('will-download', denyDownload);
      view = new WebContentsView({ webPreferences: {
        preload: this.preloadPath, session: isolatedSession, sandbox: true, contextIsolation: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, webviewTag: false, devTools: false, backgroundThrottling: false,
        disableDialogs: true, navigateOnDragDrop: false, spellcheck: false, webgl: false,
      } });
      const activeView = view;
      // Electron may clear view.webContents before delivering its destroyed event.
      const activeContents = contents = activeView.webContents;
      contentsId = activeContents.id;
      activeContents.setAudioMuted(true);
      instance = {
        id, view: activeView, broker, package: loaded, partition, stop,
        setBounds: bounds => { if (stopped || execution) return; activeView.setVisible(Boolean(bounds)); if (bounds) activeView.setBounds(bounds); },
        setTheme: next => {
          const accepted = broker.setTheme(next);
          if (!stopped && accepted) activeContents.send('omniflow-plugin:event', JSON.stringify({ version: 1, type: 'theme', theme: next }));
        },
        setActive: active => { if (!stopped && !execution) activeContents.send('omniflow-plugin:event', JSON.stringify({ version: 1, type: 'activity', active })); },
      };
      startup = setTimeout(() => { if (!broker.isReady) stop('startup-timeout'); }, LIMITS.startupTimeoutMs);
      activeContents.setWindowOpenHandler(() => { this.record({ type: 'popup-denied', instanceId: id }); return { action: 'deny' }; });
      activeContents.on('will-navigate', event => { event.preventDefault(); this.record({ type: 'navigation-denied', instanceId: id }); });
      activeContents.on('will-redirect', event => event.preventDefault());
      activeContents.on('will-frame-navigate', event => event.preventDefault());
      activeContents.on('will-attach-webview', event => event.preventDefault());
      activeContents.on('frame-created', (_event, details) => { if (details.frame.parent) stop('child-frame-denied'); });
      activeContents.once('render-process-gone', () => stop('renderer-gone'));
      activeContents.once('destroyed', () => stop('destroyed'));
      this.instances.set(activeContents.id, instance);
      routedInstances.set(activeContents.id, { instance, contents: activeContents });
      if (!execution) this.parent.contentView.addChildView(activeView);
      this.parent.on('resize', resize); resize();
      if (execution || options.externalLayout) activeView.setVisible(false);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      this.record({ type: 'loading', instanceId: id });
      // 文件输入框不能绕开 SDK 打开本机文件；拦截在插件脚本运行前启用。
      await activeContents.loadURL('about:blank');
      activeContents.debugger.attach('1.3');
      activeContents.debugger.on('message', (_event, method) => { if (method === 'Page.fileChooserOpened') stop('file-picker-denied'); });
      activeContents.debugger.on('detach', () => { if (!stopped) stop('debugger-detached'); });
      await activeContents.debugger.sendCommand('Page.enable');
      await activeContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      await activeContents.loadURL(`${origin}/${entry}`);
      if (stopped) throw new Error('Plugin stopped while loading');
      const pluginPid = activeContents.getOSProcessId();
      if (!pluginPid || pluginPid === this.parent.webContents.getOSProcessId()
        || [...routedInstances.values()].some(other => other.instance.id !== id && !other.contents.isDestroyed() && other.contents.getOSProcessId() === pluginPid)) throw new Error('Renderer process isolation unavailable');
      let highCpuSamples = 0;
      heartbeat = setInterval(() => {
        const metric = app.getAppMetrics().find(item => item.pid === pluginPid);
        if (metric && metric.memory.workingSetSize > (options.memoryLimitKiB ?? 262144)) { stop('memory-budget'); return; }
        highCpuSamples = metric && metric.cpu.percentCPUUsage > 80 ? highCpuSamples + 1 : 0;
        if (highCpuSamples >= 3) { stop('cpu-budget'); return; }
        if (broker.isReady && broker.heartbeatExpired) { stop('heartbeat-timeout'); return; }
        if (!activeContents.isDestroyed()) activeContents.send('omniflow-plugin:event', JSON.stringify(broker.heartbeat()));
      }, LIMITS.heartbeatMs);
      return instance;
    } catch (error) { stop('load-failed'); throw error; }
  }

  get size() { return this.instances.size; }
  onDispose(listener: () => void): () => void {
    if (this.disposed) { listener(); return () => undefined; }
    this.disposeListeners.add(listener);
    return () => { this.disposeListeners.delete(listener); };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.parent.removeListener('closed', this.parentClosed);
    // Subscribers may cancel calls that have not created a view yet.
    for (const listener of [...this.disposeListeners]) {
      try { listener(); } catch { this.record({ type: 'dispose-listener-failed', instanceId: '' }); }
    }
    this.disposeListeners.clear();
    try {
      for (const instance of [...this.instances.values()]) {
        try { instance.stop('host-disposed'); } catch { this.record({ type: 'stop-failed', instanceId: instance.id }); }
      }
    } finally { this.releaseRouter(); }
  }
}

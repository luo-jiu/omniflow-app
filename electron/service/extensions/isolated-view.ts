import { acquirePluginSession } from './plugin-session-pool';
import { app, BrowserWindow, WebContentsView, ipcMain, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { LIMITS, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import { loadPluginPackage, type LoadedPluginPackage } from './manifest';
import { PluginResourceBroker, PluginSettingsMemory, PluginReadingStateMemory, validateTheme, type PluginSettingsAccess, type PluginReadingStateStore, type OpenedResourceAuthority } from './resource-broker';

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

// Development host only. C2 must supply an actual server-authorized resource adapter.
export class PluginDevelopmentHost {
  private instances = new Map<number, IsolatedPluginInstance>();
  private settings = new PluginSettingsMemory();
  private readingState = new PluginReadingStateMemory();
  private activationCount = 0;
  private disposed = false;
  private sources = new Map<string, string>();
  readonly diagnostics: PluginDiagnostic[] = [];
  constructor(private readonly parent: BrowserWindow, private readonly preloadPath: string) {
    ipcMain.handle(CHANNEL, (event, raw: unknown) => {
      const instance = this.instances.get(event.sender.id);
      if (!instance || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(`${SCHEME}://${instance.id}/`)) {
        return JSON.stringify({ version: 1, id: '', ok: false, error: { code: 'FORBIDDEN', message: 'Unbound plugin source' } });
      }
      return instance.broker.exchange(raw);
    });
    parent.once('closed', () => this.dispose());
  }
  private record(event: PluginDiagnostic) { this.diagnostics.push(event); if (this.diagnostics.length > 256) this.diagnostics.shift(); }
  async load(directory: string, resource: OpenedResourceAuthority, theme: ThemeSnapshot, granted = false, options: { viewerId?: string; externalLayout?: boolean; onStop?: (reason: string) => void; readingState?: PluginReadingStateStore; settings?: PluginSettingsAccess; expectedFingerprint?: string; memoryLimitKiB?: number; onDiagnostic?: (event: PluginDiagnostic) => void } = {}): Promise<IsolatedPluginInstance> {
    if (app.commandLine.hasSwitch('no-sandbox')) throw new Error('Plugin sandbox is disabled');
    if (this.instances.size >= LIMITS.instances || (!options.expectedFingerprint && this.activationCount >= 64)) throw new Error('Development host instance limit reached');
    const loaded = await loadPluginPackage(directory);
    if (this.disposed || this.parent.isDestroyed() || this.instances.size >= LIMITS.instances || (!options.expectedFingerprint && this.activationCount >= 64)) throw new Error('Host unavailable');
    if (options.expectedFingerprint && loaded.fingerprint !== options.expectedFingerprint) throw new Error('Plugin integrity check failed');
    validateTheme(theme);
    const source = this.sources.get(loaded.manifest.id);
    if (!options.expectedFingerprint && source && source !== loaded.source) throw new Error('Plugin id already bound to another source');
    if ([...this.instances.values()].some(item => item.package.manifest.id === loaded.manifest.id && item.package.fingerprint !== loaded.fingerprint)) throw new Error('Stop previous package version before reload');
    const selectedViewer = loaded.manifest.viewers.find(viewer => viewer.id === (options.viewerId ?? loaded.manifest.viewers[0].id));
    if (!selectedViewer) throw new Error('Unknown viewer contribution');
    const extension = resource.name.split('.').pop()?.toLowerCase();
    if (!extension || !selectedViewer.extensions.includes(extension)) throw new Error('Selected viewer does not match resource');
    // 当前激活贡献由宿主选择，插件不能通过 RPC 切换资源身份。
    loaded.manifest = { ...loaded.manifest, viewers: [selectedViewer] };
    if (!options.expectedFingerprint) { this.sources.set(loaded.manifest.id, loaded.source); this.activationCount += 1; }
    const id = randomUUID();
    const broker = new PluginResourceBroker(loaded.manifest, resource, theme, options.settings ?? this.settings, event => { const diagnostic = { type: 'rpc', instanceId: id, ...event }; this.record(diagnostic); if(event.code !== 'OK') options.onDiagnostic?.(diagnostic); }, options.readingState ?? this.readingState);
    broker.setReadGrant(granted);
    const lease = await acquirePluginSession();
    const isolatedSession = lease.session;
    const partition = lease.partition;
    if (this.parent.isDestroyed() || this.disposed) { lease.release(); throw new Error('Host unavailable'); }
    const origin = `${SCHEME}://${id}`;
    isolatedSession.protocol.handle(SCHEME, request => {
      const url = new URL(request.url);
      let key: string;
      try { key = decodeURIComponent(url.pathname.slice(1)); } catch { return new Response(null, { status: 400 }); }
      const asset = url.protocol === `${SCHEME}:` && url.hostname === id && !url.username && !url.password && !url.port && !url.search && !url.hash ? loaded.assets.get(key) : undefined;
      return asset ? new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 });
    });
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
    const denyDownload = (event: Electron.Event) => { event.preventDefault(); this.record({ type: 'download-denied', instanceId: id }); };
    isolatedSession.on('will-download', denyDownload);
    const view = new WebContentsView({ webPreferences: {
      preload: this.preloadPath, session: isolatedSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, webviewTag: false, devTools: false, backgroundThrottling: false,
      disableDialogs: true, navigateOnDragDrop: false, spellcheck: false, webgl: false,
    } });
    view.webContents.setAudioMuted(true);
    const contentsId = view.webContents.id;
    let stopped = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const startup = setTimeout(() => { if (!broker.isReady) instance.stop('startup-timeout'); }, LIMITS.startupTimeoutMs);
    const instance: IsolatedPluginInstance = {
      id, view, broker, package: loaded, partition,
      stop: (reason = 'stopped') => {
        if (stopped) return;
        stopped = true;
        clearTimeout(startup); clearInterval(heartbeat);
        this.instances.delete(contentsId);
        broker.dispose();
        try { this.parent.contentView.removeChildView(view); } catch { /* parent already closed */ }
        if (!view.webContents.isDestroyed()) {
          // Each instance has its own origin AND session; tests assert distinct renderer PIDs.
          const pid = view.webContents.getOSProcessId();
          if (pid && (this.parent.isDestroyed() || pid !== this.parent.webContents.getOSProcessId())) view.webContents.forcefullyCrashRenderer();
          if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
        }
        isolatedSession.protocol.unhandle(SCHEME);
        const removeSessionListeners = () => { isolatedSession.webRequest.onBeforeRequest(null); isolatedSession.removeListener('will-download', denyDownload); lease.release(); };
        if (view.webContents.isDestroyed()) removeSessionListeners(); else view.webContents.once('destroyed', removeSessionListeners);
        this.parent.removeListener('resize', resize);
        this.record({ type: 'stopped', instanceId: id, code: reason });
        options.onStop?.(reason);
      },
      setBounds: bounds => { if (stopped) return; view.setVisible(Boolean(bounds)); if (bounds) view.setBounds(bounds); },
      setTheme: next => {
        const accepted = broker.setTheme(next);
        if (!stopped && accepted) view.webContents.send('omniflow-plugin:event', JSON.stringify({ version: 1, type: 'theme', theme: next }));
      },
      setActive: active => { if (!stopped) view.webContents.send('omniflow-plugin:event', JSON.stringify({ version: 1, type: 'activity', active })); },
    };
    view.webContents.setWindowOpenHandler(() => { this.record({ type: 'popup-denied', instanceId: id }); return { action: 'deny' }; });
    view.webContents.on('will-navigate', event => { event.preventDefault(); this.record({ type: 'navigation-denied', instanceId: id }); });
    view.webContents.on('will-redirect', event => event.preventDefault());
    view.webContents.on('will-frame-navigate', event => event.preventDefault());
    view.webContents.on('will-attach-webview', event => event.preventDefault());
    view.webContents.on('frame-created', (_event, details) => { if (details.frame.parent) instance.stop('child-frame-denied'); });
    view.webContents.once('render-process-gone', () => instance.stop('renderer-gone'));
    view.webContents.once('destroyed', () => instance.stop('destroyed'));
    this.instances.set(view.webContents.id, instance);
    this.parent.contentView.addChildView(view);
    const resize = () => { if (!options.externalLayout && !stopped && !this.parent.isDestroyed()) view.setBounds({ x: 20, y: 90, width: Math.max(1, this.parent.getContentSize()[0] - 40), height: Math.max(1, this.parent.getContentSize()[1] - 110) }); };
    this.parent.on('resize', resize); resize();
    if (options.externalLayout) view.setVisible(false);
    this.record({ type: 'loading', instanceId: id });
    try {
      // 文件输入框不能绕开 SDK 打开本机文件；拦截在插件脚本运行前启用。
      await view.webContents.loadURL('about:blank');
      view.webContents.debugger.attach('1.3');
      view.webContents.debugger.on('message', (_event, method) => { if (method === 'Page.fileChooserOpened') instance.stop('file-picker-denied'); });
      view.webContents.debugger.on('detach', () => { if (!stopped) instance.stop('debugger-detached'); });
      await view.webContents.debugger.sendCommand('Page.enable');
      await view.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      await view.webContents.loadURL(`${origin}/${loaded.manifest.entry}`);
      if (stopped) throw new Error('Plugin stopped while loading');
      const pluginPid = view.webContents.getOSProcessId();
      if (!pluginPid || pluginPid === this.parent.webContents.getOSProcessId()
        || [...this.instances.values()].some(other => other.id !== id && other.view.webContents.getOSProcessId() === pluginPid)) throw new Error('Renderer process isolation unavailable');
      let highCpuSamples = 0;
      heartbeat = setInterval(() => {
        const metric = app.getAppMetrics().find(item => item.pid === pluginPid);
        if (metric && metric.memory.workingSetSize > (options.memoryLimitKiB ?? 262144)) { instance.stop('memory-budget'); return; }
        highCpuSamples = metric && metric.cpu.percentCPUUsage > 80 ? highCpuSamples + 1 : 0;
        if (highCpuSamples >= 3) { instance.stop('cpu-budget'); return; }
        if (broker.isReady && broker.heartbeatExpired) { instance.stop('heartbeat-timeout'); return; }
        if (!view.webContents.isDestroyed()) view.webContents.send('omniflow-plugin:event', JSON.stringify(broker.heartbeat()));
      }, LIMITS.heartbeatMs);
      return instance;
    } catch (error) { instance.stop('load-failed'); throw error; }
  }
  get size() { return this.instances.size; }
  dispose() { if (this.disposed) return; this.disposed = true; for (const instance of [...this.instances.values()]) instance.stop('host-disposed'); ipcMain.removeHandler(CHANNEL); }
}

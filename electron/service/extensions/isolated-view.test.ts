import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, WebContentsView } from 'electron';
import type { LoadedPluginPackage } from './manifest';
import type { MetadataResourceAuthority, OpenedResourceAuthority } from './resource-broker';
import type { PluginRenameProposalToolContribution } from '../../../packages/plugin-sdk/index.js';
import { RENAME_PROPOSAL_OUTPUT_SCHEMA } from './tool-schema';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), removeHandler: vi.fn(), createView: vi.fn(), acquire: vi.fn(), loadPackage: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: () => false }, getAppMetrics: () => [] },
  WebContentsView: mocks.createView,
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
}));
vi.mock('./plugin-session-pool', () => ({ acquirePluginSession: mocks.acquire }));
vi.mock('./manifest', () => ({ loadPluginPackage: mocks.loadPackage }));
import { PluginDevelopmentHost } from './isolated-view';

const resource: OpenedResourceAuthority = { accountScope: 'test', libraryId: 3, nodeId: 7, name: 'data.csv', size: 3, revision: 'v1', authorize: async () => true, currentRevision: async () => 'v1', readRange: async () => Buffer.from('abc') };
const theme = { schemaVersion: 1 as const, revision: 1, mode: 'light' as const, colors: {} };
const hosts: PluginDevelopmentHost[] = [];
let nextId = 10;

function parent() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false, getContentSize: () => [1000, 700], webContents: { getOSProcessId: () => 1 }, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } });
}
function sessionLease() {
  return { session: Object.assign(new EventEmitter(), {
    protocol: { handle: vi.fn(), unhandle: vi.fn() }, webRequest: { onBeforeRequest: vi.fn() },
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
  }), partition: 'test-session', release: vi.fn() };
}
function view() {
  let destroyed = false; const id = nextId++;
  const contents = Object.assign(new EventEmitter(), {
    id, mainFrame: { url: '' }, isDestroyed: () => destroyed, setAudioMuted: vi.fn(), setWindowOpenHandler: vi.fn(),
    getOSProcessId: () => id, forcefullyCrashRenderer: vi.fn(), send: vi.fn(),
    close: vi.fn(() => { destroyed = true; contents.emit('destroyed'); }),
    loadURL: vi.fn(async (url: string) => { contents.mainFrame.url = url; }),
    debugger: Object.assign(new EventEmitter(), { attach: vi.fn(), sendCommand: vi.fn(async () => undefined) }),
  });
  return { webContents: contents, setBounds: vi.fn(), setVisible: vi.fn() };
}
function host(window = parent()) {
  const result = new PluginDevelopmentHost(window as unknown as BrowserWindow, '/test/preload.cjs'); hosts.push(result); return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquire.mockImplementation(async () => sessionLease());
  mocks.createView.mockImplementation(() => view() as unknown as WebContentsView);
  mocks.loadPackage.mockImplementation(async (): Promise<LoadedPluginPackage> => ({ source: '/test/package', fingerprint: 'fingerprint', assets: new Map(), manifest: {
    formatVersion: 1, id: 'test.csv', version: '1.0.0', sdkVersion: 1, minHostVersion: '0.2.2', platforms: ['darwin'], entry: 'index.html',
    permissions: ['resource.read'], activation: ['viewer:test.csv.table'], viewers: [{ id: 'test.csv.table', title: 'CSV', extensions: ['csv'] }],
  } }));
});
afterEach(() => { for (const item of hosts.splice(0)) item.dispose(); });

describe('isolated plugin host cleanup and source routing', () => {
  it('runs an explicit metadata proposal entry in the existing hidden sandbox without a Viewer', async () => {
    const owner = parent(); const runtime = host(owner);
    const tool: PluginRenameProposalToolContribution = { kind: 'rename-proposal', id: 'test.rename.rule', title: 'Rename', description: 'Metadata proposal', entry: 'rename.html',
      resourceAccess: [{ parameter: 'resources', mode: 'metadata', kind: 'file', maxItems: 50 }], timeoutMs: 30000, maxResultBytes: 32768,
      inputSchema: { type: 'object', additionalProperties: false, required: ['resources'], properties: { resources: {
        type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      } } }, outputSchema: RENAME_PROPOSAL_OUTPUT_SCHEMA };
    const metadata: MetadataResourceAuthority = { kind: 'metadata', accountScope: 'test', libraryId: 3, revision: 'meta-v1',
      files: [{ id: 'opaque-file', name: 'photo.jpg' }], authorize: async () => true, currentRevision: async () => 'meta-v1' };
    mocks.loadPackage.mockResolvedValue({ source: '/test/rename', fingerprint: 'fingerprint', assets: new Map(), manifest: {
      formatVersion: 2, id: 'test.rename', version: '1.0.0', sdkVersion: 1, minHostVersion: '0.2.2', platforms: ['darwin'],
      permissions: ['resource.rename.propose', 'agent.tools'], activation: ['tool:test.rename.rule'], viewers: [], agentTools: [tool],
    } });
    const toolExecution = { contribution: tool, invocationId: 'invocation', input: { parameters: {}, files: metadata.files }, complete: vi.fn(), reject: vi.fn(), fail: vi.fn() };
    await expect(runtime.load('/test/rename', metadata, theme, true)).rejects.toThrow('Metadata scope requires a proposal Tool');
    await expect(runtime.load('/test/rename', resource, theme, true, { toolExecution })).rejects.toThrow('Unknown Tool contribution');
    const instance = await runtime.load('/test/rename', metadata, theme, true, { toolExecution });
    expect(instance.view.webContents.loadURL).toHaveBeenCalledWith(expect.stringMatching(/\/rename\.html$/));
    expect(owner.contentView.addChildView).not.toHaveBeenCalled();
    expect(mocks.createView.mock.calls[0][0].webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    const response = JSON.parse(await instance.broker.exchange(JSON.stringify({ version: 1, id: 'context', method: 'context.get', params: {} })));
    expect(response).toMatchObject({ ok: true, value: { resource: null, readGranted: false, kind: 'tool' } });
  });
  it('releases the session and protocol when WebContentsView construction fails', async () => {
    const lease = sessionLease(); mocks.acquire.mockResolvedValue(lease);
    mocks.createView.mockImplementation(() => { throw new Error('Native view unavailable'); });
    const owner = parent(); const runtime = host(owner);
    await expect(runtime.load('/test/package', resource, theme, true)).rejects.toThrow('Native view unavailable');
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(lease.session.protocol.unhandle).toHaveBeenCalledWith('omniflow-extension');
    expect(lease.session.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
    expect(lease.session.listenerCount('will-download')).toBe(0);
    expect(owner.listenerCount('resize')).toBe(0);
    expect(runtime.size).toBe(0);
    // A failed load must also relinquish the shared loading counter.
    mocks.createView.mockImplementation(() => view() as unknown as WebContentsView);
    expect(await runtime.load('/test/package', resource, theme, true)).toBeDefined();
  });
  it('releases a lease when protocol setup throws before the view exists', async () => {
    const lease = sessionLease(); mocks.acquire.mockResolvedValue(lease);
    lease.session.protocol.handle.mockImplementation(() => { throw new Error('Protocol unavailable'); });
    await expect(host().load('/test/package', resource, theme, true)).rejects.toThrow('Protocol unavailable');
    expect(lease.release).toHaveBeenCalledOnce();
    expect(lease.session.protocol.unhandle).not.toHaveBeenCalled();
    expect(mocks.createView).not.toHaveBeenCalled();
  });
  it('destroys an initialized view and releases its lease when attachment throws', async () => {
    const lease = sessionLease(); const contentsView = view(); const owner = parent();
    mocks.acquire.mockResolvedValue(lease); mocks.createView.mockReturnValue(contentsView);
    owner.contentView.addChildView.mockImplementation(() => { throw new Error('Attachment failed'); });
    const runtime = host(owner);
    await expect(runtime.load('/test/package', resource, theme, true)).rejects.toThrow('Attachment failed');
    expect(contentsView.webContents.close).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(runtime.size).toBe(0);
    expect(owner.listenerCount('resize')).toBe(0);
  });
  it('cleans up after Electron clears view.webContents before an external destroyed event', async () => {
    const lease = sessionLease(); const contentsView = view(); const contents = contentsView.webContents;
    mocks.acquire.mockResolvedValue(lease); mocks.createView.mockReturnValue(contentsView);
    const owner = parent(); const runtime = host(owner); const stopped = vi.fn();
    const instance = await runtime.load('/test/package', resource, theme, true, { onStop: stopped });
    Object.defineProperty(contentsView, 'webContents', { value: undefined });
    expect(() => contents.close()).not.toThrow();
    expect(stopped).toHaveBeenCalledWith('destroyed');
    expect(lease.release).toHaveBeenCalledOnce();
    expect(runtime.size).toBe(0);
    expect(instance.broker.alive).toBe(false);
    expect(owner.listenerCount('resize')).toBe(0);
    expect(() => instance.stop()).not.toThrow();
    const route = mocks.handle.mock.calls[0][1];
    expect(JSON.parse(await route({ sender: contents, senderFrame: contents.mainFrame }, '{}'))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
  it('rejects a pending load safely after an external destruction clears the view getter', async () => {
    const lease = sessionLease(); const contentsView = view(); const contents = contentsView.webContents;
    mocks.acquire.mockResolvedValue(lease); mocks.createView.mockReturnValue(contentsView);
    let finishLoad!: () => void;
    contents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finishLoad = resolve; }));
    const runtime = host(); const loading = runtime.load('/test/package', resource, theme, true);
    const rejected = expect(loading).rejects.toThrow('Plugin stopped while loading');
    await vi.waitFor(() => expect(contents.loadURL).toHaveBeenCalledOnce());
    Object.defineProperty(contentsView, 'webContents', { value: undefined });
    contents.close(); finishLoad();
    await rejected;
    expect(lease.release).toHaveBeenCalledOnce();
    expect(runtime.size).toBe(0);
  });
  it('keeps the shared RPC router active until the last host is disposed', async () => {
    const firstWindow = parent(); const first = host(firstWindow); const second = host();
    const instance = await second.load('/test/package', resource, theme, true);
    expect(mocks.handle).toHaveBeenCalledTimes(1);
    const route = mocks.handle.mock.calls[0][1];
    first.dispose();
    expect(firstWindow.listenerCount('closed')).toBe(0);
    expect(mocks.removeHandler).not.toHaveBeenCalled();
    const sender = instance.view.webContents;
    const raw = JSON.stringify({ version: 1, id: 'context', method: 'context.get', params: {} });
    expect(JSON.parse(await route({ sender, senderFrame: sender.mainFrame }, raw))).toMatchObject({ ok: true, value: { viewerId: 'test.csv.table' } });
    expect(JSON.parse(await route({ sender, senderFrame: { url: sender.mainFrame.url } }, raw))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    second.dispose(); second.dispose();
    expect(mocks.removeHandler).toHaveBeenCalledOnce();
    expect(mocks.removeHandler).toHaveBeenCalledWith('omniflow-plugin:rpc');
  });
  it('broadcasts disposal before views exist and removes parent-window listeners', async () => {
    const owner = parent(); const runtime = host(owner);
    const controller = new AbortController(); const removed = vi.fn(); const notified = vi.fn(() => controller.abort());
    runtime.onDispose(removed)();
    runtime.onDispose(() => { throw new Error('Subscriber failed'); });
    runtime.onDispose(notified);
    runtime.dispose(); runtime.dispose();
    expect(controller.signal.aborted).toBe(true);
    expect(notified).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
    expect(owner.listenerCount('closed')).toBe(0);
    const late = vi.fn(); runtime.onDispose(late); expect(late).toHaveBeenCalledOnce();
    await expect(runtime.load('/test/package', resource, theme, true)).rejects.toThrow('Host unavailable');
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it('releases a late lease when disposal cancels a load before view creation', async () => {
    const lease = sessionLease(); let acquired!: (value: typeof lease) => void;
    mocks.acquire.mockReturnValue(new Promise<typeof lease>(resolve => { acquired = resolve; }));
    const runtime = host(); const controller = new AbortController();
    runtime.onDispose(() => controller.abort());
    const loading = runtime.load('/test/package', resource, theme, true, { signal: controller.signal });
    const rejected = expect(loading).rejects.toThrow('Host unavailable');
    await vi.waitFor(() => expect(mocks.acquire).toHaveBeenCalledOnce());
    runtime.dispose(); acquired(lease);
    await rejected;
    expect(lease.release).toHaveBeenCalledOnce();
    expect(mocks.createView).not.toHaveBeenCalled();
    expect(runtime.size).toBe(0);
  });
});

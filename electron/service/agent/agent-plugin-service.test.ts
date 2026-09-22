import { createHash } from 'node:crypto';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPluginToolSource } from '@/shared/agent/agent.types';
import manifestJson from '../../../samples/csv-tool/manifest.json';
import { parsePluginManifest } from '../extensions/manifest';
import { PluginFault, type OpenedResourceAuthority } from '../extensions/resource-broker';
import type { PluginManager, PluginRuntimeStopReason } from '../extensions/plugin-manager';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import type { openAgentPluginResource } from './agent-plugin-resource';

const mocks = vi.hoisted(() => ({
  hostCreate: vi.fn(), hostDispose: vi.fn(), runtimeCreate: vi.fn(), runtimeDispose: vi.fn(), execute: vi.fn(),
}));
vi.mock('electron', () => ({ BrowserWindow: {}, net: { fetch: vi.fn() } }));
vi.mock('../extensions/isolated-view', () => ({ PluginDevelopmentHost: class {
  constructor(...args: unknown[]) { mocks.hostCreate(...args); }
  dispose() { mocks.hostDispose(); }
} }));
vi.mock('../extensions/plugin-tool-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../extensions/plugin-tool-runtime')>(),
  PluginToolRuntime: class {
    constructor(...args: unknown[]) { mocks.runtimeCreate(...args); }
    execute(...args: unknown[]) { return mocks.execute(...args); }
    dispose() { mocks.runtimeDispose(); }
  },
}));
import { createAgentPluginService, type AgentPluginToolRequest } from './agent-plugin-service';

const manifest = parsePluginManifest(manifestJson, 'darwin');
const contribution = manifest.agentTools![0];
const fingerprint = 'a'.repeat(64);
function sourceFor(changes: Partial<AgentPluginToolSource> = {}): AgentPluginToolSource {
  const source = { pluginId: manifest.id, pluginVersion: manifest.version, packageFingerprint: fingerprint,
    toolId: contribution.id, registrationId: '', ...changes };
  source.registrationId = `plugin-tool:${createHash('sha256').update(JSON.stringify([
    'omniflow-agent-tool-v1', source.pluginId, source.pluginVersion, source.packageFingerprint, source.toolId,
  ])).digest('hex')}`;
  return source;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const disposers: Array<() => void> = [];
function fixture() {
  let allowed = true;
  const listeners = new Set<(id?: string, reason?: PluginRuntimeStopReason) => void>();
  const source = sourceFor();
  const sender = { id: 9, isDestroyed: vi.fn(() => false) } as unknown as WebContents;
  const parent = { webContents: sender, isDestroyed: vi.fn(() => false) } as unknown as BrowserWindow;
  const getMainWindow = vi.fn(() => parent);
  const manager = {
    attachRuntime: vi.fn((callback: (id?: string, reason?: PluginRuntimeStopReason) => void) => { listeners.add(callback); return () => listeners.delete(callback); }),
    resolveTool: vi.fn((toolId: string, requestedFingerprint: string) => {
      if (!allowed || toolId !== source.toolId || requestedFingerprint !== fingerprint) throw new PluginFault('FORBIDDEN', 'Missing Tool');
      return { plugin: { id: source.pluginId, version: source.pluginVersion, fingerprint }, tool: contribution,
        registrationId: source.registrationId, directory: '/virtual/plugin', providerName: 'fixture_query' };
    }),
    stillToolAllowed: vi.fn(() => allowed),
    toolSnapshot: vi.fn(() => []),
  };
  const resource: OpenedResourceAuthority = { accountScope: 'user:42', libraryId: 3, nodeId: 7,
    name: 'table.csv', size: 5, revision: 'revision', authorize: vi.fn(async () => true),
    currentRevision: vi.fn(async () => 'revision'), readRange: vi.fn(async () => new Uint8Array()),
  };
  const openResource = vi.fn<typeof openAgentPluginResource>(async () => resource);
  const upstream = new AbortController();
  const authority: AgentFileAuthorityBrokerRequestInput = {
    sender, ownerScope: { accountScope: 'user:42', backendScope: 'https://backend.test' },
    libraryId: 3, sessionId: 'session', runId: 'run', toolRunId: 'tool-run', signal: upstream.signal,
    operation: { operation: 'stage-library-node', nodeId: 7, includeDownloadUrl: true },
  };
  const assertCurrent = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); });
  const request: AgentPluginToolRequest = { source, input: { resource: { nodeId: 7 }, limit: 1 },
    authority, aiDestinationId: 'destination', assertCurrent };
  const result = { output: { headers: ['name'], rows: [['demo']], matchedRows: 1, totalRows: 1, truncated: false },
    source: { pluginId: source.pluginId, version: source.pluginVersion, fingerprint,
      toolId: source.toolId, registrationId: source.registrationId, nodeId: 7, resourceRevision: resource.revision } };
  mocks.execute.mockResolvedValue(result);
  const service = createAgentPluginService({ manager: manager as unknown as PluginManager, getMainWindow,
    openResource, preloadPath: '/virtual/preload.cjs' });
  disposers.push(() => service.dispose());
  return { service, manager, source, sender, parent, getMainWindow, request, authority, assertCurrent,
    resource, openResource, upstream, result, listeners,
    revoke(id: string | undefined = source.pluginId) {
      if (!id || id === source.pluginId) allowed = false;
      for (const listener of listeners) listener(id);
    },
  };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

describe('Agent production plugin service', () => {
  it('preserves a fault broadcast instead of calling it user cancellation', async () => {
    const f = fixture(); const started = deferred<void>();
    mocks.execute.mockImplementation(() => { started.resolve(); return new Promise(() => undefined); });
    const pending = f.service.execute(f.request).catch(error => error);
    await started.promise;
    for (const listener of f.listeners) listener(f.source.pluginId, 'fault');
    expect(await pending).toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.upstream.signal.aborted).toBe(false);
  });

  it('opens only the main-bound resource and returns host provenance after final validation', async () => {
    const f = fixture();
    await expect(f.service.execute(f.request)).resolves.toEqual({ ok: true, message: '插件文件分析已完成', data: f.result });
    expect(f.openResource).toHaveBeenCalledWith(expect.objectContaining({ ...f.authority, signal: expect.any(AbortSignal) }), expect.any(Function));
    expect(mocks.hostCreate).toHaveBeenCalledWith(f.parent, '/virtual/preload.cjs');
    expect(mocks.execute).toHaveBeenCalledWith(f.source.toolId, fingerprint, f.request.input, expect.anything());
    expect(f.assertCurrent).toHaveBeenCalledTimes(3);
    expect(f.openResource.mock.calls[0][0].signal.aborted).toBe(true);
    expect(f.resource.authorize).not.toHaveBeenCalled(); // Runtime owns actual reads; service does not bypass it.
  });

  it.each([{ pluginVersion: '0.2.0' }, { packageFingerprint: 'b'.repeat(64) },
    { pluginId: 'other.csv-tools', toolId: 'other.csv-tools.query' }])('rejects stale or substituted registration %j before opening a file', async change => {
    const f = fixture();
    await expect(f.service.execute({ ...f.request, source: sourceFor(change) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.openResource).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed provenance, a mismatched node and invalid business inputs before file access', async () => {
    const f = fixture();
    await expect(f.service.execute({ ...f.request, source: { ...f.source, registrationId: 'forged' } })).rejects.toThrow('来源无效');
    await expect(f.service.execute({ ...f.request, input: { resource: { nodeId: 8 } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.service.execute({ ...f.request, input: { resource: { nodeId: 7 }, limit: 101 } })).rejects.toThrow();
    expect(f.openResource).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([{ nodeId: 8 }, { libraryId: 4 }, { accountScope: 'user:43' }])('rejects a resource authority substituted by the opener %j', async change => {
    const f = fixture(); f.openResource.mockResolvedValue({ ...f.resource, ...change });
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('accepts only the current main window WebContents, including when another object copies its id', async () => {
    const f = fixture();
    const sender = { id: f.sender.id, isDestroyed: () => false } as WebContents;
    await expect(f.service.execute({ ...f.request, authority: { ...f.authority, sender } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.getMainWindow.mockReturnValue({ webContents: f.sender, isDestroyed: () => true } as unknown as BrowserWindow);
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.openResource).not.toHaveBeenCalled(); expect(mocks.hostCreate).not.toHaveBeenCalled();
  });

  it('rejects a changed main window after an awaited resource acquisition', async () => {
    const f = fixture(); const opening = deferred<OpenedResourceAuthority>();
    f.openResource.mockReturnValue(opening.promise);
    const running = f.service.execute(f.request);
    await vi.waitFor(() => expect(f.openResource).toHaveBeenCalledOnce());
    f.getMainWindow.mockReturnValue({ webContents: { id: 10 }, isDestroyed: () => false } as unknown as BrowserWindow);
    opening.resolve(f.resource);
    await expect(running).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['revoke', 'dispose', 'upstream'] as const)('promptly cancels a pending source open on %s even if the opener ignores AbortSignal', async stop => {
    const f = fixture(); const opening = deferred<OpenedResourceAuthority>();
    f.openResource.mockReturnValue(opening.promise);
    let rejected = false;
    const running = f.service.execute(f.request).catch(error => { rejected = true; return error; });
    await vi.waitFor(() => expect(f.openResource).toHaveBeenCalledOnce());
    if (stop === 'revoke') f.revoke();
    else if (stop === 'dispose') f.service.dispose();
    else f.upstream.abort();
    expect(f.openResource.mock.calls[0][0].signal.aborted).toBe(true);
    try { await vi.waitFor(() => expect(rejected).toBe(true), { timeout: 250, interval: 5 }); }
    finally { opening.resolve(f.resource); await running; }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('cancels a pending initial scope check without opening or launching late work', async () => {
    const f = fixture(); const guard = deferred<void>();
    f.assertCurrent.mockReturnValue(guard.promise);
    let rejected = false;
    const running = f.service.execute(f.request).catch(error => { rejected = true; return error; });
    await vi.waitFor(() => expect(f.assertCurrent).toHaveBeenCalledOnce());
    f.revoke();
    try { await vi.waitFor(() => expect(rejected).toBe(true), { timeout: 250, interval: 5 }); }
    finally { guard.resolve(); await running; }
    expect(f.openResource).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('ignores unrelated package revocation and detaches the service on disposal', async () => {
    const f = fixture(); const opening = deferred<OpenedResourceAuthority>();
    f.openResource.mockReturnValue(opening.promise);
    const running = f.service.execute(f.request);
    await vi.waitFor(() => expect(f.openResource).toHaveBeenCalledOnce());
    f.revoke('other.plugin');
    expect(f.openResource.mock.calls[0][0].signal.aborted).toBe(false);
    opening.resolve(f.resource);
    await expect(running).resolves.toMatchObject({ ok: true });
    expect(f.listeners.size).toBe(1);
    f.service.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.service.snapshot()).toEqual([]);
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.runtimeDispose).toHaveBeenCalledOnce(); expect(mocks.hostDispose).toHaveBeenCalledOnce();
  });

  it('cancels pending acquisition on a global manager stop', async () => {
    const f = fixture(); const opening = deferred<OpenedResourceAuthority>();
    f.openResource.mockReturnValue(opening.promise);
    const running = f.service.execute(f.request);
    const rejected = expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(f.openResource).toHaveBeenCalledOnce());
    for (const listener of f.listeners) listener();
    await rejected;
    opening.resolve(f.resource);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rechecks the target window after an asynchronous final scope check', async () => {
    const f = fixture();
    mocks.execute.mockImplementation(async () => {
      f.assertCurrent.mockImplementation(async () => {
        f.getMainWindow.mockReturnValue({ webContents: { id: 10 }, isDestroyed: () => false } as unknown as BrowserWindow);
      });
      return f.result;
    });
    await expect(f.service.execute(f.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an otherwise successful result when the final host scope or AI destination guard fails', async () => {
    const f = fixture();
    mocks.execute.mockImplementation(async () => {
      f.assertCurrent.mockRejectedValue(new Error('AI destination changed'));
      return f.result;
    });
    await expect(f.service.execute(f.request)).rejects.toThrow('AI destination changed');
    expect(f.openResource.mock.calls[0][0].signal.aborted).toBe(true);
  });
});

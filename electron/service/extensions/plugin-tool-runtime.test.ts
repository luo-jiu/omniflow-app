import { afterEach, describe, expect, it, vi } from 'vitest';
import sampleManifest from '../../../samples/csv-tool/manifest.json';
import { parsePluginManifest } from './manifest';
import { PluginFault, PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority, type PluginResourceAuthority } from './resource-broker';
import {
  createPluginToolCallAuthority, PluginToolRuntime,
  type PluginToolCallAuthority, type PluginToolCallBinding,
} from './plugin-tool-runtime';
import type { IsolatedPluginInstance, IsolatedPluginLoadOptions, PluginDevelopmentHost } from './isolated-view';
import type { PluginManager } from './plugin-manager';

const manifest = parsePluginManifest(sampleManifest, 'darwin');
const tool = manifest.agentTools![0];
const fingerprint = 'a'.repeat(64);
const binding: PluginToolCallBinding = {
  pluginId: manifest.id, toolId: tool.id, packageFingerprint: fingerprint,
  accountScope: 'account-2', backendScope: 'backend-1', libraryId: 3, nodeId: 17,
  sessionId: 'session-1', runId: 'run-1', toolRunId: 'tool-run-1', aiDestinationId: 'destination-1',
};
const output = { headers: ['name'], totalRows: 1, matchedRows: 1, rows: [['sample']], truncated: false };
const disposers: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, deny) => { resolve = accept; reject = deny; });
  return { promise, resolve, reject };
}

function fixture({ delayedLoad = false } = {}) {
  const listeners = new Set<(id?: string) => void>();
  const hostListeners = new Set<() => void>();
  const detach = vi.fn();
  const detachHost = vi.fn();
  let running = 0;
  let allowed = true;
  const spec = {
    plugin: { id: manifest.id, version: manifest.version, fingerprint },
    directory: '/virtual/installed/csv-tools', tool,
    registrationId: 'main-registration-1', providerName: 'example_csv-tools_query',
  };
  const manager = {
    attachRuntime: vi.fn((stop: (id?: string) => void) => {
      listeners.add(stop);
      return () => { detach(); listeners.delete(stop); };
    }),
    resolveTool: vi.fn((id: string, requestedFingerprint: string) => {
      if (!allowed || id !== tool.id || requestedFingerprint !== fingerprint) throw new PluginFault('FORBIDDEN', 'Tool unavailable');
      return spec;
    }),
    stillToolAllowed: vi.fn((id: string, requestedFingerprint: string) => allowed && id === tool.id && requestedFingerprint === fingerprint),
    started: vi.fn((_pluginId: string) => { void _pluginId; running += 1; }),
    stopped: vi.fn((_pluginId: string, _reason: string, counted = true) => { if (counted) running -= 1; }),
    requestFailed: vi.fn((_pluginId: string, _event: unknown) => { void _pluginId; void _event; }),
  };
  const bytes = Buffer.from('name\nsample');
  const resource = {
    accountScope: binding.accountScope, libraryId: binding.libraryId, nodeId: binding.nodeId,
    name: 'sample.csv', size: bytes.length, revision: 'file-revision-1',
    authorize: vi.fn(async (_signal: AbortSignal) => { void _signal; return true; }),
    currentRevision: vi.fn(async (_signal: AbortSignal) => { void _signal; return 'file-revision-1'; }),
    readRange: vi.fn(async (offset: number, length: number, _signal: AbortSignal) => { void _signal; return bytes.subarray(offset, offset + length); }),
  };
  const assertCurrent = vi.fn(async (_signal: AbortSignal) => { void _signal; });
  const upstream = new AbortController();
  const loading = deferred<IsolatedPluginInstance>();
  const loaded = deferred<{ resource: PluginResourceAuthority; options: IsolatedPluginLoadOptions; instance: IsolatedPluginInstance; broker: PluginResourceBroker }>();
  const load = vi.fn<PluginDevelopmentHost['load']>(async (_directory, authorizedResource, theme, granted, options = {}) => {
    const broker = new PluginResourceBroker(manifest, authorizedResource, theme, new PluginSettingsMemory(), undefined, undefined, options.toolExecution);
    broker.setReadGrant(granted ?? false);
    let stopped = false;
    const stop = vi.fn((reason = 'stopped') => {
      if (stopped) return;
      stopped = true; broker.dispose(); options.onStop?.(reason);
    });
    const instance = { id: 'instance-1', broker, stop } as unknown as IsolatedPluginInstance;
    loaded.resolve({ resource: authorizedResource, options, instance, broker });
    return delayedLoad ? loading.promise : instance;
  });
  const onDispose = vi.fn((listener: () => void) => {
    hostListeners.add(listener);
    return () => { detachHost(); hostListeners.delete(listener); };
  });
  const runtime = new PluginToolRuntime(manager as unknown as PluginManager, { load, onDispose } as unknown as PluginDevelopmentHost);
  disposers.push(() => runtime.dispose());
  const authority = () => createPluginToolCallAuthority(binding, resource, upstream.signal, assertCurrent);
  const execute = (capability = authority(), input: unknown = { resource: { nodeId: binding.nodeId } }) => runtime.execute(tool.id, fingerprint, input, capability);
  const revoke = (pluginId: string | undefined = manifest.id) => {
    if (pluginId === manifest.id || pluginId === undefined) allowed = false;
    for (const listener of listeners) listener(pluginId);
  };
  const disposeHost = () => { for (const listener of hostListeners) listener(); };
  return { runtime, manager, spec, resource, assertCurrent, upstream, authority, execute, loaded, loading, load, listeners, hostListeners, detach, detachHost, revoke, disposeHost, get running() { return running; } };
}

let requestId = 0;
async function rpc(broker: PluginResourceBroker, method: string, params: Record<string, unknown> = {}) {
  return JSON.parse(await broker.exchange(JSON.stringify({ version: 1, id: `runtime-test-${++requestId}`, method, params })));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe('Plugin Tool main runtime', () => {
  it('binds package and resource provenance in main and passes only business parameters into the isolated call', async () => {
    const f = fixture();
    const capability = f.authority();
    const input = { resource: { nodeId: binding.nodeId }, column: 0, equals: 'sample', limit: 1 };
    const execution = f.execute(capability, input);
    const active = await f.loaded.promise;
    expect(f.runtime.size).toBe(1);
    expect(f.manager.resolveTool).toHaveBeenCalledWith(tool.id, fingerprint);
    expect(f.load).toHaveBeenCalledWith(f.spec.directory, expect.anything(), expect.anything(), true,
      expect.objectContaining({ expectedFingerprint: fingerprint }));
    expect(active.options.toolExecution?.input).toEqual({ column: 0, equals: 'sample', limit: 1 });
    expect(Object.isFrozen(active.options.toolExecution?.input)).toBe(true);
    input.equals = 'mutated after admission';
    expect(active.options.toolExecution?.input.equals).toBe('sample');
    active.options.toolExecution!.complete(output);
    await expect(execution).resolves.toEqual({ output, source: {
      pluginId: manifest.id, version: manifest.version, fingerprint, toolId: tool.id,
      registrationId: f.spec.registrationId, nodeId: binding.nodeId, resourceRevision: f.resource.revision,
    } });
    expect(f.runtime.size).toBe(0);
    expect(f.manager.started).toHaveBeenCalledTimes(1);
    expect(f.manager.started).toHaveBeenCalledWith(manifest.id);
    expect(f.running).toBe(0);
    expect(active.instance.stop).toHaveBeenCalledWith('completed');
    expect(active.options.signal?.aborted).toBe(true);
    await expect(f.execute(capability)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it('rejects forged capabilities and mismatched owner, resource or directory scope at issuance', async () => {
    const f = fixture();
    await expect(f.execute({ ...binding } as unknown as PluginToolCallAuthority)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const change of [
      { accountScope: 'other-account' }, { libraryId: 4 }, { nodeId: 18 }, { backendScope: '' },
      { sessionId: '' }, { runId: '' }, { toolRunId: '' }, { aiDestinationId: '' },
      { pluginId: 'invalid' }, { pluginId: 'invalid/name' }, { pluginId: `example.${'a'.repeat(96)}` },
      { toolId: 'other.plugin.query' }, { toolId: `${manifest.id}.` }, { toolId: `${manifest.id}.invalid/name` },
      { toolId: `${manifest.id}.${'a'.repeat(128)}` },
      { packageFingerprint: '' }, { packageFingerprint: 'a'.repeat(63) }, { packageFingerprint: 'g'.repeat(64) },
    ]) {
      expect(() => createPluginToolCallAuthority({ ...binding, ...change }, f.resource, f.upstream.signal, f.assertCurrent)).toThrow(PluginFault);
    }
    const directoryResource: OpenedResourceAuthority = {
      ...f.resource, directory: { type: 'COMIC', entries: [], open: async () => f.resource },
    };
    expect(() => createPluginToolCallAuthority(binding, directoryResource, f.upstream.signal, f.assertCurrent)).toThrow(PluginFault);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.runtime.size).toBe(0);
  });

  it('rejects changing the Tool or package fingerprint and consumes the mismatched capability', async () => {
    for (const change of [{ toolId: `${manifest.id}.other`, fingerprint }, { toolId: tool.id, fingerprint: 'b'.repeat(64) }]) {
      const f = fixture(); const capability = f.authority();
      await expect(f.runtime.execute(change.toolId, change.fingerprint, { resource: { nodeId: binding.nodeId } }, capability)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(f.execute(capability)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.manager.resolveTool).not.toHaveBeenCalled();
      expect(f.assertCurrent).not.toHaveBeenCalled();
      expect(f.load).not.toHaveBeenCalled();
      expect(f.runtime.size).toBe(0);
    }
  });

  it('rejects a resolved package or contribution that differs from the main call binding', async () => {
    for (const identity of ['plugin', 'tool', 'fingerprint'] as const) {
      const f = fixture();
      if (identity === 'plugin') f.spec.plugin.id = 'other.plugin';
      else if (identity === 'tool') f.spec.tool = { ...tool, id: `${manifest.id}.other` };
      else f.spec.plugin.fingerprint = 'b'.repeat(64);
      await expect(f.execute()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.assertCurrent).not.toHaveBeenCalled();
      expect(f.load).not.toHaveBeenCalled();
      expect(f.runtime.size).toBe(0);
    }
  });

  it('maps manager resolution failures to a bounded PluginFault and does not expose internal errors', async () => {
    const f = fixture();
    f.manager.resolveTool.mockImplementationOnce(() => { throw new Error('private manager storage details'); });
    await expect(f.execute()).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Tool package unavailable' });
    expect(f.load).not.toHaveBeenCalled();
    expect(f.runtime.size).toBe(0);
  });

  it('rejects input nodeId mismatch before loading and consumes that invocation authority', async () => {
    const f = fixture(); const capability = f.authority();
    await expect(f.execute(capability, { resource: { nodeId: binding.nodeId + 1 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.execute(capability)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.assertCurrent).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.runtime.size).toBe(0);
  });

  it('uses live scope checks before and after resource.read and never delivers bytes after revocation', async () => {
    const f = fixture(); const execution = f.execute(); const active = await f.loaded.promise;
    expect((await rpc(active.broker, 'lifecycle.ready')).ok).toBe(true);
    expect((await rpc(active.broker, 'tool.invocation')).ok).toBe(true);
    f.assertCurrent.mockClear();
    const first = await rpc(active.broker, 'resource.read', { handle: active.broker.handle, offset: 0, length: f.resource.size });
    expect(first.ok).toBe(true);
    expect(Buffer.from(first.value.base64, 'base64').toString()).toBe('name\nsample');
    expect(f.assertCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);
    f.resource.readRange.mockImplementationOnce(async () => {
      f.assertCurrent.mockRejectedValue(new PluginFault('FORBIDDEN', 'Run scope revoked'));
      return Buffer.from('name\nsample');
    });
    const revoked = await rpc(active.broker, 'resource.read', { handle: active.broker.handle, offset: 0, length: f.resource.size });
    expect(revoked).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(revoked).not.toHaveProperty('value');
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    f.revoke(); await rejected;
    expect(f.runtime.size).toBe(0);
  });

  it('cancels the matching plugin and stops a load that resolves after revocation', async () => {
    const f = fixture({ delayedLoad: true });
    const execution = f.execute(); const active = await f.loaded.promise;
    f.revoke('unrelated.plugin');
    expect(active.options.signal?.aborted).toBe(false);
    expect(f.runtime.size).toBe(1);
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    f.revoke(); await rejected;
    expect(f.runtime.size).toBe(0);
    expect(active.instance.stop).not.toHaveBeenCalled();
    f.loading.resolve(active.instance);
    await Promise.resolve(); await Promise.resolve();
    expect(active.instance.stop).toHaveBeenCalledWith('cancelled');
    expect(f.manager.started).not.toHaveBeenCalled();
    expect(f.running).toBe(0);
    expect(active.broker.alive).toBe(false);
    active.options.toolExecution!.complete(output);
    expect(f.runtime.size).toBe(0);
  });

  it('honors upstream cancellation and discards a late completion', async () => {
    const f = fixture(); const execution = f.execute(); const active = await f.loaded.promise;
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    f.upstream.abort(); await rejected;
    active.options.toolExecution!.complete(output);
    expect(active.instance.stop).toHaveBeenCalledWith('cancelled');
    expect(f.runtime.size).toBe(0);
  });

  it('times out even when the main authorization adapter never settles or observes abort', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.assertCurrent.mockImplementation(() => new Promise<void>(() => {}));
    const execution = f.execute();
    const rejected = expect(execution).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(f.runtime.size).toBe(1);
    await vi.advanceTimersByTimeAsync(tool.timeoutMs);
    await rejected;
    expect(f.assertCurrent.mock.calls[0][0].aborted).toBe(true);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.runtime.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('revalidates the resource revision after completion before accepting a result', async () => {
    const f = fixture(); const execution = f.execute(); const active = await f.loaded.promise;
    f.resource.currentRevision.mockResolvedValue('file-revision-2');
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
    active.options.toolExecution!.complete(output); await rejected;
    expect(f.resource.currentRevision).toHaveBeenCalled();
    expect(active.instance.stop).toHaveBeenCalledWith('failed');
    expect(f.runtime.size).toBe(0);
  });

  it('propagates a broker completion rejection immediately instead of leaving the call waiting for timeout', async () => {
    for (const changed of ['permission', 'revision'] as const) {
      const f = fixture(); const execution = f.execute(); const active = await f.loaded.promise;
      await rpc(active.broker, 'lifecycle.ready');
      const invocation = await rpc(active.broker, 'tool.invocation');
      if (changed === 'permission') f.resource.authorize.mockResolvedValue(false);
      else f.resource.currentRevision.mockResolvedValue('file-revision-2');
      const code = changed === 'permission' ? 'FORBIDDEN' : 'CONTENT_CHANGED';
      const rejected = expect(execution).rejects.toMatchObject({ code });
      const completed = await rpc(active.broker, 'tool.complete', { invocationId: invocation.value.invocationId, output });
      expect(completed).toMatchObject({ ok: false, error: { code } });
      await rejected;
      expect(f.runtime.size).toBe(0);
      expect(active.broker.alive).toBe(false);
    }
  });

  it('rejects a result when its package or authorization changes after execution starts', async () => {
    for (const changed of ['package', 'resource'] as const) {
      const f = fixture(); const execution = f.execute(); const active = await f.loaded.promise;
      if (changed === 'package') f.manager.stillToolAllowed.mockReturnValue(false);
      else f.resource.authorize.mockResolvedValue(false);
      const rejected = expect(execution).rejects.toMatchObject({ code: 'FORBIDDEN' });
      active.options.toolExecution!.complete(output); await rejected;
      expect(f.runtime.size).toBe(0);
      expect(active.instance.stop).toHaveBeenCalledWith('failed');
    }
  });

  it('disposes once, detaches its manager listener and cancels all admitted calls', async () => {
    const f = fixture(); const execution = f.execute(); await f.loaded.promise;
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.listeners.size).toBe(1);
    f.runtime.dispose(); f.runtime.dispose();
    await rejected;
    expect(f.detach).toHaveBeenCalledTimes(1);
    expect(f.detachHost).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
    expect(f.hostListeners.size).toBe(0);
    expect(f.runtime.size).toBe(0);
    expect(f.running).toBe(0);
    await expect(f.execute()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('cancels pending authorization when the host closes, even if the guard ignores its signal', async () => {
    const f = fixture(); const authorizing = deferred<void>();
    f.assertCurrent.mockImplementation(() => {
      authorizing.resolve();
      return new Promise<void>(() => {});
    });
    const execution = f.execute(); await authorizing.promise;
    const rejected = expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    f.disposeHost(); await rejected;
    expect(f.load).not.toHaveBeenCalled();
    expect(f.runtime.size).toBe(0);
    expect(f.detach).toHaveBeenCalledTimes(1);
    expect(f.detachHost).toHaveBeenCalledTimes(1);
    expect(f.hostListeners.size).toBe(0);
    await expect(f.execute()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not count an instance that already stopped while its load was pending', async () => {
    const f = fixture({ delayedLoad: true });
    const execution = f.execute(); const active = await f.loaded.promise;
    const rejected = expect(execution).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    active.options.onDiagnostic?.({ type: 'rpc', instanceId: active.instance.id, method: 'resource.read', code: 'FORBIDDEN' });
    active.instance.stop('renderer-gone');
    f.loading.resolve(active.instance);
    await rejected;
    expect(f.manager.requestFailed).toHaveBeenCalledWith(manifest.id, expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(f.manager.stopped).toHaveBeenCalledWith(manifest.id, 'renderer-gone', false);
    expect(f.manager.started).not.toHaveBeenCalled();
    expect(f.running).toBe(0);
    expect(f.runtime.size).toBe(0);
  });
});

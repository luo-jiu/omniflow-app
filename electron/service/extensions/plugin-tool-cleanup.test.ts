import { afterEach, describe, expect, it, vi } from 'vitest';
import manifestJson from '../../../samples/csv-tool/manifest.json';
import { parsePluginManifest } from './manifest';
import { PluginManager } from './plugin-manager';
import { PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority } from './resource-broker';
import { createPluginToolCallAuthority, PluginToolRuntime } from './plugin-tool-runtime';
import type { IsolatedPluginInstance, IsolatedPluginLoadOptions, PluginDevelopmentHost } from './isolated-view';

const manifest = parsePluginManifest(manifestJson, 'darwin');
const tool = manifest.agentTools![0];
const fingerprint = 'a'.repeat(64);
const output = { headers: ['name'], totalRows: 1, matchedRows: 1, rows: [['sample']], truncated: false };
const disposers: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture() {
  // Keep the real stopped -> quarantine -> stopRuntimes broadcast. A counter-only
  // stopped mock misses the reentrant cancellation that happens in production.
  const manager = new PluginManager('/unused/plugin-cleanup-store', '/unused/bundled');
  vi.spyOn(manager.installs, 'recordFailure').mockResolvedValue();
  vi.spyOn(manager, 'resolveTool').mockReturnValue({
    plugin: { id: manifest.id, version: manifest.version, fingerprint },
    tool, directory: '/unused/plugin', registrationId: 'registration', providerName: 'provider',
  } as ReturnType<PluginManager['resolveTool']>);
  vi.spyOn(manager, 'stillToolAllowed').mockReturnValue(true);
  const started = vi.spyOn(manager, 'started');
  const stopped = vi.spyOn(manager, 'stopped');
  const resource: OpenedResourceAuthority = {
    accountScope: 'account', libraryId: 3, nodeId: 7, name: 'sample.csv', size: 1, revision: 'v1',
    authorize: vi.fn(async () => true), currentRevision: vi.fn(async () => 'v1'),
    readRange: vi.fn(async () => new Uint8Array([1])),
  };
  const loaded = deferred<{ instance: IsolatedPluginInstance; options: IsolatedPluginLoadOptions }>();
  const load = vi.fn<PluginDevelopmentHost['load']>(async (_directory, authority, theme, granted, options = {}) => {
    const broker = new PluginResourceBroker(manifest, authority, theme, new PluginSettingsMemory(), undefined, undefined, options.toolExecution);
    broker.setReadGrant(granted ?? false);
    let disposed = false;
    const instance = {
      id: 'cleanup-instance', broker,
      stop: vi.fn((reason = 'stopped') => {
        if (disposed) return;
        disposed = true;
        broker.dispose();
        options.onStop?.(reason);
      }),
    } as unknown as IsolatedPluginInstance;
    loaded.resolve({ instance, options });
    return instance;
  });
  const runtime = new PluginToolRuntime(manager, { load, onDispose: () => () => undefined } as unknown as PluginDevelopmentHost);
  disposers.push(() => runtime.dispose());
  const capability = createPluginToolCallAuthority({
    pluginId: manifest.id, toolId: tool.id, packageFingerprint: fingerprint,
    accountScope: resource.accountScope, backendScope: 'backend', libraryId: 3, nodeId: 7,
    sessionId: 'session', runId: 'run', toolRunId: 'tool-run', aiDestinationId: 'destination',
  }, resource, new AbortController().signal, async () => undefined);
  const execution = runtime.execute(tool.id, fingerprint, { resource: { nodeId: 7 } }, capability);
  return { manager, started, stopped, runtime, loaded, execution };
}

afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

describe('AT2 plugin Tool cleanup and terminal races', () => {
  it('reports a renderer fault as unavailable despite the manager broadcasting quarantine cancellation', async () => {
    const f = fixture();
    const result = f.execution.catch(error => error);
    const active = await f.loaded.promise;
    // Let load return and manager.started finish before injecting a renderer crash.
    await vi.waitFor(() => expect(f.started).toHaveBeenCalledOnce());
    active.instance.stop('renderer-gone');
    expect(await result).toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.runtime.size).toBe(0);
    expect(f.stopped).toHaveBeenCalledOnce();
    expect(f.stopped).toHaveBeenCalledWith(manifest.id, 'renderer-gone', true);
    expect(f.manager.catalog().logs).toContainEqual(expect.objectContaining({ code: 'renderer-gone' }));
  });

  it.each(['new-id', 'reused-id'])('rejects a duplicate terminal RPC (%s) without replacing the first completion waiting for authorization', async reuse => {
    const authorization = deferred<boolean>();
    const authorizing = deferred<void>();
    const authorize = vi.fn(async () => true);
    const complete = vi.fn();
    const reject = vi.fn();
    const broker = new PluginResourceBroker(manifest, {
      accountScope: 'account', libraryId: 3, nodeId: 7, name: 'sample.csv', size: 1, revision: 'v1',
      authorize, currentRevision: async () => 'v1', readRange: async () => new Uint8Array([1]),
    }, { schemaVersion: 1, revision: 1, mode: 'light', colors: {} }, new PluginSettingsMemory(),
    undefined, undefined, { contribution: tool, invocationId: 'invocation', input: {}, complete, reject, fail: vi.fn() });
    broker.setReadGrant(true);
    disposers.push(() => broker.dispose());
    let requestId = 0;
    const rpc = async (method: string, params = {}) => JSON.parse(await broker.exchange(JSON.stringify({ version: 1, id: `cleanup-${++requestId}`, method, params })));
    await rpc('lifecycle.ready');
    await rpc('tool.invocation');
    authorize.mockImplementationOnce(() => { authorizing.resolve(); return authorization.promise; });
    const first = rpc('tool.complete', { invocationId: 'invocation', output });
    await authorizing.promise;
    if (reuse === 'reused-id') requestId--;
    const duplicate = await rpc('tool.complete', { invocationId: 'invocation', output });
    authorization.resolve(true);
    expect(await first).toMatchObject({ ok: true });
    expect(duplicate).toMatchObject({ ok: false, error: { code: reuse === 'reused-id' ? 'BAD_REQUEST' : 'UNAVAILABLE' } });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(output);
    expect(reject).not.toHaveBeenCalled();
  });
});

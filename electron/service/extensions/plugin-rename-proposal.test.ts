import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginClient, type PluginRenameProposalToolContribution } from '../../../packages/plugin-sdk/index.js';
import { parsePluginManifest } from './manifest';
import { RENAME_PROPOSAL_OUTPUT_SCHEMA, validateToolInput, validateToolOutput } from './tool-schema';
import { PluginResourceBroker, PluginSettingsMemory, type MetadataResourceAuthority } from './resource-broker';
import { createPluginMetadataCallAuthority, PluginToolRuntime, type PluginMetadataCallAuthority, type PluginMetadataCallBinding, type PluginToolCallAuthority } from './plugin-tool-runtime';
import type { PluginManager } from './plugin-manager';
import type { IsolatedPluginInstance, IsolatedPluginLoadOptions, PluginDevelopmentHost } from './isolated-view';

const contribution: PluginRenameProposalToolContribution = {
  kind: 'rename-proposal', id: 'test.rename.prefix', title: 'Prefix names', description: 'Propose a prefix', entry: 'rename.html',
  resourceAccess: [{ parameter: 'resources', mode: 'metadata', kind: 'file', maxItems: 50 }], timeoutMs: 30000, maxResultBytes: 32768,
  inputSchema: { type: 'object', additionalProperties: false, required: ['resources', 'prefix'], properties: {
    resources: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
    prefix: { type: 'string', maxLength: 80 },
  } },
  outputSchema: RENAME_PROPOSAL_OUTPUT_SCHEMA,
};
const manifestInput = { formatVersion: 2, id: 'test.rename', version: '1.0.0', sdkVersion: 1, minHostVersion: '0.2.2', platforms: ['darwin'],
  permissions: ['resource.rename.propose', 'agent.tools'], activation: ['tool:test.rename.prefix'], agentTools: [contribution] };
const manifest = parsePluginManifest(manifestInput, 'darwin');
const fingerprint = 'a'.repeat(64);
const binding: PluginMetadataCallBinding = { pluginId: manifest.id, toolId: contribution.id, packageFingerprint: fingerprint,
  accountScope: 'account', backendScope: 'backend', libraryId: 3, nodeIds: [17, 18],
  sessionId: 'session', runId: 'run', toolRunId: 'tool-run', aiDestinationId: 'ai-destination' };
const output = { changes: [{ id: 'opaque-first', name: 'trip_first.jpg' }, { id: 'opaque-second', name: 'trip_second.jpg' }] };
const cleanup: Array<() => void> = [];
function metadata() {
  return { kind: 'metadata' as const, accountScope: binding.accountScope, libraryId: binding.libraryId, revision: 'metadata-r1',
    files: [{ id: 'opaque-first', name: 'first.jpg' }, { id: 'opaque-second', name: 'second.jpg' }],
    authorize: vi.fn(async (_signal: AbortSignal) => { void _signal; return true; }),
    currentRevision: vi.fn(async (_signal: AbortSignal) => { void _signal; return 'metadata-r1'; }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function fixture() {
  const resource = metadata(); const upstream = new AbortController();
  const assertCurrent = vi.fn(async (_signal: AbortSignal) => { void _signal; });
  const listeners = new Set<(id?: string, reason?: 'operation' | 'fault') => void>();
  const manager = { attachRuntime: (listener: (id?: string, reason?: 'operation' | 'fault') => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resolveTool: vi.fn(() => ({ plugin: { id: manifest.id, version: manifest.version, fingerprint }, tool: contribution, directory: '/test/rename', registrationId: 'registered' })),
    stillToolAllowed: vi.fn(() => true), started: vi.fn(), stopped: vi.fn(), requestFailed: vi.fn() };
  const loaded = deferred<{ broker: PluginResourceBroker; options: IsolatedPluginLoadOptions; instance: IsolatedPluginInstance; resource: MetadataResourceAuthority }>();
  const load = vi.fn<PluginDevelopmentHost['load']>(async (_directory, scope, theme, granted, options = {}) => {
    const broker = new PluginResourceBroker(manifest, scope, theme, new PluginSettingsMemory(), undefined, undefined, options.toolExecution);
    broker.setReadGrant(granted ?? false);
    const instance = { broker, stop: vi.fn((reason?: string) => { broker.dispose(); options.onStop?.(reason ?? 'stopped'); }) } as unknown as IsolatedPluginInstance;
    loaded.resolve({ broker, options, instance, resource: scope as MetadataResourceAuthority }); return instance;
  });
  const runtime = new PluginToolRuntime(manager as unknown as PluginManager, { load, onDispose: () => () => undefined } as unknown as PluginDevelopmentHost);
  cleanup.push(() => runtime.dispose());
  const authority = () => createPluginMetadataCallAuthority(binding, resource, upstream.signal, assertCurrent);
  const execute = (capability = authority(), input: unknown = { resources: [17, 18], prefix: 'trip_' }) => runtime.executeRenameProposal(contribution.id, fingerprint, input, capability);
  return { resource, upstream, assertCurrent, manager, listeners, loaded, load, runtime, authority, execute };
}
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); vi.useRealTimers(); });

describe('metadata rename Tool declaration', () => {
  it('keeps rename proposals explicit and does not reuse body or directory permission', () => {
    expect(manifest.viewers).toEqual([]);
    for (const patch of [
      { formatVersion: 1 }, { permissions: ['agent.tools'] }, { permissions: ['resource.rename.propose'] },
      { permissions: ['resource.read', 'agent.tools', 'resource.rename.propose'] },
      { permissions: ['directory.read', 'agent.tools', 'resource.rename.propose'] },
      { entry: 'view.html', viewers: [{ id: 'test.rename.viewer', title: 'Viewer', extensions: ['jpg'] }], activation: ['viewer:test.rename.viewer', ...manifestInput.activation] },
    ]) expect(() => parsePluginManifest({ ...manifestInput, ...patch }, 'darwin')).toThrow();
    for (const patch of [{ kind: undefined }, { kind: 'write' }, { resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }] }]) {
      expect(() => parsePluginManifest({ ...manifestInput, agentTools: [{ ...contribution, ...patch }] }, 'darwin')).toThrow();
    }
  });

  it('rejects unbounded, nonunique and ambiguous resource schemas and malformed inputs', () => {
    for (const patch of [{ minItems: 0 }, { maxItems: 51 }, { uniqueItems: false }, { items: { type: 'integer', minimum: 1, maximum: 100 } }]) {
      const inputSchema = structuredClone(contribution.inputSchema);
      Object.assign(inputSchema.properties!.resources, patch);
      expect(() => parsePluginManifest({ ...manifestInput, agentTools: [{ ...contribution, inputSchema }] }, 'darwin')).toThrow();
    }
    for (const resources of [[], [17, 17], [17, '18'], [0], [-1], [Number.MAX_SAFE_INTEGER + 1], [{ nodeId: 17 }], Array.from({ length: 51 }, (_, i) => i + 1)]) {
      expect(() => validateToolInput(contribution, { resources, prefix: '' })).toThrow();
    }
    expect(() => validateToolInput(contribution, { resources: [17], prefix: '' })).not.toThrow();
  });

  it('requires the fixed bounded proposal result without paths, actions or extra properties', () => {
    expect(() => validateToolOutput(contribution, { changes: [] })).not.toThrow();
    expect(() => validateToolOutput(contribution, output)).not.toThrow();
    for (const value of [{ changes: [{ id: 'x', name: '' }] }, { changes: [{ id: 'x', name: 'x'.repeat(241) }] },
      { changes: [{ id: 'x'.repeat(65), name: 'valid.jpg' }] }, { changes: [{ id: 'x', name: 'valid.jpg', path: '/other' }] },
      { changes: [], instructions: 'write everything' }, { changes: Array.from({ length: 51 }, () => ({ id: 'x', name: 'a.jpg' })) }]) {
      expect(() => validateToolOutput(contribution, value)).toThrow();
    }
    const widened = structuredClone(RENAME_PROPOSAL_OUTPUT_SCHEMA);
    widened.properties!.changes.items!.properties!.name.maxLength = 512;
    expect(() => parsePluginManifest({ ...manifestInput, agentTools: [{ ...contribution, outputSchema: widened }] }, 'darwin')).toThrow();
  });
});

describe('metadata rename sandbox and main authority', () => {
  it('provides only opaque metadata and accepts a single proposal without exposing a file handle', async () => {
    const f = fixture(); const capability = f.authority();
    const executing = f.execute(capability); const active = await f.loaded.promise;
    const client = createPluginClient({ exchange: raw => active.broker.exchange(raw), subscribe: () => () => undefined });
    cleanup.push(() => client.dispose());
    expect(await client.context()).toMatchObject({ kind: 'tool', toolId: contribution.id, resource: null, readGranted: false,
      capabilities: ['resource.rename.propose', 'tool.invoke', 'lifecycle'] });
    await client.ready();
    const invocation = await client.toolInvocation();
    expect(invocation.input).toEqual({ parameters: { prefix: 'trip_' }, files: f.resource.files });
    expect(JSON.stringify(invocation)).not.toMatch(/nodeId|libraryId|accountScope|backendScope|resources/);
    expect(active.resource).not.toHaveProperty('nodeId');
    expect(active.resource).not.toHaveProperty('readRange');
    for (const attempt of [() => client.read(active.broker.handle, 0, 1), () => client.listDirectory(active.broker.handle),
      () => client.openDirectoryEntry(active.broker.handle, 'opaque-first'), () => client.releaseResource(active.broker.handle),
      () => client.getState(), () => client.getSetting('name'), () => client.setState({}, 0), () => client.setSetting('name', true, 0)]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    }
    await client.completeTool(invocation.invocationId, output);
    await expect(executing).resolves.toEqual({ output, source: { pluginId: manifest.id, version: manifest.version, fingerprint,
      toolId: contribution.id, registrationId: 'registered', nodeIds: [17, 18], resourceRevision: 'metadata-r1' } });
    expect(active.instance.stop).toHaveBeenCalledWith('completed');
    client.dispose();
    await expect(client.completeTool(invocation.invocationId, output)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(f.execute(capability)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.runtime.size).toBe(0);
  });

  it('rejects forged, reordered or widened metadata authority and consumes failed capabilities', async () => {
    const f = fixture();
    await expect(f.execute({} as PluginMetadataCallAuthority)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const patch of [{ nodeIds: [] }, { nodeIds: [17, 17] }, { nodeIds: [17] }, { nodeIds: [17, 0] }, { libraryId: 4 },
      { accountScope: 'other' }, { backendScope: '' }, { toolId: 'other.plugin.tool' }, { packageFingerprint: 'bad' },
      { runId: '' }, { sessionId: '' }, { toolRunId: '' }, { aiDestinationId: '' }]) {
      expect(() => createPluginMetadataCallAuthority({ ...binding, ...patch }, f.resource, f.upstream.signal, f.assertCurrent)).toThrow();
    }
    for (const resources of [[18, 17], [17], [17, 19]]) {
      const cap = f.authority();
      await expect(f.execute(cap, { resources, prefix: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(f.execute(cap)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(f.runtime.execute(contribution.id, fingerprint, { resources: [17, 18], prefix: 'x' }, f.authority() as unknown as PluginToolCallAuthority)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.load).not.toHaveBeenCalled();
  });

  it('freezes the granted files and node mapping at authority issuance', async () => {
    const f = fixture(); const cap = f.authority();
    f.resource.files[0].name = 'changed.jpg';
    f.resource.files.push({ id: 'injected', name: 'secret.jpg' });
    const executing = f.execute(cap); const active = await f.loaded.promise;
    expect(active.options.toolExecution?.input.files).toEqual([{ id: 'opaque-first', name: 'first.jpg' }, { id: 'opaque-second', name: 'second.jpg' }]);
    active.options.toolExecution!.complete(output);
    await expect(executing).resolves.toMatchObject({ source: { nodeIds: [17, 18] } });
  });

  it.each(['unknown', 'duplicate'])('rejects %s opaque target IDs', async kind => {
    const f = fixture(); const executing = f.execute(); const active = await f.loaded.promise;
    const rejected = expect(executing).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    active.options.toolExecution!.complete({ changes: kind === 'unknown' ? [{ id: 'not-granted', name: 'file.jpg' }] : [output.changes[0], output.changes[0]] });
    await rejected; expect(active.instance.stop).toHaveBeenCalledWith('failed');
  });

  it.each(['permission', 'revision', 'package'])('rejects a proposal after %s drift', async kind => {
    const f = fixture(); const executing = f.execute(); const active = await f.loaded.promise;
    if (kind === 'permission') f.resource.authorize.mockResolvedValue(false);
    if (kind === 'revision') f.resource.currentRevision.mockResolvedValue('r2');
    if (kind === 'package') f.manager.stillToolAllowed.mockReturnValue(false);
    const rejected = expect(executing).rejects.toMatchObject({ code: kind === 'revision' ? 'CONTENT_CHANGED' : 'FORBIDDEN' });
    active.options.toolExecution!.complete(output); await rejected;
    expect(f.runtime.size).toBe(0);
  });

  it.each(['cancel', 'disable', 'fault'])('preserves %s terminal semantics and discards late proposals', async kind => {
    const f = fixture(); const executing = f.execute(); const active = await f.loaded.promise;
    const rejected = expect(executing).rejects.toMatchObject({ code: kind === 'fault' ? 'UNAVAILABLE' : 'CANCELLED' });
    if (kind === 'cancel') f.upstream.abort();
    else for (const listener of f.listeners) listener(manifest.id, kind === 'fault' ? 'fault' : 'operation');
    await rejected; active.options.toolExecution!.complete(output);
    expect(f.runtime.size).toBe(0); expect(active.broker.alive).toBe(false);
  });

  it('times out preparation even when a metadata authorization adapter ignores cancellation', async () => {
    vi.useFakeTimers(); const f = fixture(); f.resource.authorize.mockImplementation(() => new Promise<boolean>(() => {}));
    const rejected = expect(f.execute()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(contribution.timeoutMs); await rejected;
    expect(f.load).not.toHaveBeenCalled(); expect(f.runtime.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

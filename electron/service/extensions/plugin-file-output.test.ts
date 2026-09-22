import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginClient, LIMITS, type PluginFileOutput } from '../../../packages/plugin-sdk/index.js';
import outputManifest from '../../../samples/csv-export/manifest.json';
import readManifest from '../../../samples/csv-tool/manifest.json';
import { parsePluginManifest } from './manifest';
import { validateToolInput } from './tool-schema';
import { PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority } from './resource-broker';
import { createPluginToolCallAuthority, PluginToolRuntime } from './plugin-tool-runtime';
import type { IsolatedPluginInstance, PluginDevelopmentHost } from './isolated-view';
import type { PluginManager } from './plugin-manager';

const manifest = parsePluginManifest(outputManifest, 'darwin');
const contribution = manifest.agentTools![0];
if (contribution.kind !== 'file-output') throw new Error('Expected file output fixture');
const tool = contribution;
const fingerprint = 'a'.repeat(64);
const input = { resource: { nodeId: 17 }, destination: { parentId: 10, fileName: 'export.csv' }, format: 'csv', column: 0, equals: 'yes' };
const binding = { pluginId: manifest.id, toolId: tool.id, packageFingerprint: fingerprint, accountScope: 'account', backendScope: 'backend', libraryId: 3,
  nodeId: 17, sessionId: 'session', runId: 'run', toolRunId: 'tool', aiDestinationId: 'destination' };
const theme = { schemaVersion: 1 as const, revision: 1, mode: 'light' as const, colors: {} };
const cleanups: Array<() => void> = [];
const result: PluginFileOutput = { mediaType: 'text/csv', text: 'name\r\nhello\r\n' };
let requestId = 0;
async function rpc(broker: PluginResourceBroker, method: string, params: Record<string, unknown> = {}) {
  return JSON.parse(await broker.exchange(JSON.stringify({ version: 1, id: `output-${++requestId}`, method, params })));
}
function fixture(selected = manifest) {
  const resource = { accountScope: 'account', libraryId: 3, nodeId: 17, name: 'source.csv', size: 1, revision: 'r1',
    authorize: vi.fn(async () => true), currentRevision: vi.fn(async () => 'r1'), readRange: vi.fn(async () => Buffer.from('a')) };
  const execution = { contribution: selected.agentTools![0], invocationId: 'invocation', input: { format: 'csv' }, complete: vi.fn(), reject: vi.fn(), fail: vi.fn() };
  const broker = new PluginResourceBroker(selected, resource, theme, new PluginSettingsMemory(), undefined, undefined, execution); broker.setReadGrant(true);
  const wires: string[] = [];
  const client = createPluginClient({ subscribe: () => () => undefined, exchange: raw => { wires.push(raw); return broker.exchange(raw); } });
  cleanups.push(() => { client.dispose(); broker.dispose(); });
  return { resource, execution, broker, client, wires };
}
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); vi.useRealTimers(); });

describe('file output manifest and SDK protocol', () => {
  it('requires source, host destination and independent output permission without expanding JSON result schemas', () => {
    expect(manifest.permissions).toEqual(['resource.read', 'resource.output.propose', 'agent.tools']);
    for (const patch of [{ permissions: ['resource.read', 'agent.tools'] }, { permissions: ['resource.output.propose', 'agent.tools'] },
      { agentTools: [{ ...tool, maxResultBytes: 32768 }] }, { agentTools: [{ ...tool, outputSchema: { type: 'object' } }] },
      { agentTools: [{ ...tool, output: { mediaTypes: [], maxBytes: 1 } }] }, { agentTools: [{ ...tool, output: { mediaTypes: ['text/html'], maxBytes: 1 } }] },
      { agentTools: [{ ...tool, output: { mediaTypes: ['text/csv'], maxBytes: LIMITS.fileOutputBytes + 1 } }] }]) {
      expect(() => parsePluginManifest({ ...outputManifest, ...patch }, 'darwin')).toThrow();
    }
    expect(() => validateToolInput(tool, input)).not.toThrow();
    for (const changed of [{ ...input, destination: undefined }, { ...input, destination: { parentId: 0, fileName: 'x.csv' } },
      { ...input, destination: { parentId: 10, fileName: '../x.csv' } }, { ...input, destination: { parentId: 10, fileName: '中'.repeat(81) } }]) {
      expect(() => validateToolInput(tool, changed)).toThrow();
    }
  });

  it('delivers a complete 1MiB output as canonical base64 with no larger generic completion quota', async () => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    expect(await f.client.context()).toMatchObject({ kind: 'tool', capabilities: ['resource.read', 'resource.output.propose', 'tool.invoke', 'lifecycle'], output: tool.output });
    const output = { ...result, text: 'x'.repeat(LIMITS.fileOutputBytes) };
    await f.client.completeFileOutput('invocation', output);
    expect(f.execution.complete).toHaveBeenCalledOnce(); expect(f.execution.complete).toHaveBeenCalledWith(output);
    const wire = f.wires.find(raw => JSON.parse(raw).method === 'tool.output.complete')!;
    const request = JSON.parse(wire);
    expect(Buffer.byteLength(wire)).toBeLessThanOrEqual(LIMITS.fileOutputRequestBytes);
    expect(request.params.base64).toBe(Buffer.from(output.text).toString('base64'));
    expect(Object.keys(request.params)).toEqual(['invocationId', 'mediaType', 'base64']);
    await expect(f.client.completeFileOutput('invocation', output)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('rejects empty, oversized, undeclared and malformed UTF-8 outputs without accepting a terminal result', async () => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    for (const output of [{ ...result, text: '' }, { ...result, text: '\ud800' }, { ...result, text: '中'.repeat(349526) },
      { mediaType: 'text/html', text: 'html' }]) await expect(f.client.completeFileOutput('invocation', output as PluginFileOutput)).rejects.toBeDefined();
    for (const base64 of ['YQ', 'YQ=\n', 'YR==', '/w==', '', '====', 'YQ==extra']) {
      expect(await rpc(f.broker, 'tool.output.complete', { invocationId: 'invocation', mediaType: 'text/csv', base64 })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    }
    expect(f.execution.complete).not.toHaveBeenCalled(); await f.client.completeFileOutput('invocation', result);
    expect(f.execution.complete).toHaveBeenCalledOnce();
  });

  it('keeps old read completion semantics separate from file output completion', async () => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    await expect(f.client.completeTool('invocation', result)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    const old = fixture(parsePluginManifest(readManifest, 'darwin')); await old.client.ready(); await old.client.toolInvocation();
    await expect(old.client.completeFileOutput('invocation', result)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rpc(old.broker, 'tool.output.complete', { invocationId: 'invocation', mediaType: 'text/csv', base64: 'YQ==' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
    expect(await rpc(old.broker, 'tool.output.complete', { invocationId: 'invocation', mediaType: 'text/csv', base64: 'A'.repeat(40000) })).toMatchObject({ ok: false, error: { code: 'LIMIT' } });
    expect(f.execution.complete).not.toHaveBeenCalled(); expect(old.execution.complete).not.toHaveBeenCalled();
  });

  it.each(['grant', 'revision'])('settles failed %s verification without releasing output content', async changed => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    if (changed === 'grant') f.resource.authorize.mockResolvedValue(false); else f.resource.currentRevision.mockResolvedValue('r2');
    const code = changed === 'grant' ? 'FORBIDDEN' : 'CONTENT_CHANGED';
    await expect(f.client.completeFileOutput('invocation', result)).rejects.toMatchObject({ code });
    expect(f.execution.complete).not.toHaveBeenCalled(); expect(f.execution.reject).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });
});

describe('main-only file output runtime', () => {
  it('strips destination and source IDs, requires the dedicated entry, and keeps the text private to main', async () => {
    const f = fixture(); const listeners = new Set<(id?: string) => void>(); const upstream = new AbortController();
    const spec = { plugin: { id: manifest.id, version: manifest.version, fingerprint }, directory: '/synthetic/export', tool, registrationId: 'registration' };
    const manager = { resolveTool: () => spec, stillToolAllowed: () => true, attachRuntime: (listener: (id?: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, started: vi.fn(), stopped: vi.fn(), requestFailed: vi.fn() };
    const calls: unknown[] = [];
    const load: PluginDevelopmentHost['load'] = async (_directory, resource, _theme, _granted, options = {}) => {
      calls.push(options.toolExecution?.input);
      expect(resource).toMatchObject({ nodeId: 17, name: 'source.csv' });
      const broker = new PluginResourceBroker(manifest, resource, theme, new PluginSettingsMemory(), undefined, undefined, options.toolExecution); broker.setReadGrant(true);
      const client = createPluginClient({ subscribe: () => () => undefined, exchange: raw => broker.exchange(raw) });
      void (async () => { await client.ready(); const call = await client.toolInvocation(); await client.completeFileOutput(call.invocationId, result); })();
      return { stop: (reason: string) => { client.dispose(); broker.dispose(); options.onStop?.(reason); } } as IsolatedPluginInstance;
    };
    const runtime = new PluginToolRuntime(manager as unknown as PluginManager, { load, onDispose: () => () => undefined } as unknown as PluginDevelopmentHost); cleanups.push(() => runtime.dispose());
    const capability = () => createPluginToolCallAuthority(binding, f.resource as OpenedResourceAuthority, upstream.signal, async () => undefined);
    await expect(runtime.execute(tool.id, fingerprint, input, capability())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const cap = capability();
    await expect(runtime.executeFileOutput(tool.id, fingerprint, input, cap)).resolves.toEqual({ output: result, source: {
      pluginId: manifest.id, version: manifest.version, fingerprint, toolId: tool.id, registrationId: 'registration', nodeId: 17, resourceRevision: 'r1',
    } });
    expect(calls).toEqual([{ format: 'csv', column: 0, equals: 'yes' }]);
    expect(runtime.size).toBe(0); await expect(runtime.executeFileOutput(tool.id, fingerprint, input, cap)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

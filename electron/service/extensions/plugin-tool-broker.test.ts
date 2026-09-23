import { describe, expect, it, vi } from 'vitest';
import { PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority, type PluginResourceAuthority } from './resource-broker';
import { parsePluginManifest } from './manifest';
import { createPluginClient } from '../../../packages/plugin-sdk/index.js';
import manifestJSON from '../../../samples/csv-tool/manifest.json';
import renameJSON from '../../../samples/batch-rename/manifest.json';
import outputJSON from '../../../samples/csv-export/manifest.json';

function fixture() {
  let allowed = true, revision = 'r1';
  const manifest = parsePluginManifest(manifestJSON, 'darwin');
  const resource: OpenedResourceAuthority = { accountScope: 'a', libraryId: 3, nodeId: 10, name: 'fixture.csv', size: 3, revision: 'r1',
    authorize: async () => allowed, currentRevision: async () => revision, readRange: async () => Buffer.from('a,b') };
  const execution = { contribution: manifest.agentTools![0], invocationId: 'call-a', input: { limit: 1 }, complete: vi.fn(), fail: vi.fn(), reject: vi.fn() };
  const broker = new PluginResourceBroker(manifest, resource, { schemaVersion: 1, revision: 1, mode: 'light', colors: {} }, new PluginSettingsMemory(), undefined, undefined, execution);
  broker.setReadGrant(true);
  const client = createPluginClient({ exchange: raw => broker.exchange(raw), subscribe: () => () => undefined });
  return { broker, client, execution, revoke: () => { allowed = false; }, change: () => { revision = 'r2'; } };
}
const output = { headers: ['name'], totalRows: 1, matchedRows: 1, rows: [['测试']], truncated: false };
describe('Tool broker protocol', () => {
  it.each([manifestJSON, renameJSON, outputJSON])('runs manual-only $id through the same resource broker without AI permission', async sample => {
    const toolId = sample.agentTools[0].id;
    const manifest = parsePluginManifest({ ...sample, permissions: sample.permissions.filter(permission => permission !== 'agent.tools'),
      commands: [{ id: `${sample.id}.run`, title: '手动处理', toolId, locations: ['file-menu'] }] }, 'darwin');
    const contribution = manifest.agentTools![0];
    const resource: PluginResourceAuthority = contribution.kind === 'rename-proposal'
      ? { kind: 'metadata', accountScope: 'a', libraryId: 3, revision: 'r1', files: [{ id: 'file-a', name: 'a.csv' }], authorize: async () => true, currentRevision: async () => 'r1' }
      : { accountScope: 'a', libraryId: 3, nodeId: 10, name: 'a.csv', size: 3, revision: 'r1', authorize: async () => true, currentRevision: async () => 'r1', readRange: async () => Buffer.from('a,b') };
    const execution = { contribution, invocationId: 'manual-a', input: {}, complete: vi.fn(), fail: vi.fn(), reject: vi.fn() };
    const theme = { schemaVersion: 1 as const, revision: 1, mode: 'light' as const, colors: {} };
    const create = (value = manifest) => new PluginResourceBroker(value, resource, theme, new PluginSettingsMemory(), undefined, undefined, execution);
    expect(() => create({ ...manifest, commands: [] })).toThrow(/scope/);
    expect(() => create({ ...manifest, permissions: [] })).toThrow(/scope/);
    const broker = create(); broker.setReadGrant(true);
    const client = createPluginClient({ exchange: raw => broker.exchange(raw), subscribe: () => () => undefined });
    await client.ready();
    expect(await client.toolInvocation()).toEqual({ invocationId: 'manual-a', toolId, input: {} });
    expect((await client.context()).capabilities).not.toContain('agent.tools');
    if (contribution.kind === 'rename-proposal') await expect(client.read(broker.handle, 0, 3)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    else expect((await client.read(broker.handle, 0, 3)).bytes).toEqual(new Uint8Array(Buffer.from('a,b')));
    client.dispose(); broker.dispose();
  });
  it('exposes only Tool invocation data and refuses Viewer state/settings and directory APIs', async () => {
    const f = fixture(); await f.client.ready();
    const context = await f.client.context();
    expect(context).toMatchObject({ kind: 'tool', toolId: 'example.csv-tools.query' });
    expect(context).not.toHaveProperty('viewerId');
    expect(await f.client.toolInvocation()).toEqual({ invocationId: 'call-a', toolId: 'example.csv-tools.query', input: { limit: 1 } });
    await expect(f.client.getState()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(f.client.setSetting('test', true, 0)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(f.client.listDirectory(f.broker.handle)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    f.client.dispose(); f.broker.dispose();
  });
  it('binds invocation identity, validates output and accepts exactly one terminal result', async () => {
    const f = fixture(); await f.client.ready();
    await expect(f.client.completeTool('call-a', output)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.client.toolInvocation();
    await expect(f.client.completeTool('other-call', output)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.client.completeTool('call-a', { html: '<script>' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await f.client.completeTool('call-a', output);
    expect(f.execution.complete).toHaveBeenCalledTimes(1);
    expect(f.execution.complete).toHaveBeenCalledWith(output);
    await expect(f.client.completeTool('call-a', output)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(f.client.read(f.broker.handle, 0, 3)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    f.client.dispose(); f.broker.dispose();
  });
  it.each(['permission', 'revision'])('settles main immediately if terminal %s validation fails', async kind => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    if (kind === 'permission') f.revoke(); else f.change();
    const code = kind === 'permission' ? 'FORBIDDEN' : 'CONTENT_CHANGED';
    await expect(f.client.completeTool('call-a', output)).rejects.toMatchObject({ code });
    expect(f.execution.complete).not.toHaveBeenCalled();
    expect(f.execution.reject).toHaveBeenCalledWith(expect.objectContaining({ code }));
    f.client.dispose(); f.broker.dispose();
  });
  it('supports bounded results larger than the ordinary request envelope', async () => {
    const f = fixture(); await f.client.ready(); await f.client.toolInvocation();
    const value = { ...output, rows: Array.from({ length: 6 }, () => ['x'.repeat(3500)]) };
    expect(JSON.stringify(value).length).toBeGreaterThan(16384);
    await f.client.completeTool('call-a', value);
    expect(f.execution.complete).toHaveBeenCalledWith(value);
    f.client.dispose(); f.broker.dispose();
  });
});

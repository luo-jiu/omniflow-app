import { describe, expect, it, vi } from 'vitest';
import { createPluginClient, type PluginWorkspaceContribution } from '../../../packages/plugin-sdk/index.js';
import outputJSON from '../../../samples/csv-export/manifest.json';
import { parsePluginManifest } from './manifest';
import { PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority } from './resource-broker';

const workspace: PluginWorkspaceContribution = { id: `${outputJSON.id}.workspace`, title: 'Export', commandId: outputJSON.commands[0].id, entry: 'workspace.html' };
const manifest = parsePluginManifest({ ...outputJSON, permissions: ['resource.read', 'resource.output.propose'], workspaces: [workspace], activation: [...outputJSON.activation, `workspace:${workspace.id}`] }, 'darwin');
const theme = { schemaVersion: 1 as const, revision: 1, mode: 'light' as const, colors: {} };
function fixture() {
  let allowed = true, revision = 'v1';
  const resource: OpenedResourceAuthority = { accountScope: 'a', libraryId: 3, nodeId: 10, name: 'a.csv', size: 3, revision: 'v1',
    authorize: async () => allowed, currentRevision: async () => revision, readRange: async () => Buffer.from('a,b') };
  const prepare = vi.fn<(parameters: Record<string, unknown>, signal: AbortSignal) => { requestId: string }>(() => ({ requestId: 'prepare-1' }));
  const execution = { contribution: workspace, prepare };
  const broker = new PluginResourceBroker(manifest, resource, theme, new PluginSettingsMemory(), undefined, undefined, undefined, execution);
  broker.setReadGrant(true);
  const client = createPluginClient({ exchange: raw => broker.exchange(raw), subscribe: () => () => undefined });
  return { resource, execution, broker, client, revoke: () => { allowed = false; }, change: () => { revision = 'v2'; } };
}
const raw = (method: string, params: unknown) => JSON.stringify({ version: 1, id: crypto.randomUUID(), method, params });

describe('workspace broker capability boundary', () => {
  it('has its own context, reads the bound file and only requests host preparation', async () => {
    const f = fixture();
    await expect(f.client.prepareWorkspaceCommand({ fields: ['a'] })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await f.client.ready();
    const context = await f.client.context();
    expect(context).toMatchObject({ kind: 'workspace', workspaceId: workspace.id, commandId: workspace.commandId,
      capabilities: ['resource.read', 'theme', 'lifecycle', 'workspace.prepare'], readGranted: true,
      resource: { kind: 'file', handle: f.broker.handle, name: 'a.csv', revision: 'v1' } });
    expect(context).not.toHaveProperty('viewerId'); expect(context).not.toHaveProperty('toolId'); expect(context).not.toHaveProperty('output');
    expect((await f.client.read(f.broker.handle, 0, 3)).bytes).toEqual(new Uint8Array(Buffer.from('a,b')));
    expect(await f.client.prepareWorkspaceCommand({ fields: ['a'], pretty: true })).toEqual({ requestId: 'prepare-1' });
    expect(f.execution.prepare).toHaveBeenCalledOnce();
    expect(f.execution.prepare).toHaveBeenCalledWith({ fields: ['a'], pretty: true }, expect.any(AbortSignal));
    f.client.dispose(); f.broker.dispose();
  });
  it.each(['permission', 'grant', 'revision', 'disposed'])('refuses preparation after %s changes without calling the host', async change => {
    const f = fixture(); await f.client.ready();
    if (change === 'permission') f.revoke(); else if (change === 'grant') f.broker.setReadGrant(false); else if (change === 'revision') f.change(); else f.broker.dispose();
    const code = change === 'revision' ? 'CONTENT_CHANGED' : change === 'disposed' ? 'UNAVAILABLE' : 'FORBIDDEN';
    if (change === 'disposed') expect(JSON.parse(await f.broker.exchange(raw('workspace.prepare', { parameters: {} })))).toMatchObject({ ok: false, error: { code } });
    else await expect(f.client.prepareWorkspaceCommand({})).rejects.toMatchObject({ code });
    expect(f.execution.prepare).not.toHaveBeenCalled(); f.client.dispose(); f.broker.dispose();
  });
  it('denies state, settings, directory and Tool terminal APIs without fabricating their identities', async () => {
    const f = fixture(); await f.client.ready();
    for (const method of ['state.get', 'state.set', 'settings.get', 'settings.set', 'directory.list', 'directory.open', 'resource.release', 'tool.invocation', 'tool.complete', 'tool.output.complete', 'tool.fail']) {
      expect(JSON.parse(await f.broker.exchange(raw(method, {})))).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
    }
    expect(f.execution.prepare).not.toHaveBeenCalled(); f.client.dispose(); f.broker.dispose();
  });
  it('refuses host identities, output destinations, additional envelope fields and unsafe parameter JSON', async () => {
    const f = fixture(); await f.client.ready();
    const inputs = [null, [], { resource: { nodeId: 2 } }, { resources: [2] }, { destination: { parentId: 3, fileName: 'bad.json' } }, JSON.parse('{"nested":{"__proto__":{"approved":true}}}')];
    for (const parameters of inputs) {
      expect(JSON.parse(await f.broker.exchange(raw('workspace.prepare', { parameters })))).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    }
    expect(JSON.parse(await f.broker.exchange(raw('workspace.prepare', { parameters: {}, approved: true })))).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    let deep: unknown = true; for (let i = 0; i < 24; i++) deep = { value: deep };
    expect(JSON.parse(await f.broker.exchange(raw('workspace.prepare', { parameters: { deep } })))).toMatchObject({ ok: false, error: { code: 'LIMIT' } });
    expect(f.execution.prepare).not.toHaveBeenCalled(); f.client.dispose(); f.broker.dispose();
  });
  it('does not dispatch preparation when permission is revoked during the asynchronous revision check', async () => {
    const f = fixture(); await f.client.ready();
    f.resource.currentRevision = async () => { f.broker.setReadGrant(false); return 'v1'; };
    await expect(f.client.prepareWorkspaceCommand({})).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.execution.prepare).not.toHaveBeenCalled(); f.client.dispose(); f.broker.dispose();
  });
  it('binds the declaration and refuses mixed Tool/workspace and directory scopes at construction', () => {
    const f = fixture();
    const create = (value = manifest, resource = f.resource, execution = f.execution) => new PluginResourceBroker(value, resource, theme, new PluginSettingsMemory(), undefined, undefined, undefined, execution);
    expect(() => create({ ...manifest, workspaces: [] })).toThrow(/workspace/);
    expect(() => create({ ...manifest, commands: [] })).toThrow(/workspace/);
    expect(() => create({ ...manifest, permissions: ['resource.read'] })).toThrow(/workspace/);
    expect(() => create(manifest, f.resource, { ...f.execution, contribution: { ...workspace, entry: 'foreign.html' } })).toThrow(/workspace/);
    expect(() => create(manifest, { ...f.resource, directory: { type: 'COMIC', entries: [], open: async () => f.resource } })).toThrow(/workspace/);
    expect(() => new PluginResourceBroker(manifest, f.resource, theme, new PluginSettingsMemory(), undefined, undefined,
      { contribution: manifest.agentTools![0], invocationId: 'tool', input: {}, complete: vi.fn(), reject: vi.fn(), fail: vi.fn() }, f.execution)).toThrow(/workspace/);
    f.client.dispose(); f.broker.dispose();
  });
});

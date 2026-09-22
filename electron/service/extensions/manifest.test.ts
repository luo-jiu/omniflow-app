import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPackagePath, loadPluginPackage, parsePluginManifest } from './manifest';
import csvManifest from '../../../samples/csv-viewer/manifest.json';
import { createPluginClient, type PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
// Keep the original v1 compatibility fixture even as the sample evolves to a mixed package.
const manifest = { formatVersion: 1, id: csvManifest.id, version: '0.1.0', sdkVersion: 1, minHostVersion: '0.2.2', platforms: ['darwin'], entry: 'index.html', activation: ['viewer:example.csv.table'], permissions: ['resource.read'], viewers: [{ id: 'example.csv.table', title: 'CSV 开发样板', extensions: ['csv'] }] };
const tool: PluginToolContribution = {
  id: 'example.csv.query', title: 'CSV query', description: 'Read one CSV file', entry: 'tools/query.html',
  inputSchema: { type: 'object', additionalProperties: false, required: ['resource'], properties: { resource: { type: 'object', additionalProperties: false, required: ['nodeId'], properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } } } },
  outputSchema: { type: 'object', additionalProperties: false, required: ['rowCount'], properties: { rowCount: { type: 'integer', minimum: 0, maximum: 1000000 } } },
  resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }], timeoutMs: 30000, maxResultBytes: 32768,
};
const toolManifest = { ...manifest, formatVersion: 2, entry: undefined, viewers: undefined, permissions: ['resource.read', 'agent.tools'], activation: ['tool:example.csv.query'], agentTools: [tool] };
const roots: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'plugin-manifest-test-')); roots.push(root); await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest)); await writeFile(path.join(root, 'index.html'), '<p>test</p>'); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('plugin manifest and package', () => {
  it.each(['../secret', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a?b', 'a#b', 'a%20b', 'NUL.js', 'dir/con', 'trailing.'])('rejects unsafe package path %s', value => { expect(isPackagePath(value)).toBe(false); });
  it('validates host/platform/schema/version/activation/permissions', () => {
    expect(parsePluginManifest(manifest, 'darwin').id).toBe('example.csv');
    for (const patch of [{ sdkVersion: 2 }, { formatVersion: 3 }, { minHostVersion: '100.0.0' }, { entry: '../outside.html' }, { permissions: ['shell'] }, { activation: ['viewer:other'] }, { viewers: [...manifest.viewers, ...manifest.viewers] }, { token: 'extra-field' }]) expect(() => parsePluginManifest({ ...manifest, ...patch }, 'darwin')).toThrow();
    expect(() => parsePluginManifest(manifest, 'unsupported')).toThrow();
  });
  it('preserves v1 and supports tool-only v2 without a fake viewer or top-level entry', () => {
    expect(parsePluginManifest(manifest, 'darwin')).toEqual(manifest);
    expect(parsePluginManifest(toolManifest, 'darwin')).toMatchObject({ formatVersion: 2, viewers: [], agentTools: [tool] });
    const mixed = { ...manifest, formatVersion: 2, agentTools: [tool], permissions: ['resource.read', 'agent.tools'], activation: [...manifest.activation, 'tool:example.csv.query'] };
    expect(parsePluginManifest(mixed, 'darwin')).toMatchObject({ viewers: manifest.viewers, agentTools: [tool] });
    expect(() => parsePluginManifest({ ...mixed, entry: undefined }, 'darwin')).toThrow();
    expect(() => parsePluginManifest({ ...mixed, formatVersion: 1 }, 'darwin')).toThrow();
  });
  it('rejects unsafe, incomplete or falsely activated Tool contributions', () => {
    for (const patch of [{ permissions: ['resource.read'] }, { permissions: ['agent.tools'] }, { permissions: ['resource.read', 'directory.read', 'agent.tools'] }, { activation: ['viewer:example.csv.query'] }, { activation: ['tool:example.csv.query', 'tool:missing'] }, { agentTools: [] }, { agentTools: [tool, tool] }]) expect(() => parsePluginManifest({ ...toolManifest, ...patch }, 'darwin')).toThrow();
    for (const patch of [{ id: 'other.query' }, { entry: '../query.html' }, { entry: 'query.js' }, { timeoutMs: 30001 }, { maxResultBytes: 32769 }, { resourceAccess: [{ parameter: 'resource', mode: 'write', kind: 'file' }] }, { inputSchema: { ...tool.inputSchema, $ref: 'https://invalid.test/schema' } }]) expect(() => parsePluginManifest({ ...toolManifest, agentTools: [{ ...tool, ...patch }] }, 'darwin')).toThrow();
  });
  it('loads and fingerprints the real Tool entry, rejecting a missing Tool asset', async () => {
    const root = await fixture(); await writeFile(path.join(root, 'manifest.json'), JSON.stringify(toolManifest));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/entry not found/);
    await mkdir(path.join(root, 'tools')); await writeFile(path.join(root, 'tools/query.html'), '<p>tool</p>');
    expect((await loadPluginPackage(root, 'darwin')).manifest.viewers).toEqual([]);
  });
  it('exchanges the Tool SDK methods and allows only result envelopes above 16 KiB', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = createPluginClient({
      subscribe: () => () => undefined,
      exchange: async raw => { const wire = JSON.parse(raw); requests.push(wire); return JSON.stringify({ version: 1, id: wire.id, ok: true, value: wire.method === 'tool.invocation' ? { invocationId: 'call-1', toolId: tool.id, input: {} } : null }); },
    });
    expect(await client.toolInvocation()).toMatchObject({ invocationId: 'call-1', toolId: tool.id });
    await client.completeTool('call-1', { text: 'x'.repeat(20000) });
    await client.failTool('call-1', 'INVALID_INPUT');
    await expect(client.setState('x'.repeat(20000), 0)).rejects.toMatchObject({ code: 'LIMIT' });
    expect(requests.map(request => request.method)).toEqual(['tool.invocation', 'tool.complete', 'tool.fail']);
    expect(requests[2].params).toEqual({ invocationId: 'call-1', code: 'INVALID_INPUT' });
    client.dispose();
  });
  it('includes file boundaries and lengths in the package fingerprint', async () => {
    const first = await fixture(); const second = await fixture();
    await writeFile(path.join(first,'a.png'),Buffer.from('Xb.png\0Y'));
    await writeFile(path.join(second,'a.png'),'X'); await writeFile(path.join(second,'b.png'),'Y');
    expect((await loadPluginPackage(first,'darwin')).fingerprint).not.toBe((await loadPluginPackage(second,'darwin')).fingerprint);
  });
  it('snapshots package bytes independently of subsequent edits', async () => {
    const root = await fixture(); const loaded = await loadPluginPackage(root, 'darwin');
    await writeFile(path.join(root, 'index.html'), '<p>changed</p>');
    expect(loaded.assets.get('index.html')?.bytes.toString()).toBe('<p>test</p>');
    expect((await loadPluginPackage(root, 'darwin')).fingerprint).not.toBe(loaded.fingerprint);
  });
  it('rejects symlinks and unsupported/oversized assets', async () => {
    const root = await fixture(); await symlink(path.join(root, 'index.html'), path.join(root, 'link.html'));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/symlink/);
    await rm(path.join(root, 'link.html')); await writeFile(path.join(root, 'native.node'), 'no');
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/Unsupported/);
    await rm(path.join(root, 'native.node')); await writeFile(path.join(root, 'huge.js'), Buffer.alloc(1048577));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/oversized/);
  });
  it('rejects empty directory floods and unsafe SVG', async () => {
    const root = await fixture(); await writeFile(path.join(root, 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/Unsafe SVG/);
    await rm(path.join(root, 'unsafe.svg'));
    await Promise.all(Array.from({ length: 129 }, (_, i) => mkdir(path.join(root, `empty${i}`))));
    await expect(loadPluginPackage(root, 'darwin')).rejects.toThrow(/entry limit/);
  });
});

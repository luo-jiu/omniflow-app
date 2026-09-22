import { describe, expect, it, vi } from 'vitest';
import { createPluginClient, LIMITS, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
import { PluginResourceBroker, PluginSettingsMemory, type OpenedResourceAuthority } from './resource-broker';
import { parsePluginManifest } from './manifest';
import manifestJson from '../../../samples/comic-viewer/manifest.json';
import { openLibraryDirectory } from './library-directory';
const manifest = parsePluginManifest(manifestJson, 'darwin');
const theme: ThemeSnapshot = { schemaVersion: 1, revision: 1, mode: 'light', colors: {} };
function setup(options: { open?: (id: string, signal: AbortSignal) => Promise<OpenedResourceAuthority>; permission?: boolean } = {}) {
  let allowed = true;
  const child: OpenedResourceAuthority = { accountScope: 'account', libraryId: 3, nodeId: 11, name: 'a.png', size: 3, revision: 'v1', authorize: async () => allowed, currentRevision: async () => 'v1', readRange: async () => Buffer.from('abc') };
  const resource: OpenedResourceAuthority = { ...child, nodeId: 10, size: 0, name: 'comic', directory: { type: 'COMIC', entries: Array.from({ length: 65 }, (_, i) => ({ id: String(i), name: `${i}.png`, size: 3, mimeType: 'image/png' })), open: options.open ?? (async () => child) } };
  const broker = new PluginResourceBroker({ ...manifest, permissions: options.permission === false ? ['resource.read'] : manifest.permissions }, resource, theme, new PluginSettingsMemory());
  broker.setReadGrant(true);
  const client = createPluginClient({ exchange: raw => broker.exchange(raw), subscribe: () => () => undefined });
  return { broker, client, child, deny: () => { allowed = false; } };
}
describe('directory SDK and broker', () => {
  it('lists a bounded snapshot, opens only listed entries and releases child handles', async () => {
    const { client, broker } = setup(); await client.ready();
    expect((await client.context()).resource?.kind).toBe('directory');
    expect((await client.listDirectory(broker.handle)).entries).toHaveLength(64);
    expect(await client.listDirectory(broker.handle, 64)).toMatchObject({ nextOffset: 65, eof: true });
    await expect(client.openDirectoryEntry(broker.handle, 'foreign-node')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.read(broker.handle, 0, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const child = await client.openDirectoryEntry(broker.handle, '0');
    expect((await client.read(child.handle, 0, 3)).bytes).toEqual(new Uint8Array([97, 98, 99]));
    await client.releaseResource(child.handle);
    await expect(client.read(child.handle, 0, 3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    client.dispose(); broker.dispose();
  });
  it('enforces directory permission, instance scope and current user access', async () => {
    const a = setup(), b = setup(), denied = setup({ permission: false });
    await Promise.all([a.client.ready(), b.client.ready(), denied.client.ready()]);
    await expect(denied.client.listDirectory(denied.broker.handle)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const child = await a.client.openDirectoryEntry(a.broker.handle, '0');
    await expect(b.client.read(child.handle, 0, 3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    a.deny(); await expect(a.client.read(child.handle, 0, 3)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const item of [a, b, denied]) { item.client.dispose(); item.broker.dispose(); }
  });
  it('reserves concurrent opening slots and rejects late handles after revoke', async () => {
    let finish!: (child: OpenedResourceAuthority) => void;
    const f = setup({ open: () => new Promise(resolve => { finish = resolve; }) }); await f.client.ready();
    const pending = Array.from({ length: LIMITS.directoryHandles }, () => f.client.openDirectoryEntry(f.broker.handle, '0').catch(error => error));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(f.client.openDirectoryEntry(f.broker.handle, '1')).rejects.toMatchObject({ code: 'LIMIT' });
    f.broker.setReadGrant(false);
    expect((await Promise.all(pending)).every(error => error.code === 'CANCELLED')).toBe(true);
    finish(f.child); await Promise.resolve(); f.client.dispose(); f.broker.dispose();
  });
  it('requires both declarations and rejects mixed file/directory matching', () => {
    expect(() => parsePluginManifest({ ...manifestJson, permissions: ['resource.read'] }, 'darwin')).toThrow();
    expect(() => parsePluginManifest({ ...manifestJson, viewers: [{ ...manifestJson.viewers[0], extensions: ['png'] }] }, 'darwin')).toThrow();
  });
});
function server(extension = 'png') {
  let parentId = 10, allowed = true, wrongChildLibrary = false, archiveMode = 0;
  const root = { id: 10, libraryId: 3, type: 'dir', name: 'Comic', builtInType: 'COMIC' };
  const child = () => ({ id: 11, libraryId: wrongChildLibrary ? 4 : 3, parentId, type: 'file', name: 'page', ext: extension, fileSize: 3, storageKey: 'page.png', storageBucket: 'bucket', storageProvider: 'local', updatedAt: '2026-09-22' });
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const data = (value: unknown) => new Response(JSON.stringify({ code: '0', data: value }));
    if (!allowed) return new Response(null, { status: 403 });
    if (url.pathname.endsWith('/user/me')) return data({ id: 42 });
    if (url.pathname.endsWith('/children')) return data([child(), { id: 12, libraryId: 3, parentId: 10, type: 'file', name: 'secret', ext: 'txt' }]);
    if (url.pathname.endsWith('/nodes/10')) return data({ ...root, archiveMode });
    if (url.pathname.endsWith('/nodes/11')) return data(child());
    if (url.pathname.endsWith('/directory/link')) return data('https://storage.test/bucket/page.png?signature=synthetic');
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('Range') ?? '')!;
    return new Response(Buffer.from('abc').subarray(Number(range[1]), Number(range[2]) + 1), { status: 206, headers: { ETag: '"v1"', 'Content-Range': `bytes ${range[1]}-${range[2]}/3` } });
  }) as unknown as typeof fetch;
  return { options: { apiBaseUrl: 'https://api.test/api', storageOrigins: ['https://storage.test'], token: 'synthetic', username: 'fixture', libraryId: 3, nodeId: 10, signal: new AbortController().signal, fetch: fetcher }, move: () => { parentId = 20; }, deny: () => { allowed = false; }, wrongLibrary: () => { wrongChildLibrary = true; }, archive: () => { archiveMode = 1; } };
}
describe('server-authorized directory scope', () => {
  it.each(['constructor', '__proto__'])('does not authorize an inherited object key as an image extension: %s', async extension => {
    const f = server(extension);
    const root = await openLibraryDirectory(f.options);
    expect(root.directory!.entries).toEqual([]);
  });
  it('preserves order and exposes only safe image metadata; moved children fail before and after opening', async () => {
    const f = server(); const root = await openLibraryDirectory(f.options);
    expect(root.directory!.entries).toHaveLength(1);
    expect(root.directory!.entries[0]).toEqual({ id: expect.any(String), name: 'page.png', size: 3, mimeType: 'image/png' });
    const entry = root.directory!.entries[0]; const child = await root.directory!.open(entry.id, f.options.signal);
    expect(child.accountScope).toBe(root.accountScope);
    f.move();
    await expect(child.authorize(f.options.signal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(root.directory!.open(entry.id, f.options.signal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects cross-library responses, archive roots and revoked access', async () => {
    const f = server(); f.wrongLibrary(); await expect(openLibraryDirectory(f.options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const g = server(); g.archive(); await expect(openLibraryDirectory(g.options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const h = server(); const root = await openLibraryDirectory(h.options); h.deny(); await expect(root.authorize(h.options.signal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

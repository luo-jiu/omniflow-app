import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginResourceBroker, PluginSettingsMemory, PluginReadingStateMemory, type OpenedResourceAuthority } from './resource-broker';
import { parsePluginManifest } from './manifest';
import manifestJson from '../../../samples/csv-viewer/manifest.json';
import { LIMITS, createPluginClient, type ThemeSnapshot } from '../../../packages/plugin-sdk/index.js';
const manifest = parsePluginManifest(manifestJson, 'darwin');
const theme: ThemeSnapshot = { schemaVersion: 1, revision: 1, mode: 'light', colors: { 'surface.app': '#ffffff' } };
function resource(overrides: Partial<OpenedResourceAuthority> = {}): OpenedResourceAuthority {
  return { accountScope: 'test', libraryId: 3, nodeId: 10, name: 'test.csv', size: 3, revision: 'v1', authorize: async () => true, currentRevision: async () => 'v1', readRange: async (offset, length) => Buffer.from('abc').subarray(offset, offset + length), ...overrides };
}
let sequence = 0;
const call = async (broker: PluginResourceBroker, method: string, params = {}, id = `r${++sequence}`) => JSON.parse(await broker.exchange(JSON.stringify({ version: 1, id, method, params })));
const range = (broker: PluginResourceBroker) => ({ handle: broker.handle, offset: 0, length: 3 });
async function setup(overrides: Partial<OpenedResourceAuthority> = {}) { const broker = new PluginResourceBroker(manifest, resource(overrides), theme, new PluginSettingsMemory()); await call(broker, 'lifecycle.ready'); broker.setReadGrant(true); return broker; }
afterEach(() => vi.useRealTimers());
describe('plugin resource authority', () => {
  it('requires readiness, explicit grant, manifest permission and real host authorization', async () => {
    const broker = new PluginResourceBroker(manifest, resource(), theme, new PluginSettingsMemory());
    expect((await call(broker, 'resource.read', range(broker))).error.code).toBe('UNAVAILABLE');
    await call(broker, 'lifecycle.ready');
    expect((await call(broker, 'resource.read', range(broker))).error.code).toBe('FORBIDDEN');
    broker.setReadGrant(true);
    expect((await call(broker, 'resource.read', range(broker))).value.base64).toBe('YWJj');
    const denied = await setup({ authorize: async () => false });
    expect((await call(denied, 'resource.read', range(denied))).error.code).toBe('FORBIDDEN');
    const noPermission = new PluginResourceBroker({ ...manifest, permissions: [] }, resource(), theme, new PluginSettingsMemory());
    await call(noPermission, 'lifecycle.ready'); noPermission.setReadGrant(true);
    expect((await call(noPermission, 'resource.read', range(noPermission))).error.code).toBe('FORBIDDEN');
  });
  it('rejects foreign handles, forged scopes, invalid ranges and duplicate request ids', async () => {
    const a = await setup(); const b = await setup();
    expect((await call(a, 'resource.read', range(b))).error.code).toBe('FORBIDDEN');
    expect((await call(a, 'resource.read', { ...range(a), libraryId: 1 })).error.code).toBe('BAD_REQUEST');
    for (const offset of [-1, 4, 0.5]) expect((await call(a, 'resource.read', { ...range(a), offset })).error.code).toBe('BAD_REQUEST');
    await call(a, 'context.get', {}, 'repeat');
    expect((await call(a, 'context.get', {}, 'repeat')).error.code).toBe('BAD_REQUEST');
  });
  it('checks revision and permissions again after reading', async () => {
    let revision = 'v1';
    const broker = await setup({ currentRevision: async () => revision, readRange: async () => { revision = 'v2'; return Buffer.from('abc'); } });
    expect((await call(broker, 'resource.read', range(broker))).error.code).toBe('CONTENT_CHANGED');
    let allowed = true;
    const revoked = await setup({ authorize: async () => allowed, readRange: async () => { allowed = false; return Buffer.from('abc'); } });
    expect((await call(revoked, 'resource.read', range(revoked))).error.code).toBe('FORBIDDEN');
  });
  it.each(['revoke', 'cancel', 'stop'])('interrupts in-flight reads on %s even when the adapter ignores abort', async action => {
    let resolve!: (value: Uint8Array) => void;
    const broker = await setup({ readRange: () => new Promise(done => { resolve = done; }) });
    const pending = call(broker, 'resource.read', range(broker), 'pending');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    if (action === 'revoke') broker.setReadGrant(false);
    if (action === 'cancel') await call(broker, 'request.cancel', { requestId: 'pending' });
    if (action === 'stop') broker.dispose();
    expect((await pending).error.code).toBe('CANCELLED');
    resolve(Buffer.from('abc'));
  });
  it('times out uncooperative adapters and bounds concurrent requests', async () => {
    vi.useFakeTimers();
    const broker = await setup({ authorize: () => new Promise(() => undefined) });
    const pending = Array.from({ length: 8 }, () => call(broker, 'resource.read', range(broker)));
    expect((await call(broker, 'resource.read', range(broker))).error.code).toBe('LIMIT');
    await vi.advanceTimersByTimeAsync(LIMITS.requestTimeoutMs);
    expect((await Promise.all(pending)).every(item => item.error.code === 'TIMEOUT')).toBe(true);
  });
  it('bounds wire size and lifetime read bytes', async () => {
    const broker = await setup({ size: LIMITS.readTotalBytes, readRange: async (_offset, length) => new Uint8Array(length) });
    expect(JSON.parse(await broker.exchange('x'.repeat(LIMITS.requestBytes + 1))).error.code).toBe('LIMIT');
    vi.useFakeTimers();
    for (let i = 0; i < LIMITS.readTotalBytes / LIMITS.readChunkBytes; i++) {
      if (i % 50 === 0) await vi.advanceTimersByTimeAsync(1001);
      expect((await call(broker, 'resource.read', { handle: broker.handle, offset: 0, length: LIMITS.readChunkBytes })).ok).toBe(true);
    }
    expect((await call(broker, 'resource.read', range(broker))).error.code).toBe('LIMIT');
  });
  it('redacts host exceptions and never exposes authority internals in context', async () => {
    const broker = await setup({ authorize: async () => { throw new Error('secret-token'); } });
    expect(JSON.stringify(await call(broker, 'resource.read', range(broker)))).not.toContain('secret-token');
    const context = (await call(broker, 'context.get')).value;
    expect(context.resource).toEqual({ handle: broker.handle, name: 'test.csv', size: 3, revision: 'v1' });
    expect(context.accountScope).toBeUndefined();
  });
});
describe('plugin settings and theme', () => {
  it('isolates plugin/account/library settings and uses CAS', async () => {
    const store = new PluginSettingsMemory();
    const make = (id: string, account: string, libraryId: number) => new PluginResourceBroker({ ...manifest, id }, resource({ accountScope: account, libraryId }), theme, store);
    const a = make('a', 'account', 3);
    const others = [make('b', 'account', 3), make('a', 'other', 3), make('a', 'account', 4)];
    await call(a, 'lifecycle.ready');
    const params = { key: 'display', value: { compact: true }, expectedRevision: 0, schemaVersion: 1 };
    expect((await call(a, 'settings.set', params)).value.revision).toBe(1);
    expect((await call(a, 'settings.set', params)).error.code).toBe('CONFLICT');
    for (const other of others) { await call(other, 'lifecycle.ready'); expect((await call(other, 'settings.get', { key: 'display' })).value).toBeNull(); }
  });
  it('enforces setting keys, detached values and quotas', () => {
    const store = new PluginSettingsMemory(); const value = { x: 1 };
    store.set('scope', 'first', value, 0, 1); value.x = 2;
    expect(store.get('scope', 'first')?.value).toEqual({ x: 1 });
    expect(() => store.set('scope', 'large', 'x'.repeat(LIMITS.settingBytes), 0, 1)).toThrow();
    for (let i = 1; i < LIMITS.settingsKeys; i++) store.set('scope', `key${i}`, null, 0, 1);
    expect(() => store.set('scope', 'extra', null, 0, 1)).toThrow();
  });
  it('validates snapshots and rejects stale themes', async () => {
    const broker = await setup();
    expect(broker.setTheme(theme)).toBe(false);
    expect(broker.setTheme({ ...theme, revision: 2 })).toBe(true);
    expect(() => broker.setTheme({ ...theme, revision: 3, colors: { x: 'url(https://invalid)' } })).toThrow();
  });
});
describe('independent SDK contract', () => {
  it('runs against the broker and releases its subscription once', async () => {
    const broker = await setup(); const unsubscribe = vi.fn();
    const client = createPluginClient({ exchange: raw => broker.exchange(raw), subscribe: () => unsubscribe });
    expect((await client.read(broker.handle, 0, 3)).bytes).toEqual(new Uint8Array([97, 98, 99]));
    client.dispose(); client.dispose(); expect(unsubscribe).toHaveBeenCalledTimes(1);
    await expect(client.context()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('rejects forged response ids and malformed read ranges', async () => {
    const transport = { subscribe: () => () => undefined, exchange: async (raw: string) => JSON.stringify({ version: 1, id: JSON.parse(raw).id + 'other', ok: true, value: {} }) };
    await expect(createPluginClient(transport).context()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    transport.exchange = async raw => JSON.stringify({ version: 1, id: JSON.parse(raw).id, ok: true, value: { base64: 'YQ==', nextOffset: 3, eof: true, revision: 'v1' } });
    await expect(createPluginClient(transport).read('handle', 0, 3)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
  it('client timeout has a distinct code and sends cancellation', async () => {
    vi.useFakeTimers(); const exchange = vi.fn((raw: string) => { expect(raw).toBeTypeOf('string'); return new Promise<string>(() => undefined); });
    const client = createPluginClient({ exchange, subscribe: () => () => undefined });
    const pending = expect(client.context()).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(LIMITS.clientTimeoutMs); await pending;
    expect(JSON.parse(exchange.mock.calls[1][0] as unknown as string).method).toBe('request.cancel'); client.dispose();
  });
});

describe('bounded reading state', () => {
  it('restores only the same plugin/account/library/node/viewer/content identity', async () => {
    const settings = new PluginSettingsMemory(); const states = new PluginReadingStateMemory();
    const make = (source = resource(), plugin = manifest) => new PluginResourceBroker(plugin, source, theme, settings, undefined, states);
    const first = make(); await call(first, 'lifecycle.ready');
    expect((await call(first, 'state.set', { value: { scrollTop: 42 }, expectedRevision: 0, schemaVersion: 1 })).ok).toBe(true);
    first.dispose(); const restored = make(); await call(restored, 'lifecycle.ready');
    expect((await call(restored, 'state.get')).value.value.scrollTop).toBe(42);
    expect((await call(restored, 'state.set', { value: {}, expectedRevision: 0, schemaVersion: 1 })).error.code).toBe('CONFLICT');
    for (const patch of [{ nodeId: 11 }, { libraryId: 4 }, { accountScope: 'other' }, { revision: 'v2' }]) {
      const other = make(resource(patch)); await call(other, 'lifecycle.ready'); expect((await call(other, 'state.get')).value).toBeNull();
    }
    const otherViewer = make(resource(), { ...manifest, viewers: [{ ...manifest.viewers[0], id: 'example.csv.other' }] });
    await call(otherViewer, 'lifecycle.ready'); expect((await call(otherViewer, 'state.get')).value).toBeNull();
  });
  it('bounds individual and total snapshots', () => {
    const states = new PluginReadingStateMemory();
    expect(() => states.set('a', 'x'.repeat(LIMITS.snapshotBytes), 0, 1)).toThrow();
    for (let i = 0; i < 7; i++) states.set(String(i), 'x'.repeat(32000), 0, 1);
    expect(() => { for (let i = 7; i < 10; i++) states.set(String(i), 'x'.repeat(32000), 0, 1); }).toThrow();
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import { createAgentLibraryTextReader, readAgentLibraryText } from './agent-library-text-reader';
import { sliceAgentText, decodeAgentText } from './agent-text-reader';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import type { AgentFileAuthorityResultV1 } from '@/shared/agent/agent.types';

const node = { version: 1 as const, id: 7, libraryId: 3, parentId: 4, type: 'file' as const, name: 'a.txt', fileSize: 5, storageKey: 'key', storageProvider: 'local' };
const input = { libraryId: 3, signal: new AbortController().signal, operation: { operation: 'stage-library-node', nodeId: 7, includeDownloadUrl: true } } as AgentFileAuthorityBrokerRequestInput;
function authority() {
  return vi.fn(async (request: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> => {
    request.signal.throwIfAborted();
    return { operation: 'stage-library-node', version: 1, node, downloadUrl: 'https://fixture.test/a' };
  });
}
describe('library text authority', () => {
  it('shares decoded lines only after byte revalidation and bounds them in the raw owner budget', async () => {
    const reader = createAgentLibraryTextReader();
    const request = { ...input, runId: 'decode-run' };
    const authorize = authority();
    const fetchText = vi.fn().mockResolvedValueOnce(new Response('hello', { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response('world', { headers: { etag: '"v2"' } }));
    const first = decodeAgentText(await reader.read(request, authorize, fetchText));
    const cached = decodeAgentText(await reader.read(request, authorize, fetchText));
    expect(cached).toBe(first);
    expect(Object.isFrozen(cached.lines)).toBe(true);
    expect(reader.decodeMetrics()).toEqual({ hits: 1, stores: 1 });
    expect(reader.retainedBytes()).toBeGreaterThan(5);
    const changed = decodeAgentText(await reader.read(request, authorize, fetchText));
    expect(changed.lines).toEqual(['world']);
    expect(changed.revision).not.toBe(first.revision);
    expect(authorize).toHaveBeenCalledTimes(6);
    reader.releaseRun('decode-run');
    expect(reader.retainedBytes()).toBe(0);
  });
  it('does not admit caller-mutated bytes and invalidates decoded state after revocation', async () => {
    const reader = createAgentLibraryTextReader();
    const request = { ...input, runId: 'mutable-run' };
    const fetchText = vi.fn().mockResolvedValueOnce(new Response('hello', { headers: { etag: '"v1"' } }))
      .mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    const bytes = await reader.read(request, authority(), fetchText);
    bytes[0] = 119;
    expect(decodeAgentText(bytes).lines).toEqual(['wello']);
    expect(reader.decodeMetrics().stores).toBe(0);
    const valid = decodeAgentText(await reader.read(request, authority(), fetchText));
    expect(valid.lines).toEqual(['hello']);
    const denied = authority();
    denied.mockResolvedValueOnce({ operation: 'stage-library-node', version: 1, node, downloadUrl: 'https://fixture.test/a' })
      .mockRejectedValueOnce(new Error('revoked after conditional GET'));
    await expect(reader.read(request, denied, fetchText)).rejects.toThrow('revoked');
    expect(reader.retainedBytes()).toBe(0);
    expect(decodeAgentText(bytes)).not.toBe(valid);
  });
  it('declines derived state when it would exceed the shared byte budget', async () => {
    const reader = createAgentLibraryTextReader({ maxBytes: 5 });
    const request = { ...input, runId: 'tiny-run' };
    decodeAgentText(await reader.read(request, authority(), async () => new Response('hello', { headers: { etag: '"v1"' } })));
    expect(reader.decodeMetrics()).toEqual({ hits: 0, stores: 0 });
    expect(reader.retainedBytes()).toBe(5);
    reader.releaseRun('tiny-run');
  });
  it('never caches decoded text without a strong ETag, across Runs, or beyond the raw TTL', async () => {
    vi.useFakeTimers();
    try {
      const reader = createAgentLibraryTextReader({ ttlMs: 100 });
      for (const etag of [undefined, 'W/"weak"']) {
        decodeAgentText(await reader.read({ ...input, runId: 'uncached' }, authority(), async () => new Response('hello', { headers: etag ? { etag } : {} })));
        expect(reader.retainedBytes()).toBe(0);
      }
      const fetchText = vi.fn(async () => new Response('hello', { headers: { etag: '"strong"' } }));
      const firstBytes = await reader.read({ ...input, runId: 'one' }, authority(), fetchText);
      const first = decodeAgentText(firstBytes);
      const second = decodeAgentText(await reader.read({ ...input, runId: 'two' }, authority(), fetchText));
      expect(second).not.toBe(first);
      expect(reader.decodeMetrics().hits).toBe(0);
      await vi.advanceTimersByTimeAsync(101);
      expect(reader.retainedBytes()).toBe(0);
      expect(decodeAgentText(firstBytes)).not.toBe(first);
    } finally { vi.useRealTimers(); }
  });
  it('downloads once across continuation reads while reauthorizing every page', async () => {
    const reader = createAgentLibraryTextReader();
    const request = { ...input, runId: 'cache-run', sessionId: 'session', ownerScope: { backendScope: 'backend', accountScope: 'account' } };
    const authorize = authority();
    const fetchText = vi.fn().mockResolvedValueOnce(new Response('hello', { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    const first = await reader.read(request, authorize, fetchText);
    first[0] = 0;
    expect(Buffer.from(await reader.read(request, authorize, fetchText)).toString()).toBe('hello');
    expect(fetchText.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"v1"' });
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(reader.retainedBytes()).toBe(5);
    reader.releaseRun('cache-run');
    expect(reader.retainedBytes()).toBe(0);
  });
  it.each(['ttl', 'quota'] as const)('finishes an authorized conditional read when %s evicts its cache entry', async eviction => {
    vi.useFakeTimers();
    try {
      const reader = createAgentLibraryTextReader({ maxBytes: 5, ttlMs: 100 });
      const request = { ...input, runId: 'in-flight-run' };
      const authorize = authority();
      let respond!: (response: Response) => void;
      const response = new Promise<Response>(resolve => { respond = resolve; });
      let started!: () => void;
      const conditionalStarted = new Promise<void>(resolve => { started = resolve; });
      const fetchText = vi.fn()
        .mockResolvedValueOnce(new Response('hello', { headers: { etag: '"v1"' } }))
        .mockImplementationOnce(() => { started(); return response; })
        .mockResolvedValueOnce(new Response('other', { headers: { etag: '"v2"' } }));
      await reader.read(request, authorize, fetchText);
      const pending = reader.read(request, authorize, fetchText);
      await conditionalStarted;
      expect(fetchText.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"v1"' });
      if (eviction === 'ttl') await vi.advanceTimersByTimeAsync(101);
      else await reader.read({ ...request, runId: 'other-run' }, authorize, fetchText);
      const retainedAfterEviction = eviction === 'ttl' ? 0 : 5;
      expect(reader.retainedBytes()).toBe(retainedAfterEviction);
      respond(new Response(null, { status: 304, headers: { etag: '"v1"' } }));
      expect(Buffer.from(await pending).toString()).toBe('hello');
      expect(authorize).toHaveBeenCalledTimes(eviction === 'ttl' ? 4 : 6);
      expect(reader.retainedBytes()).toBe(retainedAfterEviction);
      reader.releaseRun('other-run');
      expect(reader.retainedBytes()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('does not serve stale cached bytes after access denial, offline storage or changed content', async () => {
    const reader = createAgentLibraryTextReader();
    const request = { ...input, runId: 'changed-run' };
    const fetchText = vi.fn().mockResolvedValueOnce(new Response('hello', { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response('world', { headers: { etag: '"v2"' } }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    const old = sliceAgentText(await reader.read(request, authority(), fetchText), { path: '/a' });
    const changed = await reader.read(request, authority(), fetchText);
    expect(() => sliceAgentText(changed, { path: '/a', revision: old.revision })).toThrow('已变化');
    await expect(reader.read(request, authority(), fetchText)).rejects.toThrow('拒绝');
    expect(reader.retainedBytes()).toBe(0);
    await reader.read(request, authority(), async () => new Response('hello', { headers: { etag: '"v3"' } }));
    await expect(reader.read(request, authority(), async () => { throw new Error('offline'); })).rejects.toThrow('不可达');
    expect(reader.retainedBytes()).toBe(0);
  });
  it('isolates runs and bounds cache size and TTL', async () => {
    vi.useFakeTimers();
    try {
      const reader = createAgentLibraryTextReader({ maxBytes: 5, ttlMs: 100 });
      const fetchText = vi.fn<typeof fetch>().mockImplementation(async () => new Response('hello', { headers: { etag: '"v1"' } }));
      await reader.read({ ...input, runId: 'one' }, authority(), fetchText);
      await reader.read({ ...input, runId: 'two' }, authority(), fetchText);
      expect(reader.retainedBytes()).toBe(5);
      expect(fetchText.mock.calls[1][1]?.headers).toBeUndefined();
      await vi.advanceTimersByTimeAsync(101);
      expect(reader.retainedBytes()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('reauthorizes after reading and never returns source URLs', async () => {
    const authorize = authority();
    const fetchText = vi.fn(async () => new Response('hello'));
    expect(Buffer.from(await readAgentLibraryText(input, authorize, fetchText)).toString()).toBe('hello');
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls[1][0]).toMatchObject({ operation: { includeDownloadUrl: false } });
  });
  it('rejects changed identity, denied access and oversized sources before fetch', async () => {
    const authorize = authority();
    authorize.mockResolvedValueOnce({ operation: 'stage-library-node', version: 1, node, downloadUrl: 'https://fixture.test/a' })
      .mockResolvedValueOnce({ operation: 'stage-library-node', version: 1, node: { ...node, storageKey: 'changed' } });
    await expect(readAgentLibraryText(input, authorize, async () => new Response('hello'))).rejects.toThrow('已变化');
    await expect(readAgentLibraryText(input, authority(), async () => new Response('', { status: 403 }))).rejects.toThrow('拒绝');
    const huge = authority();
    huge.mockResolvedValueOnce({ operation: 'stage-library-node', version: 1, node: { ...node, fileSize: 9 * 1024 * 1024 }, downloadUrl: 'https://fixture.test/a' });
    const fetchText = vi.fn();
    await expect(readAgentLibraryText(input, huge, fetchText)).rejects.toThrow('8 MiB');
    expect(fetchText).not.toHaveBeenCalled();
  });
});

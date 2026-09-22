import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import type { AgentFileAuthorityNodeSnapshotV1, AgentFileAuthorityResultV1 } from '@/shared/agent/agent.types';
import { openAgentPluginResource } from './agent-plugin-resource';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';

function fixture() {
  const controller = new AbortController();
  let node: AgentFileAuthorityNodeSnapshotV1 = { version: 1, id: 7, libraryId: 3, parentId: 4,
    type: 'file', name: 'table', ext: 'csv', fileSize: 5, storageKey: 'key.csv', storageProvider: 'fixture', updatedAt: 'v1' };
  let url = 'https://storage.test/bucket/key.csv?signature=private';
  let body = 'hello'; let etag = '"v1"'; let denied = false;
  const input: AgentFileAuthorityBrokerRequestInput = {
    libraryId: 3, ownerScope: { backendScope: 'https://backend.test', accountScope: 'user:42' },
    runId: 'run', sessionId: 'session', toolRunId: 'tool-run',
    sender: { id: 9, isDestroyed: () => false } as WebContents, signal: controller.signal,
    operation: { operation: 'stage-library-node', nodeId: 7, includeDownloadUrl: true },
  };
  const request = vi.fn(async (current: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> => {
    current.signal.throwIfAborted();
    if (denied) throw new Error('denied https://secret.test/token');
    return { operation: 'stage-library-node', version: 1, node: { ...node },
      ...(current.operation.operation === 'stage-library-node' && current.operation.includeDownloadUrl ? { downloadUrl: url } : {}),
    };
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    init?.signal?.throwIfAborted();
    const headers = new Headers(init?.headers);
    if (headers.has('If-Match') && headers.get('If-Match') !== etag) return new Response(null, { status: 412 });
    if (init?.method === 'HEAD') return new Response(null, { headers: { etag, 'content-length': String(Buffer.byteLength(body)) } });
    const range = /^bytes=(\d+)-(\d+)$/u.exec(headers.get('Range') ?? '')!;
    const from = Number(range[1]); const to = Number(range[2]);
    return new Response(Buffer.from(body).subarray(from, to + 1), { status: 206, headers: {
      etag, 'content-range': `bytes ${from}-${to}/${Buffer.byteLength(body)}`, 'content-length': String(to - from + 1),
    } });
  });
  const assertCurrent = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); });
  const options = { request, fetch, storageOrigins: ['https://storage.test'] };
  return { input, options, request, fetch, assertCurrent, controller,
    open: () => openAgentPluginResource(input, assertCurrent, options),
    patchNode: (patch: Partial<AgentFileAuthorityNodeSnapshotV1>) => { node = { ...node, ...patch }; },
    setUrl: (next: string) => { url = next; }, setEtag: (next: string) => { etag = next; },
    setBody: (next: string) => { body = next; }, deny: () => { denied = true; },
  };
}

describe('Agent plugin resource authority', () => {
  it('binds the real owner and node, pins ETag and reads exact ranges without leaking source credentials', async () => {
    const f = fixture(); const resource = await f.open();
    expect(resource).toMatchObject({ accountScope: 'user:42', libraryId: 3, nodeId: 7, name: 'table.csv', size: 5 });
    expect(Object.keys(resource).sort()).toEqual(['accountScope', 'authorize', 'currentRevision', 'libraryId', 'name', 'nodeId', 'readRange', 'revision', 'size']);
    expect(JSON.stringify(resource)).not.toMatch(/private|storage\.test|key\.csv|downloadUrl|storageKey/u);
    expect(await resource.authorize(f.input.signal)).toBe(true);
    expect(await resource.currentRevision(f.input.signal)).toBe(resource.revision);
    expect(Buffer.from(await resource.readRange(1, 3, f.input.signal)).toString()).toBe('ell');
    expect(f.fetch.mock.calls[0][1]?.headers).toEqual({ Range: 'bytes=0-0' });
    expect(f.fetch.mock.lastCall?.[1]?.headers).toEqual({ Range: 'bytes=1-3', 'If-Match': '"v1"' });
    for (const [, init] of f.fetch.mock.calls) {
      expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    }
    for (const [request] of f.request.mock.calls) {
      expect(request).toMatchObject({ sender: f.input.sender, libraryId: 3, ownerScope: f.input.ownerScope,
        runId: 'run', sessionId: 'session', toolRunId: 'tool-run', operation: { operation: 'stage-library-node', nodeId: 7 } });
    }
    expect(f.request.mock.lastCall?.[0].operation).toMatchObject({ includeDownloadUrl: false });
  });

  it.each([{ id: 8 }, { libraryId: 4 }, { type: 'dir' as const }])('rejects a substituted authoritative source %j before storage access', async patch => {
    const f = fixture(); f.patchNode(patch);
    await expect(f.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([{ fileSize: 32 * 1024 * 1024 + 1 }, { fileSize: -1 }, { fileSize: 1.5 }])('rejects invalid file size %j', async patch => {
    const f = fixture(); f.patchNode(patch);
    await expect(f.open()).rejects.toMatchObject({ code: 'LIMIT' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['https://other.test/bucket/key.csv', 'file:///bucket/key.csv', 'https://user:pass@storage.test/bucket/key.csv',
    'https://storage.test/bucket/key.csv#fragment', 'https://storage.test/bucket/another.csv'])('rejects an unauthorized signed URL %s', async url => {
    const f = fixture(); f.setUrl(url);
    await expect(f.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('rejects internal scope lookup bypass, wrong operation and dead sender', async () => {
    const f = fixture(); f.input.internalScopeLookup = true;
    await expect(f.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.input.internalScopeLookup = false;
    f.input.operation = { operation: 'resolve-library-directory', directoryPath: '/' };
    await expect(f.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.request).not.toHaveBeenCalled();
    const dead = fixture(); dead.input.sender = { isDestroyed: () => true } as WebContents;
    await expect(dead.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('captures owner/run/node bindings and permits refreshed signatures only for the pinned object', async () => {
    const f = fixture(); const resource = await f.open();
    f.input.ownerScope.accountScope = 'user:43'; f.input.runId = 'other-run';
    f.input.operation = { operation: 'stage-library-node', nodeId: 900, includeDownloadUrl: true };
    f.setUrl('https://storage.test/bucket/key.csv?signature=refreshed');
    expect(Buffer.from(await resource.readRange(0, 5, f.input.signal)).toString()).toBe('hello');
    expect(f.request.mock.lastCall?.[0]).toMatchObject({ ownerScope: { accountScope: 'user:42' }, runId: 'run', operation: { nodeId: 7 } });
    f.setUrl('https://storage.test/another-bucket/key.csv?signature=rebound');
    await expect(resource.readRange(0, 1, f.input.signal)).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
  });

  it('detects changed metadata before and after fetching, without returning buffered bytes', async () => {
    const before = fixture(); const first = await before.open(); before.patchNode({ updatedAt: 'v2' });
    await expect(first.readRange(0, 5, before.input.signal)).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
    expect(before.fetch).toHaveBeenCalledTimes(1);
    const after = fixture(); const second = await after.open();
    const originalFetch = after.fetch.getMockImplementation()!;
    after.fetch.mockImplementation(async (...args) => {
      const result = await originalFetch(...args); after.patchNode({ parentId: 99 }); return result;
    });
    await expect(second.readRange(0, 5, after.input.signal)).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
  });

  it('detects ETag-only replacement during reads and completion revalidation', async () => {
    const f = fixture(); const resource = await f.open(); f.setEtag('"v2"');
    await expect(resource.readRange(0, 5, f.input.signal)).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
    await expect(resource.currentRevision(f.input.signal)).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
  });

  it('sanitizes authority errors and rechecks host policy both before and after bytes', async () => {
    const f = fixture(); const resource = await f.open(); f.deny();
    await expect(resource.authorize(f.input.signal)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Agent plugin resource access failed' });
    const revoked = fixture(); const live = await revoked.open();
    const originalFetch = revoked.fetch.getMockImplementation()!;
    revoked.fetch.mockImplementation(async (...args) => {
      const result = await originalFetch(...args);
      revoked.assertCurrent.mockRejectedValue(new Error('private policy details'));
      return result;
    });
    await expect(live.readRange(0, 5, revoked.input.signal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed for redirects, non-ranges, weak ETags and malformed Content-Range', async () => {
    for (const makeResponse of [
      () => new Response(null, { status: 302, headers: { location: 'https://secret.test' } }),
      () => new Response('hello', { status: 200 }),
      () => new Response('h', { status: 206, headers: { etag: 'W/"v1"', 'content-range': 'bytes 0-0/5' } }),
      () => new Response('h', { status: 206, headers: { etag: '"v1"', 'content-range': 'bytes 0-0/6' } }),
    ]) {
      const f = fixture(); f.fetch.mockImplementation(async () => makeResponse());
      await expect(f.open()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });

  it('bounds downloaded bodies even when storage lies about size', async () => {
    const f = fixture(); f.fetch.mockImplementation(async () => new Response('hello', { status: 206,
      headers: { etag: '"v1"', 'content-range': 'bytes 0-0/5' } }));
    await expect(f.open()).rejects.toMatchObject({ code: 'LIMIT' });
    const truncated = fixture(); truncated.fetch.mockImplementation(async () => new Response('', { status: 206,
      headers: { etag: '"v1"', 'content-range': 'bytes 0-0/5' } }));
    await expect(truncated.open()).rejects.toMatchObject({ code: 'CONTENT_CHANGED' });
  });

  it('pins empty objects with HEAD and rejects an empty metadata lie', async () => {
    const f = fixture(); f.patchNode({ fileSize: 0 }); f.setBody('');
    const resource = await f.open();
    expect(f.fetch.mock.lastCall?.[1]?.method).toBe('HEAD');
    expect(await resource.readRange(0, 0, f.input.signal)).toEqual(new Uint8Array());
    expect(await resource.currentRevision(f.input.signal)).toBe(resource.revision);
    const fake = fixture(); fake.patchNode({ fileSize: 0 });
    await expect(fake.open()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it.each([[-1, 1], [0, -1], [0, 65_537], [5, 1], [0.5, 1], [0, 0.5]])('rejects out-of-bounds range %s,%s before work', async (offset, length) => {
    const f = fixture(); const resource = await f.open(); f.request.mockClear(); f.fetch.mockClear();
    await expect(resource.readRange(offset, length, f.input.signal)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.request).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });

  it('cancels a hanging stream and never delivers bytes after owner cancellation', async () => {
    const f = fixture(); const resource = await f.open();
    const cancel = vi.fn();
    f.fetch.mockImplementation(async () => new Response(new ReadableStream({ cancel }), { status: 206,
      headers: { etag: '"v1"', 'content-range': 'bytes 0-4/5' } }));
    const reading = resource.readRange(0, 5, f.input.signal);
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));
    f.controller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancel).toHaveBeenCalled();
    await expect(resource.authorize(new AbortController().signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('also honors individual request cancellation and bounded authority timeouts', async () => {
    const f = fixture(); const resource = await f.open();
    const call = new AbortController(); call.abort();
    await expect(resource.readRange(0, 1, call.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    vi.useFakeTimers();
    try {
      const timeout = fixture(); timeout.request.mockImplementation(() => new Promise(() => undefined));
      const opening = timeout.open(); const assertion = expect(opening).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(10_001); await assertion;
    } finally { vi.useRealTimers(); }
  });
});

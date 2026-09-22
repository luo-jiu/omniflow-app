import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import { createPluginRenameTransport, type ConditionalRenameRequest, type ConditionalRenameReceipt, RenameTransportError } from './plugin-rename-transport';

const credentials = { token: 'private-token', username: 'private-user' };
const base = 'https://backend.test/api';
const signal = () => new AbortController().signal;
function request(): ConditionalRenameRequest {
  return { libraryId: 3, operationId: '12345678-1234-4234-8234-123456789abc', items: [
    { nodeId: 9, name: 'new', expected: { name: 'old', ext: 'jpg', parentId: 8, updatedAt: '2026-09-22T09:02:03.123456+08:00' } },
    { nodeId: 10, name: 'next', expected: { name: 'second', ext: '', parentId: 12, updatedAt: '2026-09-22T01:02:03.987654Z' } },
  ] };
}
function receipt(source: ConditionalRenameRequest, state: 'committed' | 'validated' = 'committed'): ConditionalRenameReceipt {
  return { operationId: source.operationId, libraryId: source.libraryId, atomic: true, state, replayed: false,
    items: source.items.map(item => ({ nodeId: item.nodeId, parentId: item.expected.parentId, status: state,
      previous: { name: item.expected.name, ext: item.expected.ext, updatedAt: item.expected.updatedAt },
      current: { name: item.name, ext: item.expected.ext, updatedAt: state === 'validated' ? item.expected.updatedAt : '2026-09-22T01:05:00.123456Z' },
    })), affectedParentIds: [...new Set(source.items.map(item => item.expected.parentId))] };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? '0' : 'A000001', message: 'safe', request_id: 'request', data }), { status });
}
function fixture(data: unknown = receipt(request())) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response(data));
  return { fetch, transport: createPluginRenameTransport({ apiBaseUrl: base, fetch }) };
}

describe('plugin rename transport', () => {
  it('uses fixed backend URLs, isolated credentials and exact snapshots', async () => {
    const source = request(); const f = fixture();
    const result = await f.transport.commit(source, credentials, signal());
    expect(result).toEqual(receipt(source));
    const [url, init] = f.fetch.mock.calls[0];
    expect(url).toBe(`${base}/v1/nodes/rename/batch/conditional`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: 'Bearer private-token', username: 'private-user', 'Content-Type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toEqual(source);
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-user|backend\.test/u);
  });

  it('validates dry-run without claiming committed versions', async () => {
    const source = request(); const value = receipt(source, 'validated');
    const f = fixture({ dryRun: true, result: value });
    expect(await f.transport.dryRun(source, credentials, signal())).toEqual(value);
    expect(f.fetch.mock.calls[0][0]).toBe(`${base}/v1/nodes/rename/batch/conditional?dryRun=true`);
    const bad = fixture({ dryRun: true, result: receipt(source) });
    await expect(bad.transport.dryRun(source, credentials, signal())).rejects.toMatchObject({ code: 'INVALID_RECEIPT', commitState: 'uncommitted' });
  });

  it('accepts idempotent committed receipts and validates status against the full request', async () => {
    const source = request(); const value = receipt(source); value.replayed = true;
    const f = fixture(value);
    expect((await f.transport.commit(source, credentials, signal())).replayed).toBe(true);
    f.fetch.mockResolvedValueOnce(response({ operationId: source.operationId, libraryId: 3, state: 'committed', result: value }));
    expect(await f.transport.status(source, credentials, signal())).toEqual(value);
    expect(f.fetch.mock.lastCall?.[0]).toBe(`${base}/v1/nodes/rename/batch/status?libraryId=3&operationId=${source.operationId}`);
    expect(f.fetch.mock.lastCall?.[1]?.method).toBe('GET');
  });

  it('preserves not_found as absence of a receipt rather than an uncommitted result', async () => {
    const source = request();
    const f = fixture({ operationId: source.operationId, libraryId: 3, state: 'not_found' });
    expect(await f.transport.status(source, credentials, signal())).toBeNull();
    f.fetch.mockResolvedValueOnce(response({ operationId: source.operationId, libraryId: 3, state: 'not_found', result: null }));
    await expect(f.transport.status(source, credentials, signal())).rejects.toMatchObject({ commitState: 'commit_unknown' });
  });

  it.each([
    ['operation', (r: ConditionalRenameReceipt) => { r.operationId = 'other'; }],
    ['library', (r: ConditionalRenameReceipt) => { r.libraryId = 4; }],
    ['atomic', (r: ConditionalRenameReceipt) => { (r as unknown as { atomic: boolean }).atomic = false; }],
    ['state', (r: ConditionalRenameReceipt) => { r.state = 'validated'; }],
    ['replayed', (r: ConditionalRenameReceipt) => { delete (r as Partial<ConditionalRenameReceipt>).replayed; }],
    ['missing item', (r: ConditionalRenameReceipt) => { r.items.pop(); }],
    ['extra item', (r: ConditionalRenameReceipt) => { r.items.push({ ...r.items[0], nodeId: 11 }); }],
    ['duplicate item', (r: ConditionalRenameReceipt) => { r.items[1] = r.items[0]; }],
    ['old name', (r: ConditionalRenameReceipt) => { r.items[0].previous.name = 'swapped'; }],
    ['old ext', (r: ConditionalRenameReceipt) => { r.items[0].previous.ext = 'exe'; }],
    ['old microsecond', (r: ConditionalRenameReceipt) => { r.items[0].previous.updatedAt = '2026-09-22T01:02:03.123457Z'; }],
    ['parent', (r: ConditionalRenameReceipt) => { r.items[0].parentId = 77; }],
    ['new name', (r: ConditionalRenameReceipt) => { r.items[0].current.name = 'other'; }],
    ['new ext', (r: ConditionalRenameReceipt) => { r.items[0].current.ext = 'exe'; }],
    ['new timestamp', (r: ConditionalRenameReceipt) => { r.items[0].current.updatedAt = '2026-02-30T01:00:00Z'; }],
    ['item status', (r: ConditionalRenameReceipt) => { r.items[0].status = 'validated'; }],
    ['affected parent missing', (r: ConditionalRenameReceipt) => { r.affectedParentIds.pop(); }],
    ['affected parent duplicate', (r: ConditionalRenameReceipt) => { r.affectedParentIds[1] = r.affectedParentIds[0]; }],
  ])('rejects a mismatched %s without suggesting the mutation did not commit', async (_name, mutate) => {
    const value = receipt(request()); mutate(value); const f = fixture(value);
    await expect(f.transport.commit(request(), credentials, signal())).rejects.toMatchObject({ code: 'INVALID_RECEIPT', commitState: 'commit_unknown' });
  });

  it('compares all fractional digits while accepting UTC normalization', async () => {
    const source = request(); const value = receipt(source);
    value.items[0].previous.updatedAt = '2026-09-22T01:02:03.123456000Z';
    expect(await fixture(value).transport.commit(source, credentials, signal())).toMatchObject({ state: 'committed' });
    value.items[0].previous.updatedAt = '2026-09-22T01:02:03.123456001Z';
    await expect(fixture(value).transport.commit(source, credentials, signal())).rejects.toMatchObject({ code: 'INVALID_RECEIPT' });
  });

  it.each([400, 401, 403, 404, 409])('reports explicit HTTP %i as uncommitted', async status => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(response({ secret: credentials.token }, status));
    await expect(f.transport.commit(request(), credentials, signal())).rejects.toMatchObject({ code: `HTTP_${status}`, status, commitState: 'uncommitted' });
  });

  it.each([500, 502, 503, 307, 429])('keeps HTTP %i outcomes unknown', async status => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(response(null, status));
    await expect(f.transport.commit(request(), credentials, signal())).rejects.toMatchObject({ commitState: 'commit_unknown' });
  });

  it('sanitizes network errors and backend error bodies', async () => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(new Error(`https://secret.test/path?token=${credentials.token} body-password`));
    const error = await f.transport.commit(request(), credentials, signal()).catch(error => error);
    expect(error).toBeInstanceOf(RenameTransportError);
    expect(error).toMatchObject({ code: 'NETWORK', commitState: 'commit_unknown' });
    expect(String(error) + JSON.stringify(error)).not.toMatch(/secret\.test|private-token|body-password/u);
    f.fetch.mockResolvedValueOnce(new Response('https://secret.test/private-token', { status: 409 }));
    const httpError = await f.transport.commit(request(), credentials, signal()).catch(error => error);
    expect(String(httpError) + JSON.stringify(httpError)).not.toMatch(/secret\.test|private-token/u);
  });

  it('rejects malformed success envelopes and oversize bodies as unknown commit outcomes', async () => {
    const f = fixture();
    for (const value of [new Response('broken JSON'), new Response(JSON.stringify({ code: '0', data: receipt(request()) })),
      new Response(JSON.stringify({ code: 'bad', message: 'secret', request_id: 'x', data: receipt(request()) })),
      new Response(' '.repeat(256 * 1024 + 1)), new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } })]) {
      f.fetch.mockResolvedValueOnce(value);
      await expect(f.transport.commit(request(), credentials, signal())).rejects.toMatchObject({ commitState: 'commit_unknown' });
    }
  });

  it('validates the numeric actor and never returns user metadata', async () => {
    const f = fixture({ id: 42, password: 'do-not-return' });
    expect(await f.transport.verifyActor(credentials, { accountScope: 'user:42' }, signal())).toBeUndefined();
    expect(f.fetch.mock.calls[0][0]).toBe(`${base}/v1/user/me`);
    await expect(f.transport.verifyActor(credentials, { accountScope: 'user:43' }, signal())).rejects.toMatchObject({ code: 'ACTOR_MISMATCH' });
    f.fetch.mockResolvedValueOnce(response({ id: '42' }));
    await expect(f.transport.verifyActor(credentials, { accountScope: 'user:42' }, signal())).rejects.toMatchObject({ code: 'ACTOR_MISMATCH' });
  });

  it('freezes caller-owned request snapshots during the fetch', async () => {
    const source = request(); const original = structuredClone(source); const f = fixture();
    f.fetch.mockImplementationOnce(async () => {
      source.items[0].name = 'changed'; source.items[0].expected.name = 'changed';
      return response(receipt(original));
    });
    expect((await f.transport.commit(source, credentials, signal())).items[0].current.name).toBe('new');
  });

  it('does not send already-cancelled requests and preserves uncertainty after dispatch', async () => {
    const f = fixture(); const cancelled = new AbortController(); cancelled.abort('private-reason');
    await expect(f.transport.commit(request(), credentials, cancelled.signal)).rejects.toMatchObject({ code: 'CANCELLED', commitState: 'uncommitted' });
    expect(f.fetch).not.toHaveBeenCalled();
    const running = new AbortController(); f.fetch.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = f.transport.commit(request(), credentials, running.signal); running.abort('private-reason');
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', commitState: 'commit_unknown' });
    // 结算使用独立 signal，不能沿用已取消的提交请求。
    f.fetch.mockResolvedValueOnce(response({ operationId: request().operationId, libraryId: 3, state: 'committed', result: receipt(request()) }));
    expect(await f.transport.status(request(), credentials, signal())).toMatchObject({ state: 'committed' });
  });

  it('aborts a stalled body and cancels its upstream reader', async () => {
    const cancel = vi.fn(); const f = fixture(); const controller = new AbortController();
    f.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull() { return new Promise(() => undefined); }, cancel })));
    const pending = f.transport.commit(request(), credentials, controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', commitState: 'commit_unknown' });
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects invalid API bases and credentials before any network call', async () => {
    for (const apiBaseUrl of ['file:///tmp/a', 'https://user:pass@example.test', 'https://example.test?q=1', 'https://example.test/#x']) {
      expect(() => createPluginRenameTransport({ apiBaseUrl })).toThrow(RenameTransportError);
    }
    const f = fixture();
    await expect(f.transport.commit(request(), { token: 'injected\r\nheader', username: '' }, signal())).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', commitState: 'uncommitted' });
    const invalid = request(); invalid.items[0].name = '../escape';
    await expect(f.transport.commit(invalid, credentials, signal())).rejects.toMatchObject({ code: 'INVALID_REQUEST', commitState: 'uncommitted' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('keeps failed status checks unknown even when the current actor has lost permission', async () => {
    const f = fixture(); f.fetch.mockResolvedValueOnce(response(null, 403));
    await expect(f.transport.status(request(), credentials, signal())).rejects.toMatchObject({ code: 'HTTP_403', commitState: 'commit_unknown' });
    f.fetch.mockResolvedValueOnce(response({ operationId: request().operationId, libraryId: 3, state: 'committed', result: receipt(request()) }));
    const changed = request(); changed.items[0].name = 'other';
    await expect(f.transport.status(changed, credentials, signal())).rejects.toMatchObject({ code: 'INVALID_RECEIPT', commitState: 'commit_unknown' });
  });
});

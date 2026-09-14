import { describe, expect, it, vi } from 'vitest';
import { openLibraryResource } from './library-resource';
function fixture() {
  let allowed = true; let updatedAt = '2026-09-14T00:00:00Z'; let etag = '"v1"'; let libraryId = 3;
  let redirect = false; let wrongRange = false; let target = 'https://storage.test/bucket/key.csv?signature=synthetic';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    const data = (value: unknown) => new Response(JSON.stringify({ code: '0', data: value }));
    if (!allowed) return new Response(null, { status: 403 });
    if (url.includes('/user/me')) return data({ id: 42 });
    if (url.includes('/nodes/')) return data({ id: 99, libraryId, type: 'file', name: 'test', ext: 'csv', fileSize: 3, storageKey: 'key.csv', storageBucket: 'bucket', storageProvider: 'test', updatedAt });
    if (url.includes('/directory/link')) return data(target);
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://other.test/secret' } });
    const headers = new Headers(init?.headers);
    if (headers.has('If-Match') && headers.get('If-Match') !== etag) return new Response(null, { status: 412 });
    const range = /bytes=(\d+)-(\d+)/.exec(headers.get('Range') ?? '')!;
    const start = Number(range[1]); const end = Number(range[2]);
    return new Response(Buffer.from('abc').subarray(start, end + 1), { status: 206, headers: { ETag: etag, 'Content-Range': `bytes ${start}-${end}/${wrongRange ? 100 : 3}` } });
  }) as unknown as typeof fetch;
  return { options: { apiBaseUrl: 'https://api.test/api', storageOrigins: ['https://storage.test'], token: 'synthetic-token', username: 'test', libraryId: 3, nodeId: 99, signal: new AbortController().signal, fetch: fetcher },
    calls, deny: () => { allowed = false; }, move: () => { libraryId = 4; }, change: () => { updatedAt = 'changed'; }, changeEtag: () => { etag = '"v2"'; },
    setTarget: (url: string) => { target = url; }, redirect: () => { redirect = true; }, wrongRange: () => { wrongRange = true; } };
}
describe('server-authorized plugin resource', () => {
  it('uses server identity, pins ETag and never forwards credentials to storage', async () => {
    const f = fixture(); const authority = await openLibraryResource(f.options);
    expect(authority.name).toBe('test.csv'); expect(authority.size).toBe(3); expect(Buffer.from(await authority.readRange(1,2,f.options.signal)).toString()).toBe('bc');
    const requests=f.calls.filter(call=>call.url.startsWith('https://storage.test'));
    expect(requests).toHaveLength(2); expect(new Headers(requests[1].init?.headers).get('If-Match')).toBe('"v1"');
    expect(requests.every(call=>!new Headers(call.init?.headers).has('Authorization') && call.init?.redirect === 'error' && call.init?.credentials === 'omit')).toBe(true);
  });
  it('rejects nodes belonging to another library and revoked users', async () => {
    const f=fixture(); f.move(); await expect(openLibraryResource(f.options)).rejects.toMatchObject({code:'FORBIDDEN'});
    const g=fixture(); const authority=await openLibraryResource(g.options); g.deny(); await expect(authority.authorize(g.options.signal)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('detects metadata changes and enforces object version across ranges', async () => {
    const f=fixture(); const authority=await openLibraryResource(f.options); f.change(); expect(await authority.currentRevision(f.options.signal)).not.toBe(authority.revision);
    f.changeEtag(); await expect(authority.readRange(1,2,f.options.signal)).rejects.toMatchObject({code:'CONTENT_CHANGED'});
  });
  it.each(['https://other.test/bucket/key.csv','https://storage.test/bucket/other.csv','file:///bucket/key.csv','https://user:password@storage.test/bucket/key.csv'])('rejects out-of-scope signed target %s', async url=>{
    const f=fixture(); f.setTarget(url); await expect(openLibraryResource(f.options)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('rejects redirect and inconsistent content ranges', async()=>{const f=fixture(); f.redirect(); await expect(openLibraryResource(f.options)).rejects.toMatchObject({code:'UNAVAILABLE'}); const g=fixture(); g.wrongRange(); await expect(openLibraryResource(g.options)).rejects.toMatchObject({code:'UNAVAILABLE'});});
});

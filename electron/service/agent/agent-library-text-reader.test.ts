import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import { createAgentLibraryTextReader, readAgentLibraryText } from './agent-library-text-reader';
import { sliceAgentText } from './agent-text-reader';
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

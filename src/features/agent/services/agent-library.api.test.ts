import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/service/request/ipcRequest', () => ({ ipcRequest: mocks.request }));
import { executeAgentLibraryQuery, queryLibraryMetadata, resolveAgentLibraryPath } from './agent-library.api';
import { normalizeAgentLibraryReadResult } from '@/shared/agent/agent-library-query';

const root = { id: 10, parentId: 0, libraryId: 3, name: '根目录', type: 'dir', path: '/', fileSize: 0 };
const music = { id: 20, parentId: 10, libraryId: 3, name: '音乐', type: 'dir', path: '/音乐', fileSize: 0 };
const song = { id: 30, parentId: 20, libraryId: 3, name: 'song', ext: 'mp3', type: 'file', path: '/音乐/song.mp3', fileSize: 100, storageProvider: 'offline' };

describe('Agent library metadata queries', () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (_url, options) => {
      const query = JSON.parse(options.body);
      let entries = [root, music, song];
      if (query.mode === 'root') entries = [];
      else if (query.mode === 'node') entries = entries.filter(node => node.id === query.nodeId);
      else if (query.mode === 'children') entries = entries.filter(node => node.parentId === (query.parentId || root.id));
      else entries = entries.filter(node => node.id !== root.id);
      if (query.names) entries = entries.filter(node => query.names.includes(node.name));
      if (query.nodeType) entries = entries.filter(node => node.type === query.nodeType);
      if (query.keyword) entries = entries.filter(node => node.name.includes(query.keyword));
      return { data: { root, entries, hasMore: false } };
    });
  });

  it('resolves a library file path and browses another directory without MinIO or UI selection', async () => {
    const checkStorage = vi.fn();
    const resolved = await executeAgentLibraryQuery(3, { kind: 'resolve', path: '/音乐/song.mp3' }, queryLibraryMetadata, checkStorage);
    expect(resolved.node).toMatchObject({ id: 30, parentId: 20, path: '/音乐/song.mp3' });
    expect(resolved.node).not.toHaveProperty('storageKey');
    const listed = await executeAgentLibraryQuery(3, { kind: 'list', path: '/音乐' }, queryLibraryMetadata, checkStorage);
    expect(listed.directory?.id).toBe(20);
    expect(listed.entries?.map(node => node.id)).toEqual([30]);
    expect(checkStorage).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls.every(([url]) => url === '/v1/nodes/metadata/query')).toBe(true);
  });

  it('forwards search scope, filters and the unmodified pagination cursor', async () => {
    mocks.request.mockResolvedValueOnce({ data: { root, entries: [song], hasMore: true, nextCursor: 'next' } });
    const result = await executeAgentLibraryQuery(3, { kind: 'search', keyword: 'song', nodeType: 'file', tagIds: [4], cursor: 'previous', limit: 1 });
    expect(result).toMatchObject({ hasMore: true, nextCursor: 'next', entries: [{ id: 30 }] });
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ mode: 'search', keyword: 'song', nodeType: 'file', libraryId: 3, tagIds: [4], cursor: 'previous', limit: 1 });
  });

  it('rejects missing paths, ambiguous paths, scope violations and changed paths', async () => {
    await expect(resolveAgentLibraryPath(3, '/缺失')).rejects.toThrow('不存在');
    mocks.request.mockImplementationOnce(async () => ({ data: { root, entries: [], hasMore: false } }))
      .mockImplementationOnce(async () => ({ data: { root, entries: [music, { ...music, id: 21 }], hasMore: false } }));
    await expect(resolveAgentLibraryPath(3, '/音乐')).rejects.toThrow('重名');
    mocks.request.mockResolvedValueOnce({ data: { root, entries: [{ ...song, libraryId: 4 }], hasMore: false } });
    await expect(queryLibraryMetadata(3, { mode: 'node', nodeId: 30 })).rejects.toThrow('范围');
    mocks.request.mockResolvedValueOnce({ data: { root, entries: [], hasMore: false } })
      .mockResolvedValueOnce({ data: { root, entries: [music], hasMore: false } })
      .mockResolvedValueOnce({ data: { root, entries: [{ ...music, path: '/改名' }], hasMore: false } });
    await expect(resolveAgentLibraryPath(3, '/音乐')).rejects.toThrow('已变化');
  });

  it('does not deliver oversized partial pages or invalid continuation metadata', async () => {
    const data = { libraryId: 3, entries: Array.from({ length: 100 }, (_, i) => ({ ...song, id: 100+i, name: 'x'.repeat(500) })), hasMore: true, nextCursor: 'skip' };
    expect(() => normalizeAgentLibraryReadResult(data, 3)).toThrow('原 cursor');
    mocks.request.mockResolvedValueOnce({ data: { root, entries: [song], hasMore: true } });
    await expect(queryLibraryMetadata(3, { mode: 'search' })).rejects.toThrow('分页');
  });

  it('automatically reduces oversized pages without skipping the original cursor', async () => {
    mocks.request.mockImplementation(async (_url, options) => {
      const query = JSON.parse(options.body);
      return { data: { root, entries: Array.from({ length: query.limit }, (_, i) => ({ ...song, id: 100 + i, name: 'x'.repeat(500) })), hasMore: true, nextCursor: `after-${query.limit}` } };
    });
    const result = await executeAgentLibraryQuery(3, { kind: 'search', limit: 100, cursor: 'original' });
    expect(result.entries!.length).toBeLessThan(100);
    expect(result.nextCursor).toBe(`after-${result.entries!.length}`);
    expect(mocks.request.mock.calls.every(([, options]) => JSON.parse(options.body).cursor === 'original')).toBe(true);
  });
});

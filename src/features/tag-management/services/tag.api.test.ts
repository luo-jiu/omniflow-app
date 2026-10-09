import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/service/request/ipcRequest', () => ({ ipcRequest: mocks.request }));
import { createLibraryTag, deleteLibraryTag, queryLibraryTags, readNodeTags, updateLibraryTag, updateNodeTags } from './tag.api';

describe('library tag API', () => {
  beforeEach(() => { mocks.request.mockReset(); });
  it('queries a single server page with literal keyword, library and opaque cursor', async () => {
    mocks.request.mockResolvedValue({ data: { entries: [{ id: 8, libraryId: 3, name: '日语' }], hasMore: true, nextCursor: 'later' } });
    const page = await queryLibraryTags({ libraryId: 3, keyword: ' 日语% ', dimension: '语言', enabled: false, cursor: 'page+/=', limit: 20 });
    expect(page.nextCursor).toBe('later');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const query = new URL(mocks.request.mock.calls[0][0], 'https://example.test').searchParams;
    expect(Object.fromEntries(query)).toEqual({ libraryId: '3', keyword: '日语%', dimension: '语言', enabled: '0', cursor: 'page+/=', limit: '20' });
  });
  it('resolves only explicit selected ids without the enabled filter and never fetches an empty ids selection', async () => {
    mocks.request.mockResolvedValue({ data: { entries: [], hasMore: false } });
    await queryLibraryTags({ libraryId: 3, ids: [8, 10], limit: 100 });
    expect(mocks.request.mock.calls[0][0]).toContain('ids=8%2C10');
    expect(mocks.request.mock.calls[0][0]).not.toContain('enabled=');
    expect(await queryLibraryTags({ libraryId: 3, ids: [] })).toEqual({ entries: [], hasMore: false });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-library results and broken continuation without silently accepting a legacy full catalog', async () => {
    mocks.request.mockResolvedValueOnce({ data: [{ id: 8 }] });
    await expect(queryLibraryTags({ libraryId: 3 })).rejects.toThrow('分页');
    mocks.request.mockResolvedValueOnce({ data: { entries: [], hasMore: true } });
    await expect(queryLibraryTags({ libraryId: 3 })).rejects.toThrow('分页');
    mocks.request.mockResolvedValueOnce({ data: { entries: [{ id: 8, libraryId: 4 }], hasMore: false } });
    await expect(queryLibraryTags({ libraryId: 3 })).rejects.toThrow('资料库');
  });
  it('accepts authorized legacy projections with the requested library and rejects missing or other library ownership', async () => {
    const page = { entries: [{ id: 8, libraryId: 3, legacy: true, name: '旧标签' }], hasMore: false };
    mocks.request.mockResolvedValue({ data: page });
    await expect(queryLibraryTags({ libraryId: 3, ids: [8] })).resolves.toEqual(page);
    await expect(queryLibraryTags({ libraryId: 3, nodeId: 9 })).resolves.toEqual(page);
    mocks.request.mockResolvedValue({ data: { ...page, entries: [{ ...page.entries[0], libraryId: null }] } });
    await expect(queryLibraryTags({ libraryId: 3, ids: [8] })).rejects.toThrow('资料库');
    mocks.request.mockResolvedValue({ data: { ...page, entries: [{ ...page.entries[0], libraryId: 4 }] } });
    await expect(queryLibraryTags({ libraryId: 3, nodeId: 9 })).rejects.toThrow('资料库');
  });
  it('scopes definitions to the library and does not resubmit stale fields on enabled changes', async () => {
    mocks.request.mockResolvedValue({ data: { id: 8, libraryId: 3 } });
    await createLibraryTag(3, { name: ' 日语 ', color: '#112233', dimension: '语言' });
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({ libraryId: 3, name: '日语', color: '#112233', dimension: '语言' });
    await updateLibraryTag(3, 8, { enabled: 0 });
    expect(JSON.parse(mocks.request.mock.calls[1][1].body)).toEqual({ libraryId: 3, enabled: 0 });
    await deleteLibraryTag(3, 8);
    expect(mocks.request.mock.calls[2]).toEqual(['/v1/tags/8?libraryId=3', { method: 'DELETE' }]);
    await updateLibraryTag(3, 8, { description: null, textColor: null });
    expect(JSON.parse(mocks.request.mock.calls[3][1].body)).toEqual({ libraryId: 3, description: '', textColor: '' });
  });
  it('shares authoritative node tag delta receipts and rejects dry-run/cross-library responses', async () => {
    const state = { nodeId: 9, libraryId: 3, parentId: 5, tagIds: [8], affectedParentIds: [5], dryRun: false };
    mocks.request.mockResolvedValueOnce({ data: state });
    expect(await readNodeTags(9, 3)).toEqual(state);
    mocks.request.mockResolvedValueOnce({ data: state });
    expect(await updateNodeTags(9, { libraryId: 3, addTagIds: [8], removeTagIds: [7] })).toEqual(state);
    expect(JSON.parse(mocks.request.mock.calls[1][1].body)).toEqual({ libraryId: 3, addTagIds: [8], removeTagIds: [7] });
    mocks.request.mockResolvedValueOnce({ data: { ...state, dryRun: true } });
    await expect(updateNodeTags(9, { libraryId: 3, addTagIds: [8], removeTagIds: [] })).rejects.toThrow('预演');
    mocks.request.mockResolvedValueOnce({ data: { ...state, libraryId: 4 } });
    await expect(readNodeTags(9, 3)).rejects.toThrow('回执');
  });
  it('sends preview through the query flag and unwraps its rollback receipt', async () => {
    const state = { nodeId: 9, libraryId: 3, parentId: 5, tagIds: [8], affectedParentIds: [5], dryRun: true };
    mocks.request.mockResolvedValue({ data: { dryRun: true, result: state } });
    expect(await updateNodeTags(9, { libraryId: 3, addTagIds: [8], removeTagIds: [], dryRun: true })).toEqual(state);
    expect(mocks.request.mock.calls[0][0]).toBe('/v1/nodes/9/tags?dryRun=true');
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({ libraryId: 3, addTagIds: [8], removeTagIds: [] });
  });
});

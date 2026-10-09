import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../services/tag.api', () => ({ queryLibraryTags: mocks.query }));
import { useDebouncedTagKeyword, useLibraryTagPage } from './useLibraryTagPage';

describe('bounded library tag pages', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  let page: ReturnType<typeof useLibraryTagPage>;
  function Probe(props: { libraryId?: number; keyword?: string }) { page = useLibraryTagPage(props); return null; }
  beforeEach(() => { mocks.query.mockReset(); });
  afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); });

  it('does not query before selecting a library, and fetches only the requested page', async () => {
    mocks.query.mockResolvedValueOnce({ entries: [{ id: 8 }], hasMore: true, nextCursor: 'page2' })
      .mockResolvedValueOnce({ entries: [{ id: 9 }], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    expect(mocks.query).not.toHaveBeenCalled();
    await act(async () => { renderer!.update(<Probe libraryId={3} />); });
    expect(page!.entries.map(tag => tag.id)).toEqual([8]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    await act(async () => page!.next());
    expect(mocks.query.mock.calls[1][0]).toMatchObject({ libraryId: 3, limit: 50, cursor: 'page2' });
    expect(page!.entries.map(tag => tag.id)).toEqual([9]);
    expect(page!.pageIndex).toBe(1);
  });

  it('drops old library results and resets cursor history when switching libraries', async () => {
    let oldResolve!: (page: unknown) => void;
    mocks.query.mockResolvedValueOnce({ entries: [{ id: 8 }], hasMore: true, nextCursor: 'old-next' })
      .mockImplementationOnce(() => new Promise(resolve => { oldResolve = resolve; }))
      .mockResolvedValueOnce({ entries: [{ id: 20 }], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<Probe libraryId={3} />); });
    await act(async () => page!.next());
    await act(async () => { renderer!.update(<Probe libraryId={4} />); });
    expect(page!.pageIndex).toBe(0);
    expect(mocks.query.mock.calls[2][0]).toMatchObject({ libraryId: 4, cursor: undefined });
    await act(async () => oldResolve({ entries: [{ id: 9 }], hasMore: false }));
    expect(page!.entries.map(tag => tag.id)).toEqual([20]);
    mocks.query.mockResolvedValueOnce({ entries: [{ id: 8 }], hasMore: false });
    await act(async () => { renderer!.update(<Probe libraryId={3} />); });
    expect(page!.pageIndex).toBe(0);
    expect(mocks.query.mock.calls[3][0]).toMatchObject({ libraryId: 3, cursor: undefined });
  });

  it('clears paging when the search changes and ignores an older failed search', async () => {
    let rejectOld!: (error: Error) => void;
    mocks.query.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce({ entries: [{ id: 20 }], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<Probe libraryId={3} keyword="old" />); });
    await act(async () => { renderer!.update(<Probe libraryId={3} keyword="new" />); });
    await act(async () => rejectOld(new Error('stale failure')));
    expect(page!.error).toBe('');
    expect(page!.entries.map(tag => tag.id)).toEqual([20]);
  });

  it('debounces typing and cancels the timer on unmount', async () => {
    vi.useFakeTimers();
    let keyword = '';
    function Search({ value }: { value: string }) { keyword = useDebouncedTagKeyword(value); return null; }
    act(() => { renderer = TestRenderer.create(<Search value="" />); });
    act(() => renderer!.update(<Search value="日" />));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => renderer!.update(<Search value="日语" />));
    act(() => { vi.advanceTimersByTime(249); });
    expect(keyword).toBe('');
    act(() => { vi.advanceTimersByTime(1); });
    expect(keyword).toBe('日语');
    act(() => renderer!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});

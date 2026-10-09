import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../services/tag.api', () => ({ queryLibraryTags: mocks.query }));
vi.mock('@douyinfe/semi-ui', () => ({
  Button: (props: any) => <button {...props} />,
  Input: (props: any) => <input {...props} />,
  Tag: ({ children, onClose }: any) => <span data-tag><button onClick={onClose}>{children}</button></span>,
  Popover: ({ children, visible, content, onVisibleChange }: any) => <div><button data-open onClick={() => onVisibleChange(!visible)}>{children}</button>{visible ? content : null}</div>,
}));
import { LibraryTagPicker } from './LibraryTagPicker';

describe('library tag picker', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => { mocks.query.mockReset(); });
  afterEach(() => act(() => renderer?.unmount()));

  it('resolves selected ids while closed and preserves unknown or deleted relations until explicitly removed', async () => {
    mocks.query.mockResolvedValue({ entries: [{ id: 8, libraryId: 3, name: '日语', color: '#123456', enabled: 0, deleted: true }], hasMore: false });
    const change = vi.fn();
    await act(async () => { renderer = TestRenderer.create(<LibraryTagPicker libraryId={3} valueIds={[8, 99]} onChange={change} />); });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toEqual({ libraryId: 3, ids: [8, 99], limit: 100 });
    expect(JSON.stringify(renderer.toJSON())).toContain('已删除');
    expect(JSON.stringify(renderer.toJSON())).toContain('标签 #99');
    const chips = renderer.root.findAllByProps({ 'data-tag': true });
    act(() => chips[0].findByType('button').props.onClick());
    expect(change).toHaveBeenCalledWith([99]);
  });

  it('fetches a catalog page only when opened, and keeps selected ids when selecting from another page', async () => {
    mocks.query.mockImplementation(async input => input.ids
      ? { entries: [{ id: 8, libraryId: 3, name: '已有标签' }], hasMore: false }
      : input.cursor ? { entries: [{ id: 10, libraryId: 3, name: '新标签' }], hasMore: false }
        : { entries: [{ id: 9, libraryId: 3, name: '第一页' }], hasMore: true, nextCursor: 'next' });
    const change = vi.fn();
    await act(async () => { renderer = TestRenderer.create(<LibraryTagPicker libraryId={3} valueIds={[8]} onChange={change} />); });
    await act(async () => renderer.root.findByProps({ 'data-open': true }).props.onClick());
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const next = renderer.root.findAllByType('button').find(button => button.children.includes('下一页'))!;
    await act(async () => next.props.onClick());
    expect(mocks.query.mock.calls[2][0]).toMatchObject({ libraryId: 3, enabled: true, cursor: 'next' });
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange());
    expect(change).toHaveBeenCalledWith([8, 10]);
  });

  it('does not display another library selected-name response after switching libraries', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ entries: [{ id: 8, libraryId: 4, name: '当前库' }], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<LibraryTagPicker libraryId={3} valueIds={[8]} onChange={() => {}} />); });
    await act(async () => renderer.update(<LibraryTagPicker libraryId={4} valueIds={[8]} onChange={() => {}} />));
    await act(async () => resolveOld({ entries: [{ id: 8, libraryId: 3, name: '旧库' }], hasMore: false }));
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain('当前库');
    expect(output).not.toContain('旧库');
  });
  it('shows a selected legacy tag for removal without offering it as a new candidate', async () => {
    mocks.query.mockResolvedValue({ entries: [{ id: 8, libraryId: 3, name: '旧标签', legacy: true, enabled: 1 }], hasMore: false });
    const change = vi.fn();
    await act(async () => { renderer = TestRenderer.create(<LibraryTagPicker libraryId={3} valueIds={[8]} onChange={change} />); });
    await act(async () => renderer.root.findByProps({ 'data-open': true }).props.onClick());
    expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('旧标签');
    act(() => renderer.root.findByProps({ 'data-tag': true }).findByType('button').props.onClick());
    expect(change).toHaveBeenCalledWith([]);
  });
});

import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ params: {} as { id?: string }, libraries: vi.fn(), query: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => mocks.params }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ fetchRepositories: mocks.libraries }));
vi.mock('@/features/tag-management/services/tag.api', () => ({ queryLibraryTags: mocks.query, createLibraryTag: mocks.create, updateLibraryTag: mocks.update, deleteLibraryTag: mocks.remove }));
vi.mock('@/components/ui/compact-modal', () => ({ CompactModal: ({ visible, children, ...props }: any) => visible ? <section data-editor {...props}>{children}</section> : null }));
vi.mock('@/components/ui/compact-confirm', () => ({ openCompactConfirm: vi.fn() }));
vi.mock('@douyinfe/semi-icons', () => ({ IconChevronLeft: () => null, IconDelete: () => null, IconEdit: () => null }));
vi.mock('@douyinfe/semi-ui', () => {
  const Input = (props: any) => <input {...props} />;
  const ColorPicker = Object.assign((props: any) => <div data-color-picker {...props} />, { colorStringToValue: (value: string) => value });
  return { Button: (props: any) => <button {...props} />, Input, InputNumber: Input, TextArea: Input, Select: (props: any) => <select {...props} />,
    Switch: (props: any) => <input type="checkbox" {...props} />, ColorPicker, Toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } };
});
import TagManagement from './index';

describe('library tag management scope', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    mocks.params = {};
    mocks.libraries.mockReset().mockResolvedValue([{ id: 3, name: 'Work' }, { id: 4, name: 'Personal' }]);
    mocks.query.mockReset().mockResolvedValue({ entries: [], hasMore: false });
    mocks.create.mockReset(); mocks.update.mockReset(); mocks.remove.mockReset();
  });
  afterEach(() => act(() => renderer?.unmount()));

  it('requires a deliberate library selection outside a library route', async () => {
    await act(async () => { renderer = TestRenderer.create(<TagManagement embedded />); });
    expect(mocks.query).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByType('select').props.onChange(4));
    expect(mocks.query.mock.calls[0][0]).toMatchObject({ libraryId: 4 });
  });

  it('uses the current route library and drops editor drafts when the library changes', async () => {
    mocks.params = { id: '3' };
    await act(async () => { renderer = TestRenderer.create(<TagManagement embedded />); });
    expect(mocks.query.mock.calls[0][0]).toMatchObject({ libraryId: 3 });
    const createButton = renderer.root.findAllByType('button').find(button => button.children.includes('新建标签'))!;
    act(() => createButton.props.onClick());
    const nameInput = renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '标签名称')!;
    act(() => nameInput.props.onChange('旧库草稿'));
    expect(renderer.root.findAllByType('section')).toHaveLength(3);
    await act(async () => renderer.root.findAllByType('select').find(select => select.props['aria-label'] === '选择资料库')!.props.onChange(4));
    expect(renderer.root.findAllByProps({ 'data-editor': true })).toHaveLength(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[mocks.query.mock.calls.length - 1]?.[0]).toMatchObject({ libraryId: 4, cursor: undefined });
  });
  it('submits only edited fields and uses an empty string to clear a description', async () => {
    mocks.params = { id: '3' };
    const tag = { id: 8, libraryId: 3, name: '日语', color: '#112233', description: '旧说明', textColor: null, dimension: 'language', sortOrder: 10, enabled: 1 };
    mocks.query.mockResolvedValue({ entries: [tag], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<TagManagement embedded />); });
    act(() => renderer.root.findAllByType('button').find(button => button.props['aria-label'] === '编辑 日语')!.props.onClick());
    act(() => renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '标签主色')!.props.onChange('#445566'));
    act(() => renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '标签说明')!.props.onChange(''));
    await act(async () => renderer.root.findByProps({ 'data-editor': true }).props.onOk());
    expect(mocks.update).toHaveBeenCalledWith(3, 8, { color: '#445566', description: '' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not edit, enable or delete legacy definitions', async () => {
    mocks.params = { id: '3' };
    mocks.query.mockResolvedValue({ entries: [{ id: 8, libraryId: 3, name: '旧标签', legacy: true, color: '#112233', enabled: 1 }], hasMore: false });
    await act(async () => { renderer = TestRenderer.create(<TagManagement embedded />); });
    const edit = renderer.root.findAllByType('button').find(button => button.props['aria-label'] === '编辑 旧标签')!;
    const remove = renderer.root.findAllByType('button').find(button => button.props['aria-label'] === '删除 旧标签')!;
    const toggle = renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '启用 旧标签')!;
    expect([edit.props.disabled, remove.props.disabled, toggle.props.disabled]).toEqual([true, true, true]);
    await act(async () => { edit.props.onClick(); remove.props.onClick(); toggle.props.onChange(false); });
    expect(renderer.root.findAllByProps({ 'data-editor': true })).toHaveLength(0);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('limits descriptions to 255 Unicode code points without cutting a surrogate pair', async () => {
    mocks.params = { id: '3' };
    await act(async () => { renderer = TestRenderer.create(<TagManagement embedded />); });
    act(() => renderer.root.findAllByType('button').find(button => button.children.includes('新建标签'))!.props.onClick());
    act(() => renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '标签名称')!.props.onChange('标签'));
    const description = renderer.root.findAllByType('input').find(input => input.props['aria-label'] === '标签说明')!;
    expect(description.props.maxLength).toBe(255);
    expect(description.props.getValueLength('🎧')).toBe(1);
    act(() => description.props.onChange('🎧'.repeat(256)));
    await act(async () => renderer.root.findByProps({ 'data-editor': true }).props.onOk());
    expect(mocks.create.mock.calls[0][1].description).toBe('🎧'.repeat(255));
  });
});

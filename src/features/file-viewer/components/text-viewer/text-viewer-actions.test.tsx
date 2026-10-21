import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), upload: vi.fn(), stage: vi.fn(), cleanup: vi.fn(), capture: vi.fn(), notify: vi.fn(),
  dialog: vi.fn(), draftRead: vi.fn(), draftWrite: vi.fn<(key: unknown, content: string) => Promise<void>>(async () => undefined),
  draftDelete: vi.fn(async () => undefined), save: vi.fn(),
}));
vi.mock('@douyinfe/semi-ui', () => ({
  Button: (props: any) => <button {...props} />,
  Input: (props: any) => <input {...props} />,
  Modal: (props: any) => <div {...props} />,
  Spin: () => null,
  Toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@douyinfe/semi-icons', () => ({ IconCopyAdd: () => null, IconDownload: () => null, IconSave: () => null }));
vi.mock('@uiw/react-codemirror', () => ({ default: () => null }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));
vi.mock('@/hooks/useFileViewer', () => ({ useFileViewer: () => ({ updateFileTabResource: mocks.notify }) }));
vi.mock('@/features/file-explorer/services/file.api', () => ({
  fetchNodeDetailById: mocks.detail, uploadLocalPathAndCreateNode: mocks.upload,
  getFileLink: vi.fn(), updateNodeFileContent: vi.fn(),
}));
vi.mock('@/features/file-explorer/services/tree-locate', () => ({ refreshDirectoryInTree: vi.fn() }));
vi.mock('@/features/file-viewer/session', () => ({
  createViewerResourceKey: (input: unknown) => input,
  createViewerDraftKey: (resource: object, revision: unknown) => ({ ...resource, contentRevision: revision }),
  useViewerSession: () => ({ capture: mocks.capture, notifyRetentionChanged: mocks.notify }),
  ViewerDraftStoreError: class extends Error {},
  viewerDraftStore: { getWriteGeneration: () => 0, readLatest: mocks.draftRead, writeDraft: mocks.draftWrite, deleteDraft: mocks.draftDelete },
}));
vi.mock('./text-viewer-save', async importOriginal => ({
  ...await importOriginal<typeof import('./text-viewer-save')>(),
  saveTextWithRevision: mocks.save,
}));

import TextViewer from './index';
import { Modal } from '@douyinfe/semi-ui';
import CodeMirror from '@uiw/react-codemirror';

let renderer: TestRenderer.ReactTestRenderer | undefined;
const props = { accountScope: 'test', libraryId: 3, nodeId: 1, tabId: 'test-tab', url: 'old', fileName: 'old.txt', contentRevision: null };
function saveModal() {
  return renderer!.root.findAllByType(Modal).find(item => item.props.className === 'text-viewer-save-as-modal')!;
}
async function mount(loading = false, waitForContent = true, body?: string) {
  mocks.stage.mockResolvedValue({ filePath: '/tmp/synthetic-stage.txt' });
  mocks.upload.mockResolvedValue({ id: 3 });
  mocks.cleanup.mockResolvedValue(true);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), electronAPI: {
    fetchBinary: loading ? () => new Promise(() => undefined) : async (url: string) => ({ status: 200, base64: Buffer.from(body ?? `${url} body`).toString('base64'), truncated: false }),
    createStagedTextFile: mocks.stage, cleanupStagedTextFile: mocks.cleanup,
    saveDownloadFile: mocks.dialog,
  } });
  await act(async () => { renderer = TestRenderer.create(<TextViewer {...props} />); });
  if (!loading && waitForContent) await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe(body ?? 'old body'));
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.draftRead.mockReset();
  mocks.draftWrite.mockResolvedValue(undefined);
  mocks.draftDelete.mockResolvedValue(undefined);
  mocks.save.mockReset();
});

describe('Text viewer save actions', () => {
  it('keeps recovery local to its document and previews both versions without replacing the stored draft', async () => {
    mocks.draftRead.mockResolvedValueOnce({ key: { contentRevision: 'sha256:earlier' }, content: 'retained draft' });
    await mount();
    const preview = () => renderer!.root.findAllByType('button').find(item =>
      item.children.includes('查看草稿') || item.children.includes('查看最新文件'))!;
    act(() => preview().props.onClick());
    expect(renderer!.root.findByType(CodeMirror).props.value).toBe('retained draft');
    expect(renderer!.root.findByType(CodeMirror).props.readOnly).toBe(true);
    act(() => renderer!.update(<TextViewer {...props} active={false} />));
    expect(renderer!.root.findAllByProps({ 'aria-label': '草稿恢复' })).toHaveLength(0);
    expect(renderer!.root.findAllByType(Modal).filter(item => item.props.visible)).toHaveLength(0);
    expect(mocks.draftWrite).not.toHaveBeenCalled();
    expect(mocks.draftDelete).not.toHaveBeenCalled();
    act(() => renderer!.update(<TextViewer {...props} />));
    act(() => preview().props.onClick());
    expect(renderer!.root.findByType(CodeMirror).props.value).toBe('old body');
    await act(async () => {
      renderer!.root.findAllByType('button').find(item => item.children.includes('使用最新文件'))!.props.onClick();
    });
    expect(mocks.draftDelete).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByType(CodeMirror).props.readOnly).toBe(false);
  });

  it('does not delete a persisted draft while its initial read is still pending', async () => {
    let finishRead!: (value: unknown) => void;
    mocks.draftRead.mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
    await mount(false, false);
    await vi.waitFor(() => expect(mocks.draftRead).toHaveBeenCalledOnce());
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(mocks.draftDelete).not.toHaveBeenCalled();
    await act(async () => { finishRead({ key: { contentRevision: 'old' }, content: 'keep me' }); });
    expect(mocks.draftDelete).not.toHaveBeenCalled();
  });

  it('clears dirty and removes an older stored draft when Undo returns to the saved body', async () => {
    await mount();
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('edited'));
    await act(async () => renderer!.update(<TextViewer {...props} active={false} />));
    expect(mocks.draftWrite).toHaveBeenLastCalledWith(expect.anything(), 'edited', expect.anything());
    act(() => renderer!.update(<TextViewer {...props} />));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('old body'));
    expect(renderer!.root.findByProps({ 'aria-label': '保存' }).props.disabled).toBe(true);
    await act(async () => renderer!.update(<TextViewer {...props} active={false} />));
    expect(mocks.draftDelete).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 1 }));
    expect(mocks.draftWrite).toHaveBeenCalledTimes(1);
  });

  it.each(['\r\n', '\r'])('clears dirty after CodeMirror Undo normalizes %j line breaks', async (lineBreak) => {
    const original = `first${lineBreak}second`;
    const editorBody = EditorState.create({ doc: original }).doc.toString();
    await mount(false, true, original);
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('edited\nsecond'));
    await act(async () => renderer!.update(<TextViewer {...props} active={false} />));
    act(() => renderer!.update(<TextViewer {...props} />));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange(editorBody));
    const save = renderer!.root.findByProps({ 'aria-label': '保存' });
    expect(save.props.disabled).toBe(true);
    await act(async () => { await save.props.onClick(); });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => renderer!.update(<TextViewer {...props} active={false} />));
    expect(mocks.draftDelete).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 1 }));
    expect(mocks.draftWrite).toHaveBeenCalledTimes(1);
  });

  it.each(['\r\n', '\r'])('cleans a normalization-only draft without rewriting the original %j body', async (lineBreak) => {
    const original = `first${lineBreak}second`;
    mocks.draftRead.mockResolvedValueOnce({ key: { contentRevision: 'old' }, content: 'first\nsecond' });
    await mount(false, true, original);
    expect(renderer!.root.findAllByProps({ 'aria-label': '草稿恢复' })).toHaveLength(0);
    expect(mocks.draftDelete).toHaveBeenCalledOnce();
    await act(async () => { await renderer!.root.findByProps({ 'aria-label': '保存' }).props.onClick(); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(renderer!.root.findByType(CodeMirror).props.value).toBe(original);
  });

  it('finishes Undo cleanup before an immediate external reload reads persisted drafts', async () => {
    let stored: { key: unknown; content: string } | undefined;
    mocks.draftRead.mockImplementation(async () => stored);
    mocks.draftWrite.mockImplementation(async (key: unknown, content: string) => { stored = { key, content }; });
    mocks.draftDelete.mockImplementation(async () => { stored = undefined; });
    await mount();
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('older stored edit'));
    await act(async () => renderer!.update(<TextViewer {...props} active={false} />));
    act(() => renderer!.update(<TextViewer {...props} />));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('old body'));
    await act(async () => renderer!.update(<TextViewer {...props} url="updated" reloadToken={1} />));
    await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('updated body'));
    expect(renderer!.root.findAllByProps({ 'aria-label': '草稿恢复' })).toHaveLength(0);
    expect(stored).toBeUndefined();
  });

  it('flushes the latest input when it changes during an asynchronous draft write', async () => {
    await mount();
    let finishWrite!: () => void;
    mocks.draftWrite.mockReturnValueOnce(new Promise<void>(resolve => { finishWrite = resolve; }));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('first edit'));
    act(() => renderer!.update(<TextViewer {...props} active={false} />));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('later edit'));
    await act(async () => { finishWrite(); });
    expect(mocks.draftWrite).toHaveBeenLastCalledWith(expect.anything(), 'later edit', expect.anything());
  });

  it('flushes an outgoing buffer under its original resource identity', async () => {
    await mount();
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('node one draft'));
    await act(async () => renderer!.update(<TextViewer {...props} nodeId={2} url="new" />));
    expect(mocks.draftWrite).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 1 }), 'node one draft', expect.anything());
    await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('new body'));
  });

  it.each([
    ['later edit', true],
    ['old body', true],
    ['saved snapshot', false],
  ])('keeps the current buffer %s after the saved baseline changes', async (currentBody, dirty) => {
    await mount();
    let finishSave!: (value: unknown) => void;
    mocks.save.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('saved snapshot'));
    act(() => { void renderer!.root.findByProps({ 'aria-label': '保存' }).props.onClick(); });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('intermediate typing'));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange(currentBody));
    await act(async () => { finishSave({ detail: { parentId: 20, libraryId: 3 }, savedNode: { id: 1 } }); });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'saved snapshot' }));
    expect(renderer!.root.findByType(CodeMirror).props.value).toBe(currentBody);
    expect(renderer!.root.findByProps({ 'aria-label': '保存' }).props.disabled).toBe(!dirty);
    if (dirty) expect(mocks.draftWrite).toHaveBeenLastCalledWith(expect.anything(), currentBody, expect.anything());
  });

  it('keeps a restored CRLF draft clean when Undo returns to its submitted body during save', async () => {
    mocks.draftRead.mockResolvedValueOnce({ key: { contentRevision: 'old' }, content: 'draft\r\nbody' });
    await mount(false, true, 'old\r\nbody');
    act(() => renderer!.root.findAllByType('button').find(item => item.children.includes('恢复草稿'))!.props.onClick());
    let finishSave!: (value: unknown) => void;
    mocks.save.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
    act(() => { void renderer!.root.findByProps({ 'aria-label': '保存' }).props.onClick(); });
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('later\nbody'));
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('draft\nbody'));
    await act(async () => { finishSave({ detail: { parentId: 20, libraryId: 3 }, savedNode: { id: 1 } }); });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ content: 'draft\r\nbody' }));
    expect(renderer!.root.findByProps({ 'aria-label': '保存' }).props.disabled).toBe(true);
    expect(mocks.draftWrite).not.toHaveBeenCalled();
  });

  it('persists an unsaved buffer before external reload and shows a conflict without losing the draft', async () => {
    await mount();
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('my unsaved draft'));
    mocks.draftRead.mockResolvedValueOnce({ key: { contentRevision: 'sha256:old' }, content: 'my unsaved draft' });
    await act(async () => { renderer!.update(<TextViewer {...props} url="updated" reloadToken={1} />); });
    expect(mocks.draftWrite).toHaveBeenCalledWith(expect.anything(), 'my unsaved draft', expect.anything());
    await vi.waitFor(() => expect(renderer!.root.findByProps({ 'aria-label': '草稿恢复' })).toBeTruthy());
    expect(renderer!.root.findAllByType(Modal)).toHaveLength(1);
    expect(renderer!.root.findByType(CodeMirror).props.readOnly).toBe(true);
    expect(renderer!.root.findByProps({ 'aria-label': '下载' }).props.disabled).toBe(false);
    const restore = renderer!.root.findAllByType('button').find(item => item.children.includes('恢复草稿'))!;
    act(() => restore.props.onClick());
    expect(renderer!.root.findByType(CodeMirror).props.value).toBe('my unsaved draft');
    expect(renderer!.root.findByType(CodeMirror).props.readOnly).toBe(false);
  });
  it('loads external updates directly when the buffer has no local edits', async () => {
    await mount();
    await act(async () => { renderer!.update(<TextViewer {...props} url="updated" reloadToken={1} />); });
    await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('updated body'));
    expect(mocks.draftWrite).not.toHaveBeenCalled();
  });
  it('keeps the current buffer accessible when draft persistence fails during refresh', async () => {
    await mount();
    act(() => renderer!.root.findByType(CodeMirror).props.onChange('only in memory'));
    mocks.draftWrite.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { renderer!.update(<TextViewer {...props} url="updated" reloadToken={1} />); });
    await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('only in memory'));
    expect(renderer!.root.findByProps({ 'aria-label': '下载' }).props.disabled).toBe(false);
  });
  it('blocks save-as and download before document content is available', async () => {
    await mount(true);
    for (const label of ['另存为', '下载']) {
      const button = renderer!.root.findByProps({ 'aria-label': label });
      expect(button.props.disabled).toBe(true);
      act(() => button.props.onClick());
    }
    expect(saveModal().props.visible).toBe(false);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('takes a content snapshot before metadata awaits and rejects same-tick double submission', async () => {
    let resolve!: (value: unknown) => void;
    mocks.detail.mockReturnValue(new Promise(done => { resolve = done; }));
    await mount();
    act(() => renderer!.root.findByProps({ 'aria-label': '另存为' }).props.onClick());
    const submit = saveModal().props.onOk;
    act(() => { submit(); submit(); });
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    await act(async () => { renderer!.update(<TextViewer {...props} nodeId={2} url="new" fileName="new.txt" />); });
    await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('new body'));
    await act(async () => { resolve({ parentId: 20, libraryId: 3 }); });
    expect(mocks.stage).toHaveBeenCalledWith('old.txt', 'old body');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
  it('closes the local modal when its viewer becomes inactive', async () => {
    await mount();
    act(() => renderer!.root.findByProps({ 'aria-label': '另存为' }).props.onClick());
    expect(saveModal().props.visible).toBe(true);
    act(() => renderer!.update(<TextViewer {...props} active={false} />));
    expect(saveModal().props.visible).toBe(false);
  });
});

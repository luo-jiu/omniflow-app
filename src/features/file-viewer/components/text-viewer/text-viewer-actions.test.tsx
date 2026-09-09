import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), upload: vi.fn(), stage: vi.fn(), cleanup: vi.fn(), capture: vi.fn(), notify: vi.fn(),
  dialog: vi.fn(),
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
  createViewerDraftKey: (resource: unknown, revision: unknown) => ({ resource, revision }),
  useViewerSession: () => ({ capture: mocks.capture, notifyRetentionChanged: mocks.notify }),
  ViewerDraftStoreError: class extends Error {},
  viewerDraftStore: { getWriteGeneration: () => 0, readLatest: async () => null, deleteDraft: async () => undefined },
}));

import TextViewer from './index';
import { Modal } from '@douyinfe/semi-ui';
import CodeMirror from '@uiw/react-codemirror';

let renderer: TestRenderer.ReactTestRenderer | undefined;
const props = { accountScope: 'test', libraryId: 3, nodeId: 1, tabId: 'test-tab', url: 'old', fileName: 'old.txt', contentRevision: null };
function saveModal() {
  return renderer!.root.findAllByType(Modal).find(item => item.props.className === 'text-viewer-save-as-modal')!;
}
async function mount(loading = false) {
  mocks.stage.mockResolvedValue({ filePath: '/tmp/synthetic-stage.txt' });
  mocks.upload.mockResolvedValue({ id: 3 });
  mocks.cleanup.mockResolvedValue(true);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), electronAPI: {
    fetch: loading ? () => new Promise(() => undefined) : async (url: string) => ({ status: 200, body: `${url} body` }),
    createStagedTextFile: mocks.stage, cleanupStagedTextFile: mocks.cleanup,
    saveDownloadFile: mocks.dialog,
  } });
  await act(async () => { renderer = TestRenderer.create(<TextViewer {...props} />); });
  if (!loading) await vi.waitFor(() => expect(renderer!.root.findByType(CodeMirror).props.value).toBe('old body'));
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Text viewer save actions', () => {
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

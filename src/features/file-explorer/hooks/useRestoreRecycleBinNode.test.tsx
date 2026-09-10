import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: 'user:7', restore: vi.fn(), detail: vi.fn(), root: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerAccountScope: () => mocks.account }));
vi.mock('@douyinfe/semi-ui', () => ({ Toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
vi.mock('../services/file.api', () => ({ restoreNodeAndChildren: mocks.restore, fetchNodeDetailById: mocks.detail, getLibraryRootNodeId: mocks.root }));
import { useRestoreRecycleBinNode } from './useRestoreRecycleBinNode';
import { subscribeLibraryNodesMutated } from '../services/node-mutation-events';
import type { RecycleBinItem } from '../services/file.api';

let renderer: TestRenderer.ReactTestRenderer;
let restore: ReturnType<typeof useRestoreRecycleBinNode>;
const onRestored = vi.fn();
const item: RecycleBinItem = { id: 9, parentId: 20, libraryId: 3, type: 'file', name: 'old', deletedAt: '' };
function Probe({ libraryId = 3 }: { libraryId?: number }) { restore = useRestoreRecycleBinNode(libraryId, onRestored); return null; }
afterEach(() => { act(() => renderer?.unmount()); vi.resetAllMocks(); mocks.account = 'user:7'; });

describe('recycle restore UI synchronization', () => {
  it('refreshes the actual restored parent instead of the deleted parent', async () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeLibraryNodesMutated(event => { events.push(event); });
    mocks.restore.mockResolvedValue(true);
    mocks.detail.mockResolvedValue({ ...item, parentId: 100 });
    act(() => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { await restore(item); });
    expect(onRestored).toHaveBeenCalledWith(9);
    expect(events[events.length - 1]).toMatchObject({ affectedParentIds: [100], nodeId: 9, accountScope: 'user:7', libraryId: 3 });
    unsubscribe();
  });
  it('keeps committed success when all refresh reads fail', async () => {
    mocks.restore.mockResolvedValue(true);
    mocks.detail.mockRejectedValue(new Error('offline'));
    mocks.root.mockRejectedValue(new Error('offline'));
    act(() => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { await restore(item); });
    expect(onRestored).toHaveBeenCalledWith(9);
    expect(mocks.success).toHaveBeenCalledWith('已恢复');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
  });
  it('rejects false restore receipts without removing the item', async () => {
    mocks.restore.mockResolvedValue(false);
    act(() => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { await restore(item); });
    expect(onRestored).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });
  it('does not write delayed restore results into another account or library', async () => {
    let finish!: (result: boolean) => void;
    mocks.restore.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    act(() => { renderer = TestRenderer.create(<Probe />); });
    let pending!: Promise<void>;
    act(() => { pending = restore(item); });
    mocks.account = 'user:8';
    act(() => renderer.update(<Probe libraryId={4} />));
    await act(async () => { finish(true); await pending; });
    expect(onRestored).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});

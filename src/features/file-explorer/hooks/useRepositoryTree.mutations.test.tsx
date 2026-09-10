import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ children: vi.fn(), account: 'user:7' }));
vi.mock('../services/file.api', () => ({ getChildrenByNodeId: mocks.children, getLibraryRootNodeId: async () => 100 }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerAccountScope: () => mocks.account }));
vi.mock('@/features/workspace-resource-release', () => ({ isDisposingLibraryWorkspace: () => false }));
vi.mock('../utils/file-node-icon', () => ({ getDirectoryBuiltInIcon: () => null, getFileNodeIconByParentBuiltInType: () => null }));
import { useRepositoryTree } from './useRepositoryTree';
import { clearAllRepositoryTreeSnapshots, saveRepositoryTreeSnapshot } from './use-repository-tree/snapshot-store';
import { notifyLibraryNodesMutated } from '../services/node-mutation-events';
import { API_CONFIG } from '@/config/api';

let renderer: TestRenderer.ReactTestRenderer;
let tree: ReturnType<typeof useRepositoryTree>;
function Probe() { tree = useRepositoryTree(3); return null; }
const event = { accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL, libraryId: 3, affectedParentIds: [100] };
beforeEach(() => { vi.stubGlobal('localStorage', { getItem: () => null }); });
afterEach(() => { act(() => renderer?.unmount()); clearAllRepositoryTreeSnapshots(); vi.resetAllMocks(); vi.unstubAllGlobals(); mocks.account = 'user:7'; });

it('refreshes real parents immediately and ignores events for other owners', async () => {
  mocks.children.mockResolvedValue([]);
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  mocks.children.mockClear();
  await act(async () => {
    notifyLibraryNodesMutated({ ...event, accountScope: 'user:8' });
    notifyLibraryNodesMutated({ ...event, backendScope: 'https://other.invalid' });
    notifyLibraryNodesMutated({ ...event, libraryId: 4 });
  });
  expect(mocks.children).not.toHaveBeenCalled();
  mocks.children.mockResolvedValue([{ id: 9, parentId: 100, libraryId: 3, name: 'created', type: 'file', ext: 'txt' }]);
  await act(async () => { notifyLibraryNodesMutated({ ...event, affectedParentIds: [100, 100] }); });
  expect(mocks.children).toHaveBeenCalledTimes(1);
  expect(mocks.children).toHaveBeenCalledWith(100, 3);
  expect(tree.currentTreeData[0]).toMatchObject({ id: 9, name: 'created' });
});

it('invalidates a cached inactive library when it next mounts', async () => {
  saveRepositoryTreeSnapshot(3, { selectedRepository: '3', rootNodeId: 100, expandedKeys: [], treesCache: { '3': [] } });
  notifyLibraryNodesMutated(event);
  mocks.children.mockResolvedValue([{ id: 9, parentId: 100, libraryId: 3, name: 'restored', type: 'file', ext: 'txt' }]);
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  expect(tree.currentTreeData[0]).toMatchObject({ id: 9, name: 'restored' });
});

it('does not apply a pending refresh after account changes', async () => {
  mocks.children.mockResolvedValue([]);
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  let finish!: (value: unknown[]) => void;
  mocks.children.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  act(() => notifyLibraryNodesMutated(event));
  mocks.account = 'user:8';
  act(() => renderer.update(<Probe />));
  await act(async () => { finish([{ id: 9, parentId: 100, libraryId: 3, name: 'stale', type: 'file' }]); });
  expect(tree.currentTreeData).toEqual([]);
});

it('does not let an older parent response overwrite a later mutation refresh', async () => {
  mocks.children.mockResolvedValue([]);
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  let finish!: (value: unknown[]) => void;
  mocks.children.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce([{ id: 9, parentId: 100, libraryId: 3, name: 'latest', type: 'file' }]);
  act(() => notifyLibraryNodesMutated(event));
  await act(async () => { notifyLibraryNodesMutated(event); });
  await act(async () => { finish([{ id: 9, parentId: 100, libraryId: 3, name: 'stale', type: 'file' }]); });
  expect(tree.currentTreeData[0].name).toBe('latest');
});

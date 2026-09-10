import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ link: vi.fn() }));
vi.mock('@/features/file-explorer/services/file.api', () => ({ getFileLink: mocks.link }));
vi.mock('@/features/file-viewer/services/global-audio-player', () => ({ globalAudioPlayer: { releaseForTab: vi.fn() } }));
vi.mock('@/features/file-viewer/services/floating-video.service', () => ({ floatingVideoService: { releaseForTab: vi.fn() } }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerAccountScope: () => 'user:7', disposeViewerSessionOnClose: vi.fn() }));
vi.mock('@/features/workspace-resource-release', () => ({ isDisposingLibraryWorkspace: () => false }));
import { FileViewerProvider } from './FileViewerContext';
import { FileViewerContext } from './file-viewer.context';
import { notifyLibraryFileContentChanged } from '@/features/file-viewer/services/file-content-events';
import { notifyLibraryFilesDeleted } from '@/features/file-viewer/services/file-deletion-events';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import { API_CONFIG } from '@/config/api';

let renderer: TestRenderer.ReactTestRenderer | undefined;
let viewer: NonNullable<React.ContextType<typeof FileViewerContext>>;
function Probe() { viewer = React.useContext(FileViewerContext)!; return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.resetAllMocks(); });

describe('file viewer external content changes', () => {
  it('closes deleted tabs through the media release path only in their owner and library scope', async () => {
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={3}><Probe /></FileViewerProvider>); });
    act(() => viewer.setFileUrl('audio', 'first.mp3', 'audio', 9));
    act(() => viewer.setFileUrl('video', 'second.mp4', 'video', 10));
    act(() => viewer.setFileUrl('text', 'keep.txt', 'text', 11));
    const event = { nodeIds: [9, 10], libraryId: 3, accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL };
    act(() => notifyLibraryFilesDeleted({ ...event, libraryId: 4 }));
    act(() => notifyLibraryFilesDeleted({ ...event, accountScope: 'user:8' }));
    expect(viewer.tabs).toHaveLength(3);
    act(() => notifyLibraryFilesDeleted(event));
    expect(viewer.tabs.map(tab => tab.nodeId)).toEqual([11]);
    expect(globalAudioPlayer.releaseForTab).toHaveBeenCalledWith('node:9');
    expect(floatingVideoService.releaseForTab).toHaveBeenCalledWith('node:10');
  });
  it('updates only the matching existing tab without activating it or crossing account boundaries', async () => {
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={3}><Probe /></FileViewerProvider>); });
    act(() => viewer.setFileUrl('old', 'first.txt', 'text', 9));
    act(() => viewer.setFileUrl('other', 'other.txt', 'text', 10));
    const active = viewer.activeTabId;
    mocks.link.mockResolvedValue('fresh');
    const event = { nodeId: 9, libraryId: 3, accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL };
    await act(async () => { notifyLibraryFileContentChanged({ ...event, accountScope: 'user:8' }); });
    expect(mocks.link).not.toHaveBeenCalled();
    await act(async () => { notifyLibraryFileContentChanged(event); });
    expect(viewer.activeTabId).toBe(active);
    expect(viewer.tabs.find(tab => tab.nodeId === 9)).toMatchObject({ fileUrl: 'fresh', reloadToken: 1, contentRevision: null });
    expect(viewer.tabs.find(tab => tab.nodeId === 10)?.fileUrl).toBe('other');
  });
  it('ignores stale link responses and never recreates a closed tab', async () => {
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={3}><Probe /></FileViewerProvider>); });
    act(() => viewer.setFileUrl('old', 'first.txt', 'text', 9));
    let finish!: (url: string) => void;
    mocks.link.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce('latest');
    const event = { nodeId: 9, libraryId: 3, accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL };
    act(() => notifyLibraryFileContentChanged(event));
    await act(async () => { notifyLibraryFileContentChanged(event); });
    await act(async () => { finish('stale'); });
    expect(viewer.tabs[0].fileUrl).toBe('latest');
    mocks.link.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => notifyLibraryFileContentChanged(event));
    act(() => viewer.closeTab(viewer.tabs[0].id));
    await act(async () => { finish('after-close'); });
    expect(viewer.tabs).toHaveLength(0);
  });
});

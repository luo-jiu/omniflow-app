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
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';

let renderer: TestRenderer.ReactTestRenderer | undefined;
let viewer: NonNullable<React.ContextType<typeof FileViewerContext>>;
function Probe() { viewer = React.useContext(FileViewerContext)!; return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.resetAllMocks(); });

describe('file viewer external content changes', () => {
  it('closes stale configured directory viewers and refreshes only affected archive tabs in scope', async () => {
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={3}><Probe /></FileViewerProvider>); });
    act(() => viewer.setFileUrl('audio-archive://library/3/node/8', 'songs', 'audio_archive', 8));
    act(() => viewer.setFileUrl('audio-folder://library/3/node/9', 'song', 'audio_archive', 9));
    act(() => viewer.setFileUrl('comic-archive://library/3/node/10', 'other', 'comic_archive', 10));
    const active = viewer.activeTabId;
    const event = {
      accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL, libraryId: 3,
      affectedParentIds: [8, 9], nodeId: 9, configChanged: true,
      builtInType: 'DEF' as const, archiveMode: 0 as const,
    };
    act(() => notifyLibraryNodesMutated({ ...event, accountScope: 'user:8' }));
    act(() => notifyLibraryNodesMutated({ ...event, backendScope: 'https://other.invalid' }));
    act(() => notifyLibraryNodesMutated({ ...event, libraryId: 4 }));
    expect(viewer.tabs).toHaveLength(3);
    expect(globalAudioPlayer.releaseForTab).not.toHaveBeenCalled();
    act(() => notifyLibraryNodesMutated(event));
    expect(viewer.tabs.map(tab => tab.nodeId)).toEqual([8, 10]);
    expect(viewer.tabs[0].reloadToken).toBe(1);
    expect(viewer.tabs[1].reloadToken).toBe(0);
    expect(viewer.activeTabId).toBe(active);
    expect(globalAudioPlayer.releaseForTab).toHaveBeenCalledWith('node:9');
    expect(floatingVideoService.releaseForTab).toHaveBeenCalledWith('node:9');
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it('renames matching tabs without reloading content, activating tabs or releasing media owners', async () => {
    await act(async () => { renderer = TestRenderer.create(<FileViewerProvider libraryId={3}><Probe /></FileViewerProvider>); });
    act(() => viewer.setFileUrl('audio-bytes', 'old.mp3', 'audio', 9));
    act(() => viewer.setFileUrl('other', 'other.txt', 'text', 10));
    const before = viewer.tabs[0];
    const active = viewer.activeTabId;
    const event = { accountScope: 'user:7', backendScope: API_CONFIG.BASE_URL, libraryId: 3, affectedParentIds: [1], nodeId: 9, name: 'renamed', ext: 'mp3', type: 'file' as const };
    act(() => notifyLibraryNodesMutated({ ...event, backendScope: 'https://other.invalid/api' }));
    act(() => notifyLibraryNodesMutated({ ...event, accountScope: 'user:8' }));
    act(() => notifyLibraryNodesMutated({ ...event, libraryId: 4 }));
    expect(viewer.tabs[0]).toEqual(before);
    act(() => notifyLibraryNodesMutated(event));
    expect(viewer.tabs[0]).toEqual({ ...before, fileName: 'renamed.mp3' });
    expect(viewer.activeTabId).toBe(active);
    expect(mocks.link).not.toHaveBeenCalled();
    expect(globalAudioPlayer.releaseForTab).not.toHaveBeenCalled();
    expect(floatingVideoService.releaseForTab).not.toHaveBeenCalled();
    act(() => notifyLibraryNodesMutated({ ...event, nodeId: 10, name: 'current', ext: 'md' }));
    expect(viewer.fileState.fileName).toBe('current.md');
  });
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

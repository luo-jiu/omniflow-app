import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/features/file-explorer/services/file.api', () => ({ getFileLink: vi.fn() }));
vi.mock('@/features/file-viewer/services/global-audio-player', () => ({ globalAudioPlayer: { releaseForTab: vi.fn() } }));
vi.mock('@/features/file-viewer/services/floating-video.service', () => ({ floatingVideoService: { releaseForTab: vi.fn() } }));
vi.mock('@/features/file-viewer/session', () => ({ useViewerAccountScope: () => 'user:7', disposeViewerSessionOnClose: vi.fn() }));
vi.mock('@/features/workspace-resource-release', () => ({ isDisposingLibraryWorkspace: () => false }));
import { FileViewerProvider } from './FileViewerContext';
import { FileViewerContext, type FileViewerTab } from './file-viewer.context';
import { clearAllFileViewerStateCache } from './file-viewer-cache';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import { useVideoDockMeteor } from '@/features/file-viewer/components/video-viewer/use-video-dock-meteor';

let renderer: TestRenderer.ReactTestRenderer | undefined;
let viewer: NonNullable<React.ContextType<typeof FileViewerContext>>;
const docks = new Map<string, ReturnType<typeof useVideoDockMeteor>>();
function Dock({ tab, enabled }: { tab: FileViewerTab; enabled: boolean }) {
  const owner = React.useContext(FileViewerContext)!;
  const dock = useVideoDockMeteor({
    transition: tab.videoTransition, tabId: tab.id, url: tab.fileUrl,
    enabled, consumeTransition: owner.consumeVideoTransition,
  });
  docks.set(tab.id, dock);
  return null;
}
function Probe({ mountDock = true, enabled = true }: { mountDock?: boolean; enabled?: boolean }) {
  viewer = React.useContext(FileViewerContext)!;
  return mountDock ? <>{viewer.tabs.map(tab => <Dock key={tab.id} tab={tab} enabled={enabled} />)}</> : null;
}
function render(mountDock = true, enabled = true, cacheKey?: string) {
  const element = <FileViewerProvider libraryId={3} cacheKey={cacheKey}><Probe mountDock={mountDock} enabled={enabled} /></FileViewerProvider>;
  act(() => { if (renderer) renderer.update(element); else renderer = TestRenderer.create(element); });
}
function openNext(nodeId: number, ratio = 0.75) {
  act(() => viewer.setFileUrl(`https://storage.test/${nodeId}`, `${nodeId}.mp4`, 'video', nodeId, {
    replaceTabId: viewer.activeTabId, videoAutoPlay: true, videoTransitionRatio: ratio,
  }));
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  docks.clear();
  clearAllFileViewerStateCache();
  vi.clearAllMocks();
});

describe('playlist visual transition across viewer remounts', () => {
  it('passes the old progress to the new owner once and preserves media release on replacement', () => {
    render();
    openNext(9);
    const previousDock = docks.get('node:9');
    openNext(10, 0.75);
    expect(viewer.tabs.map(tab => tab.id)).toEqual(['node:10']);
    expect(docks.get('node:10')).not.toBe(previousDock);
    expect(floatingVideoService.releaseForTab).toHaveBeenCalledWith('node:9');
    expect(viewer.tabs[0].videoTransition).toBeUndefined();
    expect(docks.get('node:10')?.meteor).toBeNull();

    act(() => docks.get('node:10')!.start()); // The new video reports loadedmetadata.
    const meteor = docks.get('node:10')!.meteor;
    expect(meteor).toMatchObject({ src: 'https://storage.test/10', ratio: 0.75 });
    act(() => docks.get('node:10')!.start());
    expect(docks.get('node:10')!.meteor).toBe(meteor);
    act(() => docks.get('node:10')!.finish(meteor!.id));
    render(false);
    render(true); // Returning to a remounted tab cannot replay a consumed transition.
    act(() => docks.get('node:10')!.start());
    expect(docks.get('node:10')!.meteor).toBeNull();
  });

  it('discards a pending transition when the viewer becomes hidden or detached', () => {
    render();
    openNext(9);
    openNext(10);
    render(true, false);
    render(true, true);
    act(() => docks.get('node:10')!.start());
    expect(docks.get('node:10')!.meteor).toBeNull();
  });

  it('does not animate initial opens, invalid ratios or an unrelated URL refresh', () => {
    render();
    openNext(9);
    act(() => docks.get('node:9')!.start());
    expect(docks.get('node:9')!.meteor).toBeNull();
    openNext(10, NaN);
    act(() => docks.get('node:10')!.start());
    expect(docks.get('node:10')!.meteor).toBeNull();
    openNext(11);
    act(() => viewer.setFileUrl('https://storage.test/refreshed', '11.mp4', 'video', 11));
    act(() => docks.get('node:11')!.start());
    expect(docks.get('node:11')!.meteor).toBeNull();
  });

  it('checks the transition identity before consuming a new hint', () => {
    render(false);
    openNext(9);
    openNext(10, 2);
    const first = viewer.tabs[0].videoTransition!;
    expect(first.ratio).toBe(1);
    openNext(11);
    const current = viewer.tabs[0].videoTransition!;
    act(() => viewer.consumeVideoTransition('node:11', first.id));
    expect(viewer.tabs[0].videoTransition).toEqual(current);
    act(() => viewer.consumeVideoTransition('node:11', current.id));
    expect(viewer.tabs[0].videoTransition).toBeUndefined();
  });

  it('does not restore unconsumed animation hints from the workspace cache', () => {
    render(false, true, 'video-transition-test');
    openNext(9);
    openNext(10);
    expect(viewer.tabs[0].videoTransition).toBeDefined();
    act(() => renderer?.unmount());
    renderer = undefined;
    render(true, true, 'video-transition-test');
    expect(viewer.tabs[0].videoTransition).toBeUndefined();
    act(() => docks.get('node:10')!.start());
    expect(docks.get('node:10')!.meteor).toBeNull();
  });
});

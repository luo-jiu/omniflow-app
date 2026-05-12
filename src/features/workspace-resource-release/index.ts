import {
  clearAllFileViewerStateCache,
  clearFileViewerStateCache,
} from '@/contexts/file-viewer-cache';
import {
  clearPendingActivation,
  clearPendingActivationForLibrary,
} from '@/contexts/file-viewer-pending-activation';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import {
  clearAllRepositoryTreeSnapshots,
  clearRepositoryTreeSnapshot,
} from '@/features/file-explorer/hooks/use-repository-tree/snapshot-store';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  clearAllLibraryDetailWorkspaceStates,
  clearLibraryDetailWorkspaceState,
  loadLibraryDetailWorkspaceState,
} from '@/features/library-workspace/workspace-state';

export interface DisposeLibraryWorkspaceResult {
  closedBrowserTabCount: number;
  failedBrowserTabIds: string[];
}

const disposingLibraries = new Map<number, number>();
let sessionDisposeCount = 0;

function normalizeLibraryId(libraryId: number): number | null {
  const normalized = Number(libraryId);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null;
  }
  return Math.trunc(normalized);
}

function workspaceCacheKey(libraryId: number) {
  return `library:${libraryId}`;
}

function hasWindow() {
  return typeof window !== 'undefined';
}

function deferAfterCurrentCleanup(callback: () => void) {
  if (!hasWindow()) {
    callback();
    return;
  }
  window.setTimeout(callback, 0);
}

function beginLibraryDisposing(libraryId: number) {
  disposingLibraries.set(libraryId, (disposingLibraries.get(libraryId) ?? 0) + 1);
  return () => {
    deferAfterCurrentCleanup(() => {
      const nextCount = (disposingLibraries.get(libraryId) ?? 0) - 1;
      if (nextCount > 0) {
        disposingLibraries.set(libraryId, nextCount);
        return;
      }
      disposingLibraries.delete(libraryId);
    });
  };
}

function beginSessionDisposing() {
  sessionDisposeCount += 1;
  return () => {
    deferAfterCurrentCleanup(() => {
      sessionDisposeCount = Math.max(0, sessionDisposeCount - 1);
    });
  };
}

export function isDisposingSessionWorkspaces() {
  return sessionDisposeCount > 0;
}

export function isDisposingLibraryWorkspace(libraryId: number | null | undefined) {
  if (isDisposingSessionWorkspaces()) {
    return true;
  }
  if (libraryId == null) {
    return false;
  }
  const normalized = normalizeLibraryId(libraryId);
  if (normalized == null) {
    return false;
  }
  return (disposingLibraries.get(normalized) ?? 0) > 0;
}

async function closeEmbeddedBrowserTabs(tabIds: string[]): Promise<DisposeLibraryWorkspaceResult> {
  if (!hasWindow() || !window.electronEmbeddedBrowser) {
    return {
      closedBrowserTabCount: 0,
      failedBrowserTabIds: [],
    };
  }
  const uniqueTabIds = Array.from(new Set(tabIds.map((tabId) => String(tabId || '').trim()).filter(Boolean)));
  const settled = await Promise.allSettled(
    uniqueTabIds.map((tabId) => window.electronEmbeddedBrowser.closeTab(tabId)),
  );
  const failedBrowserTabIds = settled
    .map((result, index) => ({ result, tabId: uniqueTabIds[index] }))
    .filter((item): item is { result: PromiseRejectedResult; tabId: string } => item.result.status === 'rejected')
    .map((item) => {
      runtimeLogger.warn('close embedded browser tab during workspace release failed', {
        error: item.result.reason,
        tabId: item.tabId,
      });
      return item.tabId;
    });
  await window.electronEmbeddedBrowser.deactivate().catch((error: unknown) => {
    runtimeLogger.warn('deactivate embedded browser after workspace release failed', error);
  });
  return {
    closedBrowserTabCount: uniqueTabIds.length - failedBrowserTabIds.length,
    failedBrowserTabIds,
  };
}

export async function disposeLibraryWorkspace(libraryId: number): Promise<DisposeLibraryWorkspaceResult> {
  const normalizedLibraryId = normalizeLibraryId(libraryId);
  if (normalizedLibraryId == null) {
    return {
      closedBrowserTabCount: 0,
      failedBrowserTabIds: [],
    };
  }
  const endLibraryDisposing = beginLibraryDisposing(normalizedLibraryId);

  try {
    const cacheKey = workspaceCacheKey(normalizedLibraryId);
    const workspaceState = loadLibraryDetailWorkspaceState(cacheKey);
    const browserTabIds = workspaceState.browserTabs.map((tab) => tab.id);
    const result = await closeEmbeddedBrowserTabs(browserTabIds);

    globalAudioPlayer.releaseForLibrary(normalizedLibraryId);
    floatingVideoService.releaseForLibrary(normalizedLibraryId);
    clearPendingActivationForLibrary(normalizedLibraryId);
    clearRepositoryTreeSnapshot(normalizedLibraryId);
    clearLibraryDetailWorkspaceState(cacheKey);
    clearFileViewerStateCache(cacheKey);
    return result;
  } finally {
    endLibraryDisposing();
  }
}

export async function disposeSessionWorkspaces() {
  const endSessionDisposing = beginSessionDisposing();
  try {
    if (hasWindow() && window.electronEmbeddedBrowser) {
      await window.electronEmbeddedBrowser.closeAll().catch((error: unknown) => {
        runtimeLogger.warn('close all embedded browser tabs during session release failed', error);
      });
    }
    globalAudioPlayer.clear();
    floatingVideoService.dismiss();
    clearPendingActivation();
    clearAllRepositoryTreeSnapshots();
    clearAllLibraryDetailWorkspaceStates();
    clearAllFileViewerStateCache();
  } finally {
    endSessionDisposing();
  }
}

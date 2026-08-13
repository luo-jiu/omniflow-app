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
import {
  viewerSessionColdRuntime,
  viewerSessionRuntime,
} from '@/features/file-viewer/session';
import {
  clearAllToolWorkspaceStates,
  clearToolWorkspaceState,
} from '@/features/tool-workspace/tool-workspace.state';
import {
  beginLibraryDisposing,
  beginSessionDisposing,
  normalizeLibraryId,
} from './dispose-markers';

export {
  isDisposingAnyWorkspace,
  isDisposingLibraryWorkspace,
  isDisposingSessionWorkspaces,
} from './dispose-markers';

export interface DisposeLibraryWorkspaceResult {
  closedBrowserTabCount: number;
  failedBrowserTabIds: string[];
  viewerSessionCleanupFailed: boolean;
}

interface DisposeLibraryWorkspaceOptions {
  accountScope?: string | null;
}

function workspaceCacheKey(libraryId: number) {
  return `library:${libraryId}`;
}

function hasWindow() {
  return typeof window !== 'undefined';
}

async function closeEmbeddedBrowserTabs(tabIds: string[]): Promise<DisposeLibraryWorkspaceResult> {
  if (!hasWindow() || !window.electronEmbeddedBrowser) {
    return {
      closedBrowserTabCount: 0,
      failedBrowserTabIds: [],
      viewerSessionCleanupFailed: false,
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
    viewerSessionCleanupFailed: false,
  };
}

export async function disposeLibraryWorkspace(
  libraryId: number,
  options: DisposeLibraryWorkspaceOptions = {},
): Promise<DisposeLibraryWorkspaceResult> {
  const normalizedLibraryId = normalizeLibraryId(libraryId);
  if (normalizedLibraryId == null) {
    return {
      closedBrowserTabCount: 0,
      failedBrowserTabIds: [],
      viewerSessionCleanupFailed: false,
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
    viewerSessionRuntime.disposeLibrary(normalizedLibraryId);
    let viewerSessionCleanupFailed = !options.accountScope;
    if (options.accountScope) {
      try {
        await viewerSessionColdRuntime.deleteLibrary(
          options.accountScope,
          normalizedLibraryId,
        );
      } catch (error) {
        viewerSessionCleanupFailed = true;
        runtimeLogger.warn('delete library viewer Cold snapshots failed', { error });
      }
    }
    clearToolWorkspaceState(normalizedLibraryId);
    clearPendingActivationForLibrary(normalizedLibraryId);
    clearRepositoryTreeSnapshot(normalizedLibraryId);
    clearLibraryDetailWorkspaceState(cacheKey);
    clearFileViewerStateCache(cacheKey);
    return {
      ...result,
      viewerSessionCleanupFailed,
    };
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
    viewerSessionRuntime.dispose();
    clearAllToolWorkspaceStates();
    clearPendingActivation();
    clearAllRepositoryTreeSnapshots();
    clearAllLibraryDetailWorkspaceStates();
    clearAllFileViewerStateCache();
  } finally {
    endSessionDisposing();
  }
}

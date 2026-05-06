import React, { useState, ReactNode } from 'react';
import {
  FileViewerContext,
  type FileViewerState,
  type FileViewerTab,
  type FileViewerOpenOptions,
  type FileViewerAudioPlaylist,
  type FileViewerVideoPlaylist,
  type FileViewerSubtitleSource,
} from './file-viewer.context';
import {
  getFileViewerStateCache,
  setFileViewerStateCache,
} from './file-viewer-cache';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

const defaultFileViewerState: FileViewerState = {
  nodeId: null,
  fileUrl: null,
  fileName: null,
  fileType: null,
  tabTypeLabel: null,
  loading: false,
};

interface FileViewerStoreState {
  fileState: FileViewerState;
  tabs: FileViewerTab[];
  activeTabId: string | null;
}

const defaultFileViewerStoreState: FileViewerStoreState = {
  fileState: defaultFileViewerState,
  tabs: [],
  activeTabId: null,
};

function toFileState(tab: FileViewerTab | null): FileViewerState {
  if (!tab) {
    return defaultFileViewerState;
  }
  return {
    nodeId: tab.nodeId,
    fileUrl: tab.fileUrl,
    fileName: tab.fileName,
    fileType: tab.fileType,
    tabTypeLabel: tab.tabTypeLabel ?? null,
    videoSubtitleSources: tab.videoSubtitleSources,
    videoPlaylist: tab.videoPlaylist ?? null,
    videoAutoPlay: tab.videoAutoPlay ?? false,
    audioSubtitleSources: tab.audioSubtitleSources,
    audioPlaylist: tab.audioPlaylist ?? null,
    audioAutoPlay: tab.audioAutoPlay ?? false,
    audioCoverUrl: tab.audioCoverUrl ?? null,
    loading: tab.loading,
  };
}

function resolveTabId(url: string, nodeId?: number | null): string {
  if (nodeId !== null && nodeId !== undefined) {
    return `node:${nodeId}`;
  }
  return `url:${url}`;
}

function normalizeVideoSubtitleSources(
  sources: FileViewerSubtitleSource[] | null | undefined,
): FileViewerSubtitleSource[] | undefined {
  if (!sources || sources.length === 0) return undefined;
  return sources.map(source => ({
    ...source,
    sortOrder: source.sortOrder ?? null,
  }));
}

function normalizeVideoPlaylist(
  playlist: FileViewerVideoPlaylist | null | undefined,
): FileViewerVideoPlaylist | null {
  if (!playlist || !playlist.items || playlist.items.length === 0) return null;
  const items = playlist.items.map(item => ({
    ...item,
    nodeId: Number(item.nodeId),
    libraryId: Number(item.libraryId),
    sortOrder: item.sortOrder ?? null,
    durationSeconds: item.durationSeconds ?? null,
    subtitleCardNodeId: Number.isFinite(Number(item.subtitleCardNodeId)) && Number(item.subtitleCardNodeId) > 0
      ? Number(item.subtitleCardNodeId)
      : null,
    subtitleSources: normalizeVideoSubtitleSources(item.subtitleSources),
  })).filter(item => (
    Number.isFinite(item.nodeId)
    && item.nodeId > 0
    && Number.isFinite(item.libraryId)
    && item.libraryId > 0
  ));
  if (items.length === 0) return null;
  return {
    id: String(playlist.id || ''),
    title: String(playlist.title || ''),
    items,
  };
}

function normalizeAudioPlaylist(
  playlist: FileViewerAudioPlaylist | null | undefined,
): FileViewerAudioPlaylist | null {
  if (!playlist || !playlist.items || playlist.items.length === 0) return null;
  const items = playlist.items.map(item => ({
    ...item,
    nodeId: Number(item.nodeId),
    libraryId: Number(item.libraryId),
    sortOrder: item.sortOrder ?? null,
    durationSeconds: item.durationSeconds ?? null,
    coverUrl: item.coverUrl ?? null,
    subtitleSources: normalizeVideoSubtitleSources(item.subtitleSources),
  })).filter(item => (
    Number.isFinite(item.nodeId)
    && item.nodeId > 0
    && Number.isFinite(item.libraryId)
    && item.libraryId > 0
  ));
  if (items.length === 0) return null;
  return {
    id: String(playlist.id || ''),
    title: String(playlist.title || ''),
    items,
  };
}

function normalizeStoreState(raw: FileViewerStoreState | null | undefined): FileViewerStoreState {
  if (!raw) {
    return defaultFileViewerStoreState;
  }
  const tabs = raw.tabs.map(tab => ({
    ...tab,
    videoAutoPlay: false,
    audioAutoPlay: false,
  }));
  if (raw.activeTabId === null) {
    return {
      ...raw,
      tabs,
      fileState: defaultFileViewerState,
    };
  }
  const activeTab = tabs.find(tab => tab.id === raw.activeTabId) || null;
  if (!activeTab) {
    return {
      ...raw,
      tabs,
      activeTabId: null,
      fileState: defaultFileViewerState,
    };
  }
  return {
    ...raw,
    tabs,
    fileState: toFileState(activeTab),
  };
}

function closeTabInState(state: FileViewerStoreState, tabId: string): FileViewerStoreState {
  const targetIndex = state.tabs.findIndex(tab => tab.id === tabId);
  if (targetIndex < 0) {
    return state;
  }

  const nextTabs = state.tabs.filter(tab => tab.id !== tabId);
  if (state.activeTabId !== tabId) {
    return {
      ...state,
      tabs: nextTabs,
    };
  }

  const fallback = nextTabs[targetIndex] ?? nextTabs[targetIndex - 1] ?? null;
  return {
    ...state,
    tabs: nextTabs,
    activeTabId: fallback?.id ?? null,
    fileState: toFileState(fallback),
  };
}

function reorderTabsInState(
  state: FileViewerStoreState,
  draggedTabId: string,
  targetTabId: string,
  position: 'before' | 'after',
): FileViewerStoreState {
  if (!draggedTabId || !targetTabId || draggedTabId === targetTabId) {
    return state;
  }
  const fromIndex = state.tabs.findIndex(tab => tab.id === draggedTabId);
  const targetIndex = state.tabs.findIndex(tab => tab.id === targetTabId);
  if (fromIndex < 0 || targetIndex < 0) {
    return state;
  }

  const nextTabs = [...state.tabs];
  const [draggedTab] = nextTabs.splice(fromIndex, 1);
  if (!draggedTab) {
    return state;
  }

  const baseTargetIndex = nextTabs.findIndex(tab => tab.id === targetTabId);
  if (baseTargetIndex < 0) {
    return state;
  }

  const insertIndex = position === 'after'
    ? baseTargetIndex + 1
    : baseTargetIndex;
  nextTabs.splice(insertIndex, 0, draggedTab);

  return {
    ...state,
    tabs: nextTabs,
  };
}

export const FileViewerProvider: React.FC<{ children: ReactNode; cacheKey?: string }> = ({
  children,
  cacheKey,
}) => {
  const [viewerState, setViewerState] = useState<FileViewerStoreState>(() => {
    if (!cacheKey) {
      return defaultFileViewerStoreState;
    }
    return normalizeStoreState(getFileViewerStateCache<FileViewerStoreState>(cacheKey));
  });
  const activeCacheKeyRef = React.useRef<string | undefined>(cacheKey);
  const skipPersistRef = React.useRef(false);

  const setFileUrl = (
    url: string | null,
    fileName: string | null,
    fileType: FileViewerFileType | null,
    nodeId?: number | null,
    options?: FileViewerOpenOptions,
  ) => {
    if (!url) {
      setViewerState(prev => ({
        ...prev,
        activeTabId: null,
        fileState: defaultFileViewerState,
      }));
      return;
    }

    const tabId = resolveTabId(url, nodeId);
    setViewerState(prev => {
      const replaceTabId = options?.replaceTabId || null;
      const replacingTab = replaceTabId
        ? prev.tabs.find(tab => tab.id === replaceTabId) || null
        : null;
      const existingTab = prev.tabs.find(tab => tab.id === tabId);
      const baseTab = replacingTab ?? existingTab;
      const videoSubtitleSources = normalizeVideoSubtitleSources(options?.videoSubtitleSources);
      const videoPlaylist = normalizeVideoPlaylist(options?.videoPlaylist);
      const audioSubtitleSources = normalizeVideoSubtitleSources(options?.audioSubtitleSources);
      const audioPlaylist = normalizeAudioPlaylist(options?.audioPlaylist);
      const nextTab: FileViewerTab = {
        id: tabId,
        nodeId: nodeId ?? null,
        fileUrl: url,
        fileName,
        fileType,
        tabTypeLabel: options?.tabTypeLabel ?? null,
        returnTarget: options?.returnTarget ?? null,
        videoSubtitleSources,
        videoPlaylist,
        videoAutoPlay: Boolean(options?.videoAutoPlay),
        audioSubtitleSources,
        audioPlaylist,
        audioAutoPlay: Boolean(options?.audioAutoPlay),
        audioCoverUrl: options?.audioCoverUrl ?? null,
        loading: false,
        reloadToken: baseTab?.reloadToken ?? 0,
      };
      const existingIndex = prev.tabs.findIndex(tab => tab.id === tabId);
      const nextTabs = [...prev.tabs];
      const replaceIndex = replaceTabId ? prev.tabs.findIndex(tab => tab.id === replaceTabId) : -1;
      if (replaceIndex >= 0) {
        const withoutTargetDuplicate = nextTabs.filter((tab, index) => (
          index === replaceIndex || tab.id !== tabId
        ));
        const nextReplaceIndex = withoutTargetDuplicate.findIndex(tab => tab.id === replaceTabId);
        withoutTargetDuplicate[nextReplaceIndex] = {
          ...nextTab,
          loading: replacingTab?.loading ?? existingTab?.loading ?? false,
          reloadToken: replacingTab?.reloadToken ?? existingTab?.reloadToken ?? 0,
        };
        const activeTab = withoutTargetDuplicate[nextReplaceIndex] ?? nextTab;
        return {
          ...prev,
          tabs: withoutTargetDuplicate,
          activeTabId: tabId,
          fileState: toFileState(activeTab),
        };
      }
      if (existingIndex >= 0) {
        nextTabs[existingIndex] = {
          ...nextTab,
          // 若调用者未显式透传 returnTarget，则默认清空，避免历史来源残留。
          returnTarget: options?.returnTarget ?? null,
          // loading 由 setLoading 统一维护，防止打开同 tab 时闪烁。
          loading: existingTab?.loading ?? false,
          reloadToken: existingTab?.reloadToken ?? 0,
        };
      } else {
        nextTabs.push(nextTab);
      }
      const activeTab = nextTabs.find(tab => tab.id === tabId) ?? nextTab;
      return {
        ...prev,
        tabs: nextTabs,
        activeTabId: tabId,
        fileState: toFileState(activeTab),
      };
    });
  };

  const setLoading = (loading: boolean) => {
    setViewerState(prev => {
      if (!prev.activeTabId) {
        return {
          ...prev,
          fileState: { ...prev.fileState, loading },
        };
      }

      const nextTabs = prev.tabs.map(tab => (
        tab.id === prev.activeTabId
          ? { ...tab, loading }
          : tab
      ));
      const activeTab = nextTabs.find(tab => tab.id === prev.activeTabId) || null;
      return {
        ...prev,
        tabs: nextTabs,
        fileState: toFileState(activeTab),
      };
    });
  };

  const activateTab = (tabId: string) => {
    setViewerState(prev => {
      const targetTab = prev.tabs.find(tab => tab.id === tabId) || null;
      if (!targetTab) {
        return prev;
      }
      return {
        ...prev,
        activeTabId: tabId,
        fileState: toFileState(targetTab),
      };
    });
  };

  const closeTab = (tabId: string) => {
    setViewerState(prev => closeTabInState(prev, tabId));
  };

  const closeTabByNodeId = (nodeId: number) => {
    setViewerState(prev => {
      const targetIds = prev.tabs
        .filter(tab => tab.nodeId === nodeId)
        .map(tab => tab.id);
      if (targetIds.length === 0) {
        return prev;
      }
      return targetIds.reduce((state, tabId) => closeTabInState(state, tabId), prev);
    });
  };

  const reloadActiveTab = () => {
    setViewerState(prev => {
      const activeId = prev.activeTabId;
      if (!activeId) {
        return prev;
      }
      const nextTabs = prev.tabs.map(tab => (
        tab.id === activeId
          ? { ...tab, reloadToken: (tab.reloadToken ?? 0) + 1 }
          : tab
      ));
      const activeTab = nextTabs.find(tab => tab.id === activeId) || null;
      if (!activeTab) {
        return prev;
      }
      return {
        ...prev,
        tabs: nextTabs,
        fileState: toFileState(activeTab),
      };
    });
  };

  const reorderTabs = (draggedTabId: string, targetTabId: string, position: 'before' | 'after') => {
    setViewerState(prev => reorderTabsInState(prev, draggedTabId, targetTabId, position));
  };

  React.useEffect(() => {
    if (cacheKey === activeCacheKeyRef.current) return;
    activeCacheKeyRef.current = cacheKey;
    skipPersistRef.current = true;
    if (!cacheKey) {
      setViewerState(defaultFileViewerStoreState);
      return;
    }
    setViewerState(normalizeStoreState(getFileViewerStateCache<FileViewerStoreState>(cacheKey)));
  }, [cacheKey]);

  React.useEffect(() => {
    if (!cacheKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    setFileViewerStateCache<FileViewerStoreState>(cacheKey, viewerState);
  }, [cacheKey, viewerState]);

  return (
    <FileViewerContext.Provider
      value={{
        fileState: viewerState.fileState,
        tabs: viewerState.tabs,
        activeTabId: viewerState.activeTabId,
        setFileUrl,
        setLoading,
        activateTab,
        closeTab,
        closeTabByNodeId,
        reloadActiveTab,
        reorderTabs,
      }}
    >
      {children}
    </FileViewerContext.Provider>
  );
};

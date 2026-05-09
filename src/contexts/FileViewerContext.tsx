import React, { useState, useEffect, ReactNode } from 'react';
import {
  FileViewerContext,
  type FileViewerState,
  type FileViewerTab,
  type FileViewerOpenOptions,
  type FileViewerAudioPlaylist,
  type FileViewerVideoPlaylist,
  type FileViewerSubtitleSource,
} from './file-viewer.context';
import { normalizeFileViewerReturnTarget } from './file-viewer-return-target';
import { globalAudioPlayer } from '@/features/file-viewer/services/global-audio-player';
import { floatingVideoService } from '@/features/file-viewer/services/floating-video.service';
import {
  commitPendingActivation,
  peekPendingActivation,
  subscribePendingActivation,
} from './file-viewer-pending-activation';
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
    total: Number.isFinite(Number(playlist.total)) && Number(playlist.total) >= 0
      ? Number(playlist.total)
      : null,
    nextOffset: Number.isFinite(Number(playlist.nextOffset)) && Number(playlist.nextOffset) >= 0
      ? Number(playlist.nextOffset)
      : null,
    hasMore: Boolean(playlist.hasMore),
    source: playlist.source?.kind === 'video_archive_collection'
      && Number.isFinite(Number(playlist.source.nodeId))
      && Number(playlist.source.nodeId) > 0
      && Number.isFinite(Number(playlist.source.libraryId))
      && Number(playlist.source.libraryId) > 0
      ? {
        kind: 'video_archive_collection',
        nodeId: Number(playlist.source.nodeId),
        libraryId: Number(playlist.source.libraryId),
      }
      : null,
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
    returnTarget: normalizeFileViewerReturnTarget(tab.returnTarget),
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

export const FileViewerProvider: React.FC<{
  children: ReactNode;
  cacheKey?: string;
  libraryId?: number | null;
}> = ({
  children,
  cacheKey,
  libraryId = null,
}) => {
  const [viewerState, setViewerState] = useState<FileViewerStoreState>(() => {
    if (!cacheKey) {
      return defaultFileViewerStoreState;
    }
    return normalizeStoreState(getFileViewerStateCache<FileViewerStoreState>(cacheKey));
  });
  const activeCacheKeyRef = React.useRef<string | undefined>(cacheKey);
  const skipPersistRef = React.useRef(false);

  // 跨路由"待激活 tab"消费：预留给未来外部 MediaHub 入口 setPendingActivation；
  // 设计要点（解决 StrictMode 双 mount 把 setState 丢弃的问题）：
  //   - 不在调 setState 的同时 commit pending；
  //   - 把"清 pending"和"viewerState.activeTabId 真的等于 tabId"挂钩；
  //   - tabs / activeTabId / pendingTick 任意变化都重跑 effect 直到 pending 能匹配上。
  // 详见 docs/media-hub-contract.md。
  const [pendingTick, setPendingTick] = useState(0);
  useEffect(() => subscribePendingActivation(() => setPendingTick((n) => n + 1)), []);

  useEffect(() => {
    if (libraryId == null) return;
    const tabId = peekPendingActivation(libraryId);
    if (!tabId) return;
    // 已经激活到位 → 清 pending
    if (viewerState.activeTabId === tabId) {
      commitPendingActivation(libraryId, tabId);
      return;
    }
    // 还未激活：tab 在 → setState 激活；tab 不在 → 等下一次 tabs 变化再来
    const target = viewerState.tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    setViewerState((prev) => {
      if (prev.activeTabId === tabId) return prev;
      const persistTarget = prev.tabs.find((tab) => tab.id === tabId);
      if (!persistTarget) return prev;
      return {
        ...prev,
        activeTabId: tabId,
        fileState: toFileState(persistTarget),
      };
    });
    // 下一帧 render 后 viewerState.activeTabId 变，本 effect 重跑走第一个分支清 pending
  }, [libraryId, viewerState.activeTabId, viewerState.tabs, pendingTick]);

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
      const returnTarget = normalizeFileViewerReturnTarget(options?.returnTarget);
      const nextTab: FileViewerTab = {
        id: tabId,
        nodeId: nodeId ?? null,
        fileUrl: url,
        fileName,
        fileType,
        tabTypeLabel: options?.tabTypeLabel ?? null,
        returnTarget,
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
          returnTarget,
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

  // 关闭 tab 时务必通知媒体服务释放对应资源（同浏览器关 tab 一致）。
  // 服务层是 MediaHub 的真实持有者，组件卸载不再触发释放，必须从这里兜底。
  // 详见 docs/media-hub-contract.md。
  const releaseMediaForTab = (tabId: string) => {
    globalAudioPlayer.releaseForTab(tabId);
    floatingVideoService.releaseForTab(tabId);
  };

  const closeTab = (tabId: string) => {
    releaseMediaForTab(tabId);
    setViewerState(prev => closeTabInState(prev, tabId));
  };

  const closeTabByNodeId = (nodeId: number) => {
    const targetIds = viewerState.tabs
      .filter(tab => tab.nodeId === nodeId)
      .map(tab => tab.id);
    if (targetIds.length === 0) return;
    // 副作用必须在 setState 外执行——updater 必须保持纯函数，否则 StrictMode 双调用会重复 release。
    targetIds.forEach(releaseMediaForTab);
    setViewerState(prev => targetIds.reduce((state, tabId) => closeTabInState(state, tabId), prev));
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

import React, { useState, ReactNode } from 'react';
import {
  FileViewerContext,
  type FileViewerState,
  type FileViewerTab,
} from './file-viewer.context';

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

const FILE_VIEWER_CACHE_MAX_ENTRIES = 12;
const fileViewerStateCache = new Map<string, FileViewerStoreState>();

function setFileViewerStateCache(cacheKey: string, state: FileViewerStoreState) {
  // Simple LRU-like behavior: refresh key order and evict the oldest when cap is exceeded.
  if (fileViewerStateCache.has(cacheKey)) {
    fileViewerStateCache.delete(cacheKey);
  }
  fileViewerStateCache.set(cacheKey, state);
  if (fileViewerStateCache.size > FILE_VIEWER_CACHE_MAX_ENTRIES) {
    const oldestKey = fileViewerStateCache.keys().next().value;
    if (oldestKey) {
      fileViewerStateCache.delete(oldestKey);
    }
  }
}

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
    loading: tab.loading,
  };
}

function resolveTabId(url: string, nodeId?: number | null): string {
  if (nodeId !== null && nodeId !== undefined) {
    return `node:${nodeId}`;
  }
  return `url:${url}`;
}

function normalizeStoreState(raw: FileViewerStoreState | null | undefined): FileViewerStoreState {
  if (!raw) {
    return defaultFileViewerStoreState;
  }
  if (raw.activeTabId === null) {
    return raw;
  }
  const activeTab = raw.tabs.find(tab => tab.id === raw.activeTabId) || null;
  if (!activeTab) {
    return {
      ...raw,
      activeTabId: null,
      fileState: defaultFileViewerState,
    };
  }
  return {
    ...raw,
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

export const FileViewerProvider: React.FC<{ children: ReactNode; cacheKey?: string }> = ({
  children,
  cacheKey,
}) => {
  const [viewerState, setViewerState] = useState<FileViewerStoreState>(() => {
    if (!cacheKey) {
      return defaultFileViewerStoreState;
    }
    return normalizeStoreState(fileViewerStateCache.get(cacheKey));
  });
  const activeCacheKeyRef = React.useRef<string | undefined>(cacheKey);
  const skipPersistRef = React.useRef(false);

  const setFileUrl = (
    url: string | null,
    fileName: string | null,
    fileType: 'image' | 'video' | 'audio' | 'comic' | 'asmr' | 'other' | null,
    nodeId?: number | null,
    options?: {
      tabTypeLabel?: string | null;
    },
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
      const nextTab: FileViewerTab = {
        id: tabId,
        nodeId: nodeId ?? null,
        fileUrl: url,
        fileName,
        fileType,
        tabTypeLabel: options?.tabTypeLabel ?? null,
        loading: false,
      };
      const existingIndex = prev.tabs.findIndex(tab => tab.id === tabId);
      const nextTabs = [...prev.tabs];
      if (existingIndex >= 0) {
        nextTabs[existingIndex] = nextTab;
      } else {
        nextTabs.push(nextTab);
      }
      return {
        ...prev,
        tabs: nextTabs,
        activeTabId: tabId,
        fileState: toFileState(nextTab),
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

  React.useEffect(() => {
    if (cacheKey === activeCacheKeyRef.current) return;
    activeCacheKeyRef.current = cacheKey;
    skipPersistRef.current = true;
    if (!cacheKey) {
      setViewerState(defaultFileViewerStoreState);
      return;
    }
    setViewerState(normalizeStoreState(fileViewerStateCache.get(cacheKey)));
  }, [cacheKey]);

  React.useEffect(() => {
    if (!cacheKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    setFileViewerStateCache(cacheKey, viewerState);
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
      }}
    >
      {children}
    </FileViewerContext.Provider>
  );
};

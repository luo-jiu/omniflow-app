import React, { createContext, useContext, useState, ReactNode } from 'react';

interface FileViewerState {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: 'image' | 'video' | 'audio' | 'other' | null;
  loading: boolean;
}

interface FileViewerContextType {
  fileState: FileViewerState;
  setFileUrl: (
    url: string | null,
    fileName: string | null,
    fileType: 'image' | 'video' | 'audio' | 'other' | null,
    nodeId?: number | null,
  ) => void;
  setLoading: (loading: boolean) => void;
}

const FileViewerContext = createContext<FileViewerContextType | undefined>(undefined);

const defaultFileViewerState: FileViewerState = {
  nodeId: null,
  fileUrl: null,
  fileName: null,
  fileType: null,
  loading: false,
};

const FILE_VIEWER_CACHE_MAX_ENTRIES = 12;
const fileViewerStateCache = new Map<string, FileViewerState>();

function setFileViewerStateCache(cacheKey: string, state: FileViewerState) {
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

export const FileViewerProvider: React.FC<{ children: ReactNode; cacheKey?: string }> = ({
  children,
  cacheKey,
}) => {
  const [fileState, setFileState] = useState<FileViewerState>(() => {
    if (!cacheKey) {
      return defaultFileViewerState;
    }
    return fileViewerStateCache.get(cacheKey) ?? defaultFileViewerState;
  });
  const activeCacheKeyRef = React.useRef<string | undefined>(cacheKey);
  const skipPersistRef = React.useRef(false);

  const setFileUrl = (
    url: string | null,
    fileName: string | null,
    fileType: 'image' | 'video' | 'audio' | 'other' | null,
    nodeId?: number | null,
  ) => {
    setFileState({
      nodeId: nodeId ?? null,
      fileUrl: url,
      fileName,
      fileType,
      loading: false,
    });
  };

  const setLoading = (loading: boolean) => {
    setFileState(prev => ({ ...prev, loading }));
  };

  React.useEffect(() => {
    if (cacheKey === activeCacheKeyRef.current) return;
    activeCacheKeyRef.current = cacheKey;
    skipPersistRef.current = true;
    if (!cacheKey) {
      setFileState(defaultFileViewerState);
      return;
    }
    setFileState(fileViewerStateCache.get(cacheKey) ?? defaultFileViewerState);
  }, [cacheKey]);

  React.useEffect(() => {
    if (!cacheKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    setFileViewerStateCache(cacheKey, fileState);
  }, [cacheKey, fileState]);

  return (
    <FileViewerContext.Provider value={{ fileState, setFileUrl, setLoading }}>
      {children}
    </FileViewerContext.Provider>
  );
};

export const useFileViewer = () => {
  const context = useContext(FileViewerContext);
  if (!context) {
    throw new Error('useFileViewer must be used within FileViewerProvider');
  }
  return context;
};

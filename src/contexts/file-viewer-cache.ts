const FILE_VIEWER_CACHE_MAX_ENTRIES = 12;
const fileViewerStateCache = new Map<string, unknown>();

export function clearFileViewerStateCache(cacheKey?: string) {
  if (!cacheKey) {
    return;
  }
  fileViewerStateCache.delete(cacheKey);
}

export function clearAllFileViewerStateCache() {
  fileViewerStateCache.clear();
}

export function getFileViewerStateCache<T>(cacheKey?: string) {
  if (!cacheKey) {
    return undefined;
  }
  return fileViewerStateCache.get(cacheKey) as T | undefined;
}

export function setFileViewerStateCache<T>(cacheKey: string, state: T) {
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

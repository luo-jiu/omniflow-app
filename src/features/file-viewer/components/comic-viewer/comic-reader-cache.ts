import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface ComicPageItem {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  url: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export interface ComicReaderSnapshot {
  hasLoadedList: boolean;
  pages: ComicPageItem[];
  visibleCount: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  updatedAt: string;
}

const COMIC_READER_CACHE_MAX_ENTRIES = 24;

export const EMPTY_COMIC_READER_SNAPSHOT: ComicReaderSnapshot = {
  hasLoadedList: false,
  pages: [],
  visibleCount: 0,
  scrollTop: 0,
  scrollRatio: 0,
  anchorPageId: null,
  anchorOffsetRatio: 0,
  updatedAt: '',
};

export const comicReaderSnapshotCache = new Map<string, ComicReaderSnapshot>();

export function resolveComicReaderCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken: number,
): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) {
    return null;
  }
  return `${String(fileUrl || '').trim()}::${folderNodeId}::r${Math.max(Math.floor(reloadToken), 0)}`;
}

export function setComicReaderSnapshotCache(cacheKey: string, snapshot: ComicReaderSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (comicReaderSnapshotCache.has(cacheKey)) {
    comicReaderSnapshotCache.delete(cacheKey);
  }
  comicReaderSnapshotCache.set(cacheKey, snapshot);
  if (comicReaderSnapshotCache.size > COMIC_READER_CACHE_MAX_ENTRIES) {
    const oldestKey = comicReaderSnapshotCache.keys().next().value;
    if (oldestKey) {
      comicReaderSnapshotCache.delete(oldestKey);
    }
  }
}

export function clearComicReaderSnapshotForFile(
  fileUrl: string,
  folderNodeId: number | null | undefined,
) {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) {
    return;
  }
  const prefix = `${String(fileUrl || '').trim()}::${folderNodeId}::r`;
  Array.from(comicReaderSnapshotCache.keys()).forEach((cacheKey) => {
    if (cacheKey.startsWith(prefix)) {
      comicReaderSnapshotCache.delete(cacheKey);
    }
  });
}

export function clearAllComicReaderSnapshots() {
  comicReaderSnapshotCache.clear();
}

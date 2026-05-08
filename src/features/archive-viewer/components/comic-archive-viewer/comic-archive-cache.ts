import type { ComicArchiveCard } from './comic-archive-types';

const COMIC_ARCHIVE_CACHE_MAX_ENTRIES = 24;

export interface ComicArchiveSnapshot {
  hasLoadedList: boolean;
  cards: ComicArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
  scrollRatio: number;
  anchorCardId: number | null;
  anchorOffsetRatio: number;
}

export const EMPTY_COMIC_ARCHIVE_SNAPSHOT: ComicArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
  scrollRatio: 0,
  anchorCardId: null,
  anchorOffsetRatio: 0,
};

export const comicArchiveSnapshotCache = new Map<string, ComicArchiveSnapshot>();

export function resolveReaderCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken: number,
): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) {
    return null;
  }
  return `${String(fileUrl || '').trim()}::${folderNodeId}::r${Math.max(Math.floor(reloadToken), 0)}`;
}

export function setArchiveSnapshotCache(cacheKey: string, snapshot: ComicArchiveSnapshot) {
  if (comicArchiveSnapshotCache.has(cacheKey)) {
    comicArchiveSnapshotCache.delete(cacheKey);
  }
  comicArchiveSnapshotCache.set(cacheKey, snapshot);
  if (comicArchiveSnapshotCache.size > COMIC_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = comicArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      comicArchiveSnapshotCache.delete(oldest);
    }
  }
}

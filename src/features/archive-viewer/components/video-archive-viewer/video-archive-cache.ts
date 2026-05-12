import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface VideoArchiveCard {
  id: number;
  mediaNodeId: number;
  title: string;
  sortOrder: number;
  cardKind: 'media' | 'collection';
  coverNodeId: number | null;
  coverUrl: string | null;
  videoPreviewUrl: string | null;
  subtitleCount: number;
  durationSeconds?: number;
}

export interface VideoArchiveSnapshot {
  hasLoadedList: boolean;
  cards: VideoArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
}

const VIDEO_ARCHIVE_CACHE_MAX_ENTRIES = 24;

export const EMPTY_VIDEO_ARCHIVE_SNAPSHOT: VideoArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
};

export const videoArchiveSnapshotCache = new Map<string, VideoArchiveSnapshot>();

export function resolveVideoArchiveReaderCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}`;
}

export function setVideoArchiveSnapshotCache(cacheKey: string, snapshot: VideoArchiveSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (videoArchiveSnapshotCache.has(cacheKey)) {
    videoArchiveSnapshotCache.delete(cacheKey);
  }
  videoArchiveSnapshotCache.set(cacheKey, snapshot);
  if (videoArchiveSnapshotCache.size > VIDEO_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = videoArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      videoArchiveSnapshotCache.delete(oldest);
    }
  }
}

export function clearVideoArchiveSnapshotForFile(
  fileUrl: string,
  folderNodeId: number | null | undefined,
) {
  const cacheKey = resolveVideoArchiveReaderCacheKey(fileUrl, folderNodeId ?? null);
  if (cacheKey) {
    videoArchiveSnapshotCache.delete(cacheKey);
  }
}

export function clearAllVideoArchiveSnapshots() {
  videoArchiveSnapshotCache.clear();
}

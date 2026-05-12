import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface AudioArchiveCard {
  id: number;
  mediaNodeId: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
  subtitleCount: number;
  durationSeconds?: number | null;
}

export interface AudioArchiveSnapshot {
  hasLoadedList: boolean;
  cards: AudioArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
  currentCardId: number | null;
  selectedCardId: number | null;
  currentAudioUrl: string | null;
  activeSubtitleSources?: FileViewerSubtitleSource[];
}

const AUDIO_ARCHIVE_CACHE_MAX_ENTRIES = 24;

export const EMPTY_AUDIO_ARCHIVE_SNAPSHOT: AudioArchiveSnapshot = {
  hasLoadedList: false,
  cards: [],
  nextOffset: 0,
  total: 0,
  hasMore: false,
  scrollTop: 0,
  currentCardId: null,
  selectedCardId: null,
  currentAudioUrl: null,
  activeSubtitleSources: undefined,
};

export const audioArchiveSnapshotCache = new Map<string, AudioArchiveSnapshot>();

export function resolveAudioArchiveReaderCacheKey(fileUrl: string, folderNodeId: number | null): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}`;
}

export function setAudioArchiveSnapshotCache(cacheKey: string, snapshot: AudioArchiveSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (audioArchiveSnapshotCache.has(cacheKey)) {
    audioArchiveSnapshotCache.delete(cacheKey);
  }
  audioArchiveSnapshotCache.set(cacheKey, snapshot);
  if (audioArchiveSnapshotCache.size > AUDIO_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = audioArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      audioArchiveSnapshotCache.delete(oldest);
    }
  }
}

export function clearAudioArchiveSnapshotForFile(
  fileUrl: string,
  folderNodeId: number | null | undefined,
) {
  const cacheKey = resolveAudioArchiveReaderCacheKey(fileUrl, folderNodeId ?? null);
  if (cacheKey) {
    audioArchiveSnapshotCache.delete(cacheKey);
  }
}

export function clearAllAudioArchiveSnapshots() {
  audioArchiveSnapshotCache.clear();
}

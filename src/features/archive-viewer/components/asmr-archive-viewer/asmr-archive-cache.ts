import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface AsmrArchiveTag {
  id: number | null;
  name: string;
  color?: string | null;
  textColor?: string | null;
  fallback?: boolean;
}

export interface AsmrArchiveCard {
  id: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
  tags: AsmrArchiveTag[];
  viewMeta: string;
}

export interface AsmrArchiveSnapshot {
  hasLoadedList: boolean;
  cards: AsmrArchiveCard[];
  nextOffset: number;
  total: number;
  hasMore: boolean;
  scrollTop: number;
  scrollRatio: number;
  anchorCardId: number | null;
  anchorOffsetRatio: number;
}

const ASMR_ARCHIVE_CACHE_MAX_ENTRIES = 24;

export const EMPTY_ASMR_ARCHIVE_SNAPSHOT: AsmrArchiveSnapshot = {
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

export const asmrArchiveSnapshotCache = new Map<string, AsmrArchiveSnapshot>();

export function resolveAsmrArchiveReaderCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken = 0,
): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  const normalizedReloadToken = Number.isFinite(reloadToken)
    ? Math.max(Math.floor(reloadToken), 0)
    : 0;
  return `${String(fileUrl || '').trim()}::${folderNodeId}::r${normalizedReloadToken}`;
}

export function setAsmrArchiveSnapshotCache(cacheKey: string, snapshot: AsmrArchiveSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (asmrArchiveSnapshotCache.has(cacheKey)) {
    asmrArchiveSnapshotCache.delete(cacheKey);
  }
  asmrArchiveSnapshotCache.set(cacheKey, snapshot);
  if (asmrArchiveSnapshotCache.size > ASMR_ARCHIVE_CACHE_MAX_ENTRIES) {
    const oldest = asmrArchiveSnapshotCache.keys().next().value;
    if (oldest) {
      asmrArchiveSnapshotCache.delete(oldest);
    }
  }
}

export function clearAsmrArchiveSnapshotForFile(
  fileUrl: string,
  folderNodeId: number | null | undefined,
) {
  const normalizedFileUrl = String(fileUrl || '').trim();
  if (!normalizedFileUrl || !folderNodeId || !Number.isFinite(folderNodeId)) return;
  const resourceKey = `${normalizedFileUrl}::${folderNodeId}`;
  Array.from(asmrArchiveSnapshotCache.keys()).forEach((cacheKey) => {
    if (cacheKey === resourceKey || cacheKey.startsWith(`${resourceKey}::`)) {
      asmrArchiveSnapshotCache.delete(cacheKey);
    }
  });
}

export function clearAllAsmrArchiveSnapshots() {
  asmrArchiveSnapshotCache.clear();
}

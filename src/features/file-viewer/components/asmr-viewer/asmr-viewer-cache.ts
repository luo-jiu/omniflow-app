import { resolveAsmrOwnerKey } from '@/features/file-viewer/utils/asmr-owner-key';
import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface AsmrNodeItem {
  id: number;
  name: string;
  type: 'dir' | 'file' | string | number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface AsmrPathItem {
  id: number;
  name: string;
}

export interface AsmrViewMetaPayload {
  sn?: string;
  tag?: string;
  tagIds?: number[];
  coverNodeId?: number;
  [key: string]: unknown;
}

export interface AsmrViewerSnapshot {
  hasLoadedList: boolean;
  pathStack: AsmrPathItem[];
  items: AsmrNodeItem[];
  selectedId: number | null;
  collectionName?: string | null;
  collectionTag?: string | null;
  collectionTagIds?: number[];
  collectionSn?: string | null;
  viewMetaBase?: AsmrViewMetaPayload;
  coverUrl: string | null;
  coverNodeId: number | null;
  currentAudioId: number | null;
  currentAudioSrc: string | null;
  audioQueue: AsmrNodeItem[];
  audioUrlEntries: Array<[number, string]>;
}

const ASMR_VIEWER_CACHE_MAX_ENTRIES = 24;

export const asmrViewerSnapshotCache = new Map<string, AsmrViewerSnapshot>();

export function resolveAsmrViewerCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken: number,
): string | null {
  const ownerKey = resolveAsmrOwnerKey(fileUrl, folderNodeId);
  if (!ownerKey) return null;
  return `${ownerKey}::r${Math.max(Math.floor(reloadToken), 0)}`;
}

export function setAsmrViewerSnapshot(cacheKey: string, snapshot: AsmrViewerSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (asmrViewerSnapshotCache.has(cacheKey)) {
    asmrViewerSnapshotCache.delete(cacheKey);
  }
  asmrViewerSnapshotCache.set(cacheKey, snapshot);
  if (asmrViewerSnapshotCache.size > ASMR_VIEWER_CACHE_MAX_ENTRIES) {
    const oldestKey = asmrViewerSnapshotCache.keys().next().value;
    if (oldestKey) {
      asmrViewerSnapshotCache.delete(oldestKey);
    }
  }
}

export function clearAsmrViewerSnapshotForFile(
  fileUrl: string,
  folderNodeId: number | null | undefined,
) {
  const ownerKey = resolveAsmrOwnerKey(fileUrl, folderNodeId ?? null);
  if (!ownerKey) {
    return;
  }
  const prefix = `${ownerKey}::r`;
  Array.from(asmrViewerSnapshotCache.keys()).forEach((cacheKey) => {
    if (cacheKey.startsWith(prefix)) {
      asmrViewerSnapshotCache.delete(cacheKey);
    }
  });
}

export function clearAllAsmrViewerSnapshots() {
  asmrViewerSnapshotCache.clear();
}

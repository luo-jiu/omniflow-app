import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface GallerySnapshotMediaItem {
  id: number;
  title: string;
  ext?: string;
  mimeType?: string;
  kind: 'image' | 'video';
}

export interface GallerySnapshotImagePreview {
  metadataRows: Array<{ label: string; value: string }>;
  originalSize?: number;
  previewUrl: string;
  previewPath?: string;
}

export interface GallerySnapshot {
  activeIndex: number | null;
  imageNaturalSize: { width: number; height: number };
  imageOffset: { x: number; y: number };
  imagePreviewEntries: Array<[number, GallerySnapshotImagePreview]>;
  imagePreviewErrorEntries: Array<[number, string]>;
  imageRotateSteps: number;
  imageZoom: number;
  items: GallerySnapshotMediaItem[];
  keptImageIds: number[];
  linkEntries: Array<[number, string]>;
  loadedThumbIds: number[];
  scrollTop: number;
}

const GALLERY_SNAPSHOT_CACHE_MAX_ENTRIES = 24;

const gallerySnapshotCache = new Map<string, GallerySnapshot>();

export function resolveGallerySnapshotCacheKey(
  fileUrl: string,
  folderNodeId: number | null,
  reloadToken: number,
): string | null {
  if (!folderNodeId || !Number.isFinite(folderNodeId)) return null;
  return `${String(fileUrl || '').trim()}::${folderNodeId}::r${Math.max(Math.floor(reloadToken), 0)}`;
}

export function getGallerySnapshotCache(cacheKey: string | null): GallerySnapshot | null {
  if (!cacheKey) return null;
  return gallerySnapshotCache.get(cacheKey) ?? null;
}

export function setGallerySnapshotCache(cacheKey: string | null, snapshot: GallerySnapshot) {
  if (!cacheKey || isDisposingAnyWorkspace()) return;
  if (gallerySnapshotCache.has(cacheKey)) {
    gallerySnapshotCache.delete(cacheKey);
  }
  gallerySnapshotCache.set(cacheKey, snapshot);
  if (gallerySnapshotCache.size > GALLERY_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldestKey = gallerySnapshotCache.keys().next().value;
    if (oldestKey) gallerySnapshotCache.delete(oldestKey);
  }
}

export function clearGallerySnapshotCache(cacheKey: string | null) {
  if (!cacheKey) return;
  gallerySnapshotCache.delete(cacheKey);
}

export function clearGallerySnapshotForFile(fileUrl: string, folderNodeId?: number | null) {
  const normalizedFileUrl = String(fileUrl || '').trim();
  if (!normalizedFileUrl) return;
  const prefix = folderNodeId && Number.isFinite(folderNodeId)
    ? `${normalizedFileUrl}::${folderNodeId}::`
    : `${normalizedFileUrl}::`;
  Array.from(gallerySnapshotCache.keys()).forEach((cacheKey) => {
    if (cacheKey.startsWith(prefix)) {
      gallerySnapshotCache.delete(cacheKey);
    }
  });
}

export function clearAllGallerySnapshots() {
  gallerySnapshotCache.clear();
}

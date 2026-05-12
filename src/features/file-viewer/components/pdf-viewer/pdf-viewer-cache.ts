import { isDisposingAnyWorkspace } from '@/features/workspace-resource-release/dispose-markers';

export interface PdfViewerSnapshot {
  currentPage: number;
  zoom: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPage: number;
  anchorOffsetRatio: number;
}

const PDF_VIEWER_CACHE_MAX_ENTRIES = 24;
export const pdfViewerSnapshotCache = new Map<string, PdfViewerSnapshot>();

export function resolvePdfViewerCacheKey(url: string, nodeId: number | null, reloadToken: number): string {
  const normalizedToken = Math.max(Math.floor(reloadToken), 0);
  if (nodeId !== null && nodeId !== undefined) {
    return `node:${nodeId}::r${normalizedToken}`;
  }
  return `url:${String(url || '').trim()}::r${normalizedToken}`;
}

export function setPdfViewerSnapshot(cacheKey: string, snapshot: PdfViewerSnapshot) {
  if (isDisposingAnyWorkspace()) {
    return;
  }
  if (pdfViewerSnapshotCache.has(cacheKey)) {
    pdfViewerSnapshotCache.delete(cacheKey);
  }
  pdfViewerSnapshotCache.set(cacheKey, snapshot);
  if (pdfViewerSnapshotCache.size > PDF_VIEWER_CACHE_MAX_ENTRIES) {
    const oldestKey = pdfViewerSnapshotCache.keys().next().value;
    if (oldestKey) {
      pdfViewerSnapshotCache.delete(oldestKey);
    }
  }
}

export function clearPdfViewerSnapshotForFile(
  url: string,
  nodeId: number | null | undefined,
) {
  const prefix = nodeId !== null && nodeId !== undefined
    ? `node:${nodeId}::r`
    : `url:${String(url || '').trim()}::r`;
  Array.from(pdfViewerSnapshotCache.keys()).forEach((cacheKey) => {
    if (cacheKey.startsWith(prefix)) {
      pdfViewerSnapshotCache.delete(cacheKey);
    }
  });
}

export function clearAllPdfViewerSnapshots() {
  pdfViewerSnapshotCache.clear();
}

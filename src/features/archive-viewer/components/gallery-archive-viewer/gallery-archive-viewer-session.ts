export const GALLERY_ARCHIVE_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const GALLERY_ARCHIVE_VIEWER_SESSION_ESTIMATED_BYTES = 256;

const MAX_SCROLL_TOP = 100_000_000;

export interface GalleryArchiveViewerSessionSnapshot {
  anchorCardId: number | null;
  anchorOffsetRatio: number;
  scrollRatio: number | null;
  scrollTop: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNodeId(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function parseGalleryArchiveViewerSessionSnapshot(
  value: unknown,
): GalleryArchiveViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GalleryArchiveViewerSessionSnapshot>;
  const anchorCardId = readNodeId(candidate.anchorCardId);
  const anchorOffsetRatio = readFiniteNumber(candidate.anchorOffsetRatio);
  const scrollRatio = candidate.scrollRatio === null
    ? null
    : readFiniteNumber(candidate.scrollRatio);
  const scrollTop = readFiniteNumber(candidate.scrollTop);
  if (
    anchorCardId === undefined
    || anchorOffsetRatio == null
    || scrollRatio === null && candidate.scrollRatio !== null
    || scrollTop == null
    || scrollTop < 0
  ) {
    return null;
  }
  return {
    anchorCardId,
    anchorOffsetRatio: clamp(anchorOffsetRatio, 0, 1),
    scrollRatio: scrollRatio == null ? null : clamp(scrollRatio, 0, 1),
    scrollTop: clamp(scrollTop, 0, MAX_SCROLL_TOP),
  };
}

export function resolveGalleryArchiveRestoreScrollTop(options: {
  anchorHeight: number | null;
  anchorOffsetTop: number | null;
  maxScrollable: number;
  snapshot: GalleryArchiveViewerSessionSnapshot;
}): number {
  const maxScrollable = Math.max(options.maxScrollable, 0);
  const hasAnchor = options.anchorOffsetTop != null
    && options.anchorHeight != null
    && options.anchorHeight > 0;
  const desiredScrollTop = hasAnchor
    ? Number(options.anchorOffsetTop)
      + options.snapshot.anchorOffsetRatio * Number(options.anchorHeight)
    : options.snapshot.scrollRatio != null && maxScrollable > 0
      ? options.snapshot.scrollRatio * maxScrollable
      : options.snapshot.scrollTop;
  return clamp(desiredScrollTop, 0, maxScrollable);
}

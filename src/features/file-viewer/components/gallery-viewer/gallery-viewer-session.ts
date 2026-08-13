export const GALLERY_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const GALLERY_VIEWER_SESSION_ESTIMATED_BYTES = 512;

const IMAGE_ZOOM_MIN = 0.2;
const IMAGE_ZOOM_MAX = 6;
const MAX_ABSOLUTE_OFFSET = 10_000_000;
const MAX_OFFSET_RATIO = 100;
const MAX_SCROLL_TOP = 100_000_000;

export interface GalleryViewerSessionSnapshot {
  activeItemId: number | null;
  gridAnchorItemId: number | null;
  gridAnchorOffsetRatio: number;
  gridScrollRatio: number | null;
  gridScrollTop: number;
  imageOffsetRatioX: number | null;
  imageOffsetRatioY: number | null;
  imageOffsetX: number;
  imageOffsetY: number;
  imageRotateSteps: number;
  imageZoom: number;
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

function readNullableRatio(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = readFiniteNumber(value);
  if (parsed == null) return undefined;
  return clamp(parsed, -MAX_OFFSET_RATIO, MAX_OFFSET_RATIO);
}

export function parseGalleryViewerSessionSnapshot(
  value: unknown,
): GalleryViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GalleryViewerSessionSnapshot>;
  const activeItemId = readNodeId(candidate.activeItemId);
  const gridAnchorItemId = readNodeId(candidate.gridAnchorItemId);
  const gridAnchorOffsetRatio = readFiniteNumber(candidate.gridAnchorOffsetRatio);
  const gridScrollRatio = readNullableRatio(candidate.gridScrollRatio);
  const gridScrollTop = readFiniteNumber(candidate.gridScrollTop);
  const imageOffsetRatioX = readNullableRatio(candidate.imageOffsetRatioX);
  const imageOffsetRatioY = readNullableRatio(candidate.imageOffsetRatioY);
  const imageOffsetX = readFiniteNumber(candidate.imageOffsetX);
  const imageOffsetY = readFiniteNumber(candidate.imageOffsetY);
  const imageRotateSteps = readFiniteNumber(candidate.imageRotateSteps);
  const imageZoom = readFiniteNumber(candidate.imageZoom);
  if (
    activeItemId === undefined
    || gridAnchorItemId === undefined
    || gridAnchorOffsetRatio == null
    || gridScrollRatio === undefined
    || gridScrollTop == null
    || gridScrollTop < 0
    || imageOffsetRatioX === undefined
    || imageOffsetRatioY === undefined
    || imageOffsetX == null
    || imageOffsetY == null
    || imageRotateSteps == null
    || imageZoom == null
    || imageZoom <= 0
  ) {
    return null;
  }
  return {
    activeItemId,
    gridAnchorItemId,
    gridAnchorOffsetRatio: clamp(gridAnchorOffsetRatio, 0, 1),
    gridScrollRatio: gridScrollRatio == null ? null : clamp(gridScrollRatio, 0, 1),
    gridScrollTop: clamp(gridScrollTop, 0, MAX_SCROLL_TOP),
    imageOffsetRatioX,
    imageOffsetRatioY,
    imageOffsetX: clamp(imageOffsetX, -MAX_ABSOLUTE_OFFSET, MAX_ABSOLUTE_OFFSET),
    imageOffsetY: clamp(imageOffsetY, -MAX_ABSOLUTE_OFFSET, MAX_ABSOLUTE_OFFSET),
    imageRotateSteps: ((Math.round(imageRotateSteps) % 4) + 4) % 4,
    imageZoom: clamp(imageZoom, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX),
  };
}

export function resolveGalleryGridRestoreScrollTop(options: {
  cardWidth: number;
  columns: number;
  gap: number;
  itemIds: number[];
  maxScrollable: number;
  snapshot: GalleryViewerSessionSnapshot;
}): number {
  const columns = Math.max(Math.floor(options.columns), 1);
  const rowStride = Math.max(options.cardWidth + options.gap, 1);
  const maxScrollable = Math.max(options.maxScrollable, 0);
  const anchorIndex = options.snapshot.gridAnchorItemId == null
    ? -1
    : options.itemIds.indexOf(options.snapshot.gridAnchorItemId);
  const desiredScrollTop = anchorIndex >= 0
    ? Math.floor(anchorIndex / columns) * rowStride
      + options.snapshot.gridAnchorOffsetRatio * rowStride
    : options.snapshot.gridScrollRatio != null && maxScrollable > 0
      ? options.snapshot.gridScrollRatio * maxScrollable
      : options.snapshot.gridScrollTop;
  return clamp(desiredScrollTop, 0, maxScrollable);
}

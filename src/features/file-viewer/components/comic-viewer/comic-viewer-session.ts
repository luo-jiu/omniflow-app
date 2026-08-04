export const COMIC_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const COMIC_VIEWER_SESSION_ESTIMATED_BYTES = 512;

const MAX_SCROLL_TOP = 100_000_000;
const MAX_PAGE_NUMBER = 10_000_000;
const MAX_FLIP_OFFSET = 10_000_000;

export type ComicReaderLayoutMode = 'scroll' | 'flip';
export type ComicScrollColumnMode = 1 | 2;

export interface ComicPageItem {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  url: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export interface ComicViewerSessionSnapshot {
  anchorPageId: number | null;
  anchorOffsetRatio: number;
  currentPageNumber: number;
  flipOffsetX: number;
  flipOffsetY: number;
  flipRotateSteps: number;
  flipZoomCustomized: boolean;
  flipZoomScale: number;
  layoutMode: ComicReaderLayoutMode;
  scrollColumnMode: ComicScrollColumnMode;
  scrollPageGapPx: number;
  scrollRatio: number | null;
  scrollTop: number;
  scrollZoomScale: number;
  updatedAt: string;
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

export function parseComicViewerSessionSnapshot(value: unknown): ComicViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ComicViewerSessionSnapshot>;
  const anchorPageId = readNodeId(candidate.anchorPageId);
  const anchorOffsetRatio = readFiniteNumber(candidate.anchorOffsetRatio);
  const currentPageNumber = readFiniteNumber(candidate.currentPageNumber);
  const flipOffsetX = readFiniteNumber(candidate.flipOffsetX);
  const flipOffsetY = readFiniteNumber(candidate.flipOffsetY);
  const flipRotateSteps = readFiniteNumber(candidate.flipRotateSteps);
  const flipZoomScale = readFiniteNumber(candidate.flipZoomScale);
  const scrollPageGapPx = readFiniteNumber(candidate.scrollPageGapPx);
  const scrollRatio = candidate.scrollRatio === null ? null : readFiniteNumber(candidate.scrollRatio);
  const scrollTop = readFiniteNumber(candidate.scrollTop);
  const scrollZoomScale = readFiniteNumber(candidate.scrollZoomScale);
  if (
    anchorPageId === undefined
    || anchorOffsetRatio == null
    || currentPageNumber == null
    || currentPageNumber < 0
    || flipOffsetX == null
    || flipOffsetY == null
    || flipRotateSteps == null
    || typeof candidate.flipZoomCustomized !== 'boolean'
    || flipZoomScale == null
    || (candidate.layoutMode !== 'scroll' && candidate.layoutMode !== 'flip')
    || (candidate.scrollColumnMode !== 1 && candidate.scrollColumnMode !== 2)
    || scrollPageGapPx == null
    || (scrollRatio === null && candidate.scrollRatio !== null)
    || scrollTop == null
    || scrollTop < 0
    || scrollZoomScale == null
    || typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    anchorPageId,
    anchorOffsetRatio: clamp(anchorOffsetRatio, 0, 1),
    currentPageNumber: clamp(Math.floor(currentPageNumber), 0, MAX_PAGE_NUMBER),
    flipOffsetX: clamp(flipOffsetX, -MAX_FLIP_OFFSET, MAX_FLIP_OFFSET),
    flipOffsetY: clamp(flipOffsetY, -MAX_FLIP_OFFSET, MAX_FLIP_OFFSET),
    flipRotateSteps: ((Math.round(flipRotateSteps) % 4) + 4) % 4,
    flipZoomCustomized: candidate.flipZoomCustomized,
    flipZoomScale: clamp(flipZoomScale, 0.4, 4.2),
    layoutMode: candidate.layoutMode,
    scrollColumnMode: candidate.scrollColumnMode,
    scrollPageGapPx: clamp(Math.round(scrollPageGapPx), 0, 100),
    scrollRatio: scrollRatio == null ? null : clamp(scrollRatio, 0, 1),
    scrollTop: clamp(scrollTop, 0, MAX_SCROLL_TOP),
    scrollZoomScale: clamp(scrollZoomScale, 0.45, 3.2),
    updatedAt: candidate.updatedAt,
  };
}

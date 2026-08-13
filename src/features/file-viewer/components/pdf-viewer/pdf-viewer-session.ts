export const PDF_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const PDF_VIEWER_SESSION_ESTIMATED_BYTES = 256;

export interface PdfViewerSnapshot {
  currentPage: number;
  zoom: number;
  scrollTop: number;
  scrollRatio: number;
  anchorPage: number;
  anchorOffsetRatio: number;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeRatio(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

export function parsePdfViewerSnapshot(value: unknown): PdfViewerSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PdfViewerSnapshot>;
  const currentPage = readFiniteNumber(candidate.currentPage);
  const zoom = readFiniteNumber(candidate.zoom);
  const scrollTop = readFiniteNumber(candidate.scrollTop);
  const scrollRatio = readFiniteNumber(candidate.scrollRatio);
  const anchorPage = readFiniteNumber(candidate.anchorPage);
  const anchorOffsetRatio = readFiniteNumber(candidate.anchorOffsetRatio);
  if (
    currentPage == null
    || currentPage < 1
    || zoom == null
    || zoom <= 0
    || scrollTop == null
    || scrollTop < 0
    || scrollRatio == null
    || anchorPage == null
    || anchorPage < 1
    || anchorOffsetRatio == null
  ) {
    return null;
  }
  return {
    currentPage: Math.max(Math.round(currentPage), 1),
    zoom,
    scrollTop,
    scrollRatio: normalizeRatio(scrollRatio),
    anchorPage: Math.max(Math.round(anchorPage), 1),
    anchorOffsetRatio: normalizeRatio(anchorOffsetRatio),
  };
}

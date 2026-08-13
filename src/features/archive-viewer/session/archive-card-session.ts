export const ARCHIVE_CARD_SESSION_SCHEMA_VERSION = 1;
export const ARCHIVE_CARD_SESSION_ESTIMATED_BYTES = 256;

const MAX_SCROLL_TOP = 100_000_000;

export interface ArchiveCardSessionSnapshot {
  anchorCardId: number | null;
  anchorOffsetRatio: number;
  scrollRatio: number | null;
  scrollTop: number;
  selectedCardId: number | null;
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

export function parseArchiveCardSessionSnapshot(value: unknown): ArchiveCardSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ArchiveCardSessionSnapshot>;
  const anchorCardId = readNodeId(candidate.anchorCardId);
  const anchorOffsetRatio = readFiniteNumber(candidate.anchorOffsetRatio);
  const scrollRatio = candidate.scrollRatio === null ? null : readFiniteNumber(candidate.scrollRatio);
  const scrollTop = readFiniteNumber(candidate.scrollTop);
  const selectedCardId = readNodeId(candidate.selectedCardId);
  if (
    anchorCardId === undefined
    || anchorOffsetRatio == null
    || (scrollRatio === null && candidate.scrollRatio !== null)
    || scrollTop == null
    || scrollTop < 0
    || selectedCardId === undefined
  ) {
    return null;
  }
  return {
    anchorCardId,
    anchorOffsetRatio: clamp(anchorOffsetRatio, 0, 1),
    scrollRatio: scrollRatio == null ? null : clamp(scrollRatio, 0, 1),
    scrollTop: clamp(scrollTop, 0, MAX_SCROLL_TOP),
    selectedCardId,
  };
}

export function resolveArchiveCardRestoreScrollTop(options: {
  anchorHeight: number | null;
  anchorOffsetTop: number | null;
  maxScrollable: number;
  snapshot: ArchiveCardSessionSnapshot;
}): number {
  const maxScrollable = Math.max(options.maxScrollable, 0);
  const hasAnchor = options.anchorOffsetTop != null
    && options.anchorHeight != null
    && options.anchorHeight > 0;
  const desiredScrollTop = hasAnchor
    ? Number(options.anchorOffsetTop) + options.snapshot.anchorOffsetRatio * Number(options.anchorHeight)
    : options.snapshot.scrollRatio != null && maxScrollable > 0
      ? options.snapshot.scrollRatio * maxScrollable
      : options.snapshot.scrollTop;
  return clamp(desiredScrollTop, 0, maxScrollable);
}

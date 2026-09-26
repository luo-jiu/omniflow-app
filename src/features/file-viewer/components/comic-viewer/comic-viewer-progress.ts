export function getComicScrollDockProgress(scrollRatio: number): number {
  return Math.min(Math.max(Number.isFinite(scrollRatio) ? scrollRatio : 0, 0), 1);
}

/**
 * Maps a rail ratio to a page row only to pre-render enough content before the
 * existing scroll restoration path applies the exact physical scroll ratio.
 */
export function getComicScrollJumpPosition(progress: number, rowCount: number) {
  const safeRowCount = Math.max(Math.floor(rowCount), 1);
  const safeProgress = Math.min(Math.max(Number.isFinite(progress) ? progress : 0, 0), 1);
  const rowPosition = safeProgress * safeRowCount;
  const targetRow = Math.min(Math.floor(rowPosition), safeRowCount - 1);
  return {
    rowPosition,
    targetRow,
    rowOffsetRatio: Math.min(Math.max(rowPosition - targetRow, 0), 1),
  };
}

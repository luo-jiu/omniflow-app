export const QQ_MUSIC_LYRICS_LIST_BREAKPOINT = 760;
export const MIN_QQ_MUSIC_LYRICS_LIST_WIDTH = 220;
export const DEFAULT_MIN_QQ_MUSIC_LYRICS_LIST_WIDTH = 260;
export const QQ_MUSIC_LYRICS_LIST_RATIO = 0.34;
export const COMPACT_QQ_MUSIC_LYRICS_LIST_RATIO = 0.4;
export const QQ_MUSIC_LYRICS_LIST_KEYBOARD_STEP = 12;
export const MIN_QQ_MUSIC_LYRICS_STAGE_HEIGHT = 156;
export const QQ_MUSIC_LYRICS_STAGE_RATIO = 0.42;
export const QQ_MUSIC_LYRICS_STAGE_KEYBOARD_STEP = 12;

export type QQMusicLyricsListWidthBounds = {
  max: number;
  min: number;
};

export type QQMusicLyricsStageHeightBounds = {
  max: number;
  min: number;
};

export type QQMusicLyricsScrollMetrics = {
  itemHeight: number;
  itemTop: number;
  scrollHeight: number;
  scrollTop: number;
  viewportHeight: number;
};

export type QQMusicLyricsFollowTarget = {
  cueIndex: number;
  songId: number;
};

export function getQQMusicLyricsListWidthBounds(containerWidth: number): QQMusicLyricsListWidthBounds {
  const normalizedContainerWidth = Number.isFinite(containerWidth)
    ? Math.max(0, containerWidth)
    : 0;
  const compact = normalizedContainerWidth <= QQ_MUSIC_LYRICS_LIST_BREAKPOINT;
  const min = compact
    ? MIN_QQ_MUSIC_LYRICS_LIST_WIDTH
    : DEFAULT_MIN_QQ_MUSIC_LYRICS_LIST_WIDTH;
  const ratio = compact
    ? COMPACT_QQ_MUSIC_LYRICS_LIST_RATIO
    : QQ_MUSIC_LYRICS_LIST_RATIO;
  return {
    max: Math.max(min, Math.round(normalizedContainerWidth * ratio)),
    min,
  };
}

export function clampQQMusicLyricsListWidth(
  width: number,
  bounds: QQMusicLyricsListWidthBounds,
): number {
  if (!Number.isFinite(width)) return bounds.max;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function getQQMusicLyricsListKeyboardWidth(
  currentWidth: number,
  key: string,
  bounds: QQMusicLyricsListWidthBounds,
): number | null {
  if (key === 'ArrowLeft') {
    return clampQQMusicLyricsListWidth(
      currentWidth - QQ_MUSIC_LYRICS_LIST_KEYBOARD_STEP,
      bounds,
    );
  }
  if (key === 'ArrowRight') {
    return clampQQMusicLyricsListWidth(
      currentWidth + QQ_MUSIC_LYRICS_LIST_KEYBOARD_STEP,
      bounds,
    );
  }
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  return null;
}

export function getQQMusicLyricsStageHeightBounds(
  containerHeight: number,
): QQMusicLyricsStageHeightBounds {
  const normalizedContainerHeight = Number.isFinite(containerHeight)
    ? Math.max(0, containerHeight)
    : 0;
  const max = Math.max(
    MIN_QQ_MUSIC_LYRICS_STAGE_HEIGHT,
    Math.round(normalizedContainerHeight * QQ_MUSIC_LYRICS_STAGE_RATIO),
  );
  return {
    max,
    min: MIN_QQ_MUSIC_LYRICS_STAGE_HEIGHT,
  };
}

export function clampQQMusicLyricsStageHeight(
  height: number,
  bounds: QQMusicLyricsStageHeightBounds,
): number {
  if (!Number.isFinite(height)) return bounds.max;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(height)));
}

export function getQQMusicLyricsStageKeyboardHeight(
  currentHeight: number,
  key: string,
  bounds: QQMusicLyricsStageHeightBounds,
): number | null {
  if (key === 'ArrowUp') {
    return clampQQMusicLyricsStageHeight(
      currentHeight - QQ_MUSIC_LYRICS_STAGE_KEYBOARD_STEP,
      bounds,
    );
  }
  if (key === 'ArrowDown') {
    return clampQQMusicLyricsStageHeight(
      currentHeight + QQ_MUSIC_LYRICS_STAGE_KEYBOARD_STEP,
      bounds,
    );
  }
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  return null;
}

export function getQQMusicLyricsCenteredScrollTop({
  itemHeight,
  itemTop,
  scrollHeight,
  scrollTop,
  viewportHeight,
}: QQMusicLyricsScrollMetrics): number {
  const normalizedViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  const normalizedScrollHeight = Number.isFinite(scrollHeight)
    ? Math.max(normalizedViewportHeight, scrollHeight)
    : normalizedViewportHeight;
  const maximumScrollTop = Math.max(0, normalizedScrollHeight - normalizedViewportHeight);
  const nextScrollTop = scrollTop
    + itemTop
    - Math.max(0, (normalizedViewportHeight - itemHeight) / 2);

  if (!Number.isFinite(nextScrollTop)) return 0;
  return Math.min(maximumScrollTop, Math.max(0, nextScrollTop));
}

export function shouldAnimateQQMusicLyricsFollow(
  previous: QQMusicLyricsFollowTarget | null,
  next: QQMusicLyricsFollowTarget,
  reducedMotion: boolean,
): boolean {
  return !reducedMotion
    && previous?.songId === next.songId
    && Math.abs(previous.cueIndex - next.cueIndex) === 1;
}

export const QQ_MUSIC_LYRICS_LIST_BREAKPOINT = 760;
export const MIN_QQ_MUSIC_LYRICS_LIST_WIDTH = 220;
export const DEFAULT_MIN_QQ_MUSIC_LYRICS_LIST_WIDTH = 260;
export const QQ_MUSIC_LYRICS_LIST_RATIO = 0.34;
export const COMPACT_QQ_MUSIC_LYRICS_LIST_RATIO = 0.4;
export const QQ_MUSIC_LYRICS_LIST_KEYBOARD_STEP = 12;

export type QQMusicLyricsListWidthBounds = {
  max: number;
  min: number;
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

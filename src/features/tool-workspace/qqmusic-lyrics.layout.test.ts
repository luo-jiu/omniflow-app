import { describe, expect, it } from 'vitest';

import {
  clampQQMusicLyricsListWidth,
  clampQQMusicLyricsStageHeight,
  getQQMusicLyricsCenteredScrollTop,
  getQQMusicLyricsListKeyboardWidth,
  getQQMusicLyricsListWidthBounds,
  getQQMusicLyricsStageHeightBounds,
  getQQMusicLyricsStageKeyboardHeight,
  shouldAnimateQQMusicLyricsFollow,
} from './qqmusic-lyrics.layout';

describe('QQ Music lyrics list layout', () => {
  it('uses the current responsive list width as the maximum', () => {
    expect(getQQMusicLyricsListWidthBounds(1200)).toEqual({ min: 260, max: 408 });
    expect(getQQMusicLyricsListWidthBounds(700)).toEqual({ min: 220, max: 280 });
  });

  it('clamps widths to the local list boundaries', () => {
    const bounds = getQQMusicLyricsListWidthBounds(1200);
    expect(clampQQMusicLyricsListWidth(100, bounds)).toBe(260);
    expect(clampQQMusicLyricsListWidth(999, bounds)).toBe(408);
    expect(clampQQMusicLyricsListWidth(Number.NaN, bounds)).toBe(408);
  });

  it('supports arrows and Home/End without crossing min or max', () => {
    const bounds = getQQMusicLyricsListWidthBounds(1200);
    expect(getQQMusicLyricsListKeyboardWidth(300, 'ArrowLeft', bounds)).toBe(288);
    expect(getQQMusicLyricsListKeyboardWidth(400, 'ArrowRight', bounds)).toBe(408);
    expect(getQQMusicLyricsListKeyboardWidth(300, 'Home', bounds)).toBe(260);
    expect(getQQMusicLyricsListKeyboardWidth(300, 'End', bounds)).toBe(408);
    expect(getQQMusicLyricsListKeyboardWidth(300, 'Enter', bounds)).toBeNull();
  });
});

describe('QQ Music lyrics stage layout', () => {
  it('uses the current responsive stage height as the maximum', () => {
    expect(getQQMusicLyricsStageHeightBounds(1000)).toEqual({ min: 156, max: 420 });
    expect(getQQMusicLyricsStageHeightBounds(300)).toEqual({ min: 156, max: 156 });
  });

  it('clamps heights to the stage boundaries', () => {
    const bounds = getQQMusicLyricsStageHeightBounds(1000);
    expect(clampQQMusicLyricsStageHeight(120, bounds)).toBe(156);
    expect(clampQQMusicLyricsStageHeight(800, bounds)).toBe(420);
    expect(clampQQMusicLyricsStageHeight(Number.NaN, bounds)).toBe(420);
  });

  it('supports vertical arrows and Home/End without crossing min or max', () => {
    const bounds = getQQMusicLyricsStageHeightBounds(1000);
    expect(getQQMusicLyricsStageKeyboardHeight(300, 'ArrowUp', bounds)).toBe(288);
    expect(getQQMusicLyricsStageKeyboardHeight(414, 'ArrowDown', bounds)).toBe(420);
    expect(getQQMusicLyricsStageKeyboardHeight(300, 'Home', bounds)).toBe(156);
    expect(getQQMusicLyricsStageKeyboardHeight(300, 'End', bounds)).toBe(420);
    expect(getQQMusicLyricsStageKeyboardHeight(300, 'Enter', bounds)).toBeNull();
  });
});

describe('QQ Music lyrics follow scrolling', () => {
  it('centers the focused row inside its own scroll viewport', () => {
    expect(getQQMusicLyricsCenteredScrollTop({
      itemHeight: 40,
      itemTop: 280,
      scrollHeight: 1200,
      scrollTop: 160,
      viewportHeight: 400,
    })).toBe(260);
  });

  it('clamps the first and last rows to the local scroll boundaries', () => {
    expect(getQQMusicLyricsCenteredScrollTop({
      itemHeight: 40,
      itemTop: 8,
      scrollHeight: 1200,
      scrollTop: 0,
      viewportHeight: 400,
    })).toBe(0);
    expect(getQQMusicLyricsCenteredScrollTop({
      itemHeight: 40,
      itemTop: 380,
      scrollHeight: 1200,
      scrollTop: 800,
      viewportHeight: 400,
    })).toBe(800);
  });

  it('only animates an adjacent cue in the same song', () => {
    const previous = { cueIndex: 4, songId: 96439 };
    expect(shouldAnimateQQMusicLyricsFollow(previous, {
      cueIndex: 5,
      songId: 96439,
    }, false)).toBe(true);
    expect(shouldAnimateQQMusicLyricsFollow(previous, {
      cueIndex: 7,
      songId: 96439,
    }, false)).toBe(false);
    expect(shouldAnimateQQMusicLyricsFollow(previous, {
      cueIndex: 5,
      songId: 727870,
    }, false)).toBe(false);
    expect(shouldAnimateQQMusicLyricsFollow(previous, {
      cueIndex: 5,
      songId: 96439,
    }, true)).toBe(false);
  });
});

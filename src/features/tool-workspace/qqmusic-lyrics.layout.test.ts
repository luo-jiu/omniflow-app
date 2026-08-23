import { describe, expect, it } from 'vitest';

import {
  clampQQMusicLyricsListWidth,
  getQQMusicLyricsListKeyboardWidth,
  getQQMusicLyricsListWidthBounds,
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

import { describe, expect, it } from 'vitest';
import { getComicScrollDockProgress, getComicScrollJumpPosition } from './comic-viewer-progress';

describe('comic scroll dock progress', () => {
  it('follows the physical scroll viewport ratio all the way to the bottom', () => {
    expect(getComicScrollDockProgress(0)).toBe(0);
    expect(getComicScrollDockProgress(0.75)).toBeCloseTo(0.75);
    expect(getComicScrollDockProgress(0.99)).toBeCloseTo(0.99);
    expect(getComicScrollDockProgress(1)).toBe(1);
  });

  it('clamps invalid physical ratios', () => {
    expect(getComicScrollDockProgress(-1)).toBe(0);
    expect(getComicScrollDockProgress(2)).toBe(1);
    expect(getComicScrollDockProgress(Number.NaN)).toBe(0);
  });

  it('maps the rail back to a row only for pre-rendering', () => {
    expect(getComicScrollJumpPosition(0.8, 5)).toEqual({ rowPosition: 4, targetRow: 4, rowOffsetRatio: 0 });
    expect(getComicScrollJumpPosition(0.9, 5)).toEqual({ rowPosition: 4.5, targetRow: 4, rowOffsetRatio: 0.5 });
    expect(getComicScrollJumpPosition(1, 5)).toEqual({ rowPosition: 5, targetRow: 4, rowOffsetRatio: 1 });
  });
});

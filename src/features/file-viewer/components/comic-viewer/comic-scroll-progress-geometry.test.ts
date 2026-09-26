import { describe, expect, it } from 'vitest';
import { createComicScrollProgressGeometry, getComicScrollProgressPoint, getComicScrollProgressRatio } from './comic-scroll-progress-geometry';

describe('comic scroll progress rounded rectangle', () => {
  it('wraps around all four sides and projects points back to progress', () => {
    const geometry = createComicScrollProgressGeometry(40, 100)!;
    for (const progress of [0, 0.12, 0.25, 0.5, 0.75, 0.88, 1]) {
      const point = getComicScrollProgressPoint(geometry, progress);
      expect(getComicScrollProgressRatio(geometry, point.x, point.y)).toBeCloseTo(progress, 5);
    }
  });

  it('rejects invalid sizes and clamps points outside the path', () => {
    expect(createComicScrollProgressGeometry(0, 100)).toBeNull();
    const geometry = createComicScrollProgressGeometry(40, 100)!;
    expect(getComicScrollProgressRatio(geometry, -100, -100)).toBeGreaterThanOrEqual(0);
    expect(getComicScrollProgressRatio(geometry, 100, 100)).toBeLessThanOrEqual(1);
  });
});

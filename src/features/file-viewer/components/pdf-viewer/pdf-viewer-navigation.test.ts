import { describe, expect, it } from 'vitest';
import {
  isPdfAnchorLayoutSettled,
  isPdfPageJumpSettled,
  resolvePdfPageJumpTarget,
  resolvePdfViewportAnchor,
} from './pdf-viewer-navigation';

const measuredPages = [
  { pageNumber: 74, top: 1_000, height: 800 },
  { pageNumber: 75, top: 1_816, height: 800 },
  { pageNumber: 76, top: 2_632, height: 800 },
];

describe('PDF viewer page jump navigation', () => {
  it('keeps an estimated jump pending until the target page has an exact DOM position', () => {
    const target = resolvePdfPageJumpTarget({
      exactPageTop: null,
      estimatedPageTop: 42_000,
      maxScrollable: 90_000,
    });

    expect(target).toEqual({
      hasExactTarget: false,
      scrollTop: 42_000,
    });
    expect(isPdfPageJumpSettled({
      actualScrollTop: 42_000,
      targetScrollTop: target.scrollTop,
      hasExactTarget: target.hasExactTarget,
      renderedWindowSettled: true,
    })).toBe(false);
  });

  it('finishes only after the exact target and rendered window are stable', () => {
    const target = resolvePdfPageJumpTarget({
      exactPageTop: 47_250,
      estimatedPageTop: 42_000,
      maxScrollable: 90_000,
    });

    expect(target).toEqual({
      hasExactTarget: true,
      scrollTop: 47_250,
    });
    expect(isPdfPageJumpSettled({
      actualScrollTop: 47_250,
      targetScrollTop: target.scrollTop,
      hasExactTarget: target.hasExactTarget,
      renderedWindowSettled: false,
    })).toBe(false);
    expect(isPdfPageJumpSettled({
      actualScrollTop: 47_250.5,
      targetScrollTop: target.scrollTop,
      hasExactTarget: target.hasExactTarget,
      renderedWindowSettled: true,
    })).toBe(true);
  });

  it('clamps estimated and exact positions to the available scroll range', () => {
    expect(resolvePdfPageJumpTarget({
      exactPageTop: null,
      estimatedPageTop: 120_000,
      maxScrollable: 90_000,
    }).scrollTop).toBe(90_000);

    expect(resolvePdfPageJumpTarget({
      exactPageTop: -20,
      estimatedPageTop: 10_000,
      maxScrollable: 90_000,
    }).scrollTop).toBe(0);
  });

  it('waits for every rendered page through the anchor before restoring its offset', () => {
    const renderedPages = Array.from({ length: 14 }, (_, index) => index + 67);

    expect(isPdfAnchorLayoutSettled({
      anchorPage: 75,
      measuredPages: new Set([67, 68, 69, 70, 71, 72, 73, 74, 75]),
      renderedPages,
    })).toBe(true);
    expect(isPdfAnchorLayoutSettled({
      anchorPage: 75,
      measuredPages: new Set([67, 68, 69, 70, 71, 72, 73, 75]),
      renderedPages,
    })).toBe(false);
  });

  it('does not settle an anchor outside the current render window', () => {
    expect(isPdfAnchorLayoutSettled({
      anchorPage: 75,
      measuredPages: new Set([72, 73, 74]),
      renderedPages: [72, 73, 74],
    })).toBe(false);
  });

  it('resolves the page containing the viewport top', () => {
    expect(resolvePdfViewportAnchor(1_200, measuredPages, 1)).toEqual({
      pageNumber: 74,
      offsetRatio: 0.25,
    });
  });

  it('uses the nearest page top when the viewport is in a page gap', () => {
    expect(resolvePdfViewportAnchor(1_808, measuredPages, 1)).toEqual({
      pageNumber: 75,
      offsetRatio: 0,
    });
  });

  it('uses the first page before the measured range', () => {
    expect(resolvePdfViewportAnchor(900, measuredPages, 1)).toEqual({
      pageNumber: 74,
      offsetRatio: 0,
    });
  });

  it('uses the last page after the measured range', () => {
    expect(resolvePdfViewportAnchor(4_000, measuredPages, 1)).toEqual({
      pageNumber: 76,
      offsetRatio: 1,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  estimateComicViewerHotCostUnits,
  parseComicViewerSessionSnapshot,
} from './comic-viewer-session';

const validSnapshot = {
  anchorPageId: 33,
  anchorOffsetRatio: 0.35,
  currentPageNumber: 12,
  flipOffsetX: 40,
  flipOffsetY: -20,
  flipRotateSteps: 1,
  flipZoomCustomized: true,
  flipZoomScale: 1.4,
  layoutMode: 'flip' as const,
  scrollColumnMode: 2 as const,
  scrollPageGapPx: 12,
  scrollRatio: 0.42,
  scrollTop: 2400,
  scrollZoomScale: 0.9,
  updatedAt: '2026-08-04T00:00:00.000Z',
};

describe('Comic viewer session snapshot', () => {
  it('parses page anchors, reading modes and zoom preferences', () => {
    expect(parseComicViewerSessionSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects invalid modes, identities and non-finite values', () => {
    expect(parseComicViewerSessionSnapshot({ ...validSnapshot, layoutMode: 'grid' })).toBeNull();
    expect(parseComicViewerSessionSnapshot({ ...validSnapshot, anchorPageId: 0 })).toBeNull();
    expect(parseComicViewerSessionSnapshot({ ...validSnapshot, scrollTop: Number.NaN })).toBeNull();
  });

  it('does not return fetched pages or temporary image URLs', () => {
    expect(parseComicViewerSessionSnapshot({
      ...validSnapshot,
      pages: [{ id: 33, url: 'signed-image-url' }],
      visibleCount: 50,
    })).toEqual(validSnapshot);
  });
});

describe('Comic viewer Hot cost', () => {
  it('keeps flip mode at the heavy baseline', () => {
    expect(estimateComicViewerHotCostUnits('flip', 500)).toBe(4);
  });

  it('increases scroll-mode cost by retained image buckets with a safe cap', () => {
    expect(estimateComicViewerHotCostUnits('scroll', 0)).toBe(4);
    expect(estimateComicViewerHotCostUnits('scroll', 12)).toBe(4);
    expect(estimateComicViewerHotCostUnits('scroll', 13)).toBe(5);
    expect(estimateComicViewerHotCostUnits('scroll', 37)).toBe(7);
    expect(estimateComicViewerHotCostUnits('scroll', 500)).toBe(8);
  });
});

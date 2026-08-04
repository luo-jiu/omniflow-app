import { describe, expect, it } from 'vitest';
import { parseComicViewerSessionSnapshot } from './comic-viewer-session';

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

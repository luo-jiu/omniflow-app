import { describe, expect, it } from 'vitest';
import {
  parseGalleryViewerSessionSnapshot,
  resolveGalleryGridRestoreScrollTop,
} from './gallery-viewer-session';

const validSnapshot = {
  activeItemId: 42,
  gridAnchorItemId: 31,
  gridAnchorOffsetRatio: 0.25,
  gridScrollRatio: 0.4,
  gridScrollTop: 1200,
  imageOffsetRatioX: 0.1,
  imageOffsetRatioY: -0.2,
  imageOffsetX: 80,
  imageOffsetY: -60,
  imageRotateSteps: 5,
  imageZoom: 2.5,
};

describe('Gallery viewer session snapshot', () => {
  it('parses stable item identities, grid anchors and image transforms', () => {
    expect(parseGalleryViewerSessionSnapshot(validSnapshot)).toEqual({
      ...validSnapshot,
      imageRotateSteps: 1,
    });
  });

  it('allows a grid-only snapshot and absolute offset fallback', () => {
    expect(parseGalleryViewerSessionSnapshot({
      ...validSnapshot,
      activeItemId: null,
      gridAnchorItemId: null,
      gridScrollRatio: null,
      imageOffsetRatioX: null,
      imageOffsetRatioY: null,
    })).toMatchObject({
      activeItemId: null,
      gridAnchorItemId: null,
      gridScrollRatio: null,
      imageOffsetRatioX: null,
      imageOffsetRatioY: null,
    });
  });

  it('rejects incomplete, non-finite and invalid node identities', () => {
    expect(parseGalleryViewerSessionSnapshot({ imageZoom: 1 })).toBeNull();
    expect(parseGalleryViewerSessionSnapshot({
      ...validSnapshot,
      imageZoom: Number.NaN,
    })).toBeNull();
    expect(parseGalleryViewerSessionSnapshot({
      ...validSnapshot,
      activeItemId: 0,
    })).toBeNull();
  });

  it('restores the same anchor item after the grid column count changes', () => {
    const snapshot = parseGalleryViewerSessionSnapshot(validSnapshot)!;
    expect(resolveGalleryGridRestoreScrollTop({
      cardWidth: 160,
      columns: 2,
      gap: 14,
      itemIds: [10, 20, 31, 40, 50],
      maxScrollable: 2000,
      snapshot,
    })).toBe(174 + 0.25 * 174);
  });

  it('falls back to proportional and then absolute scroll restoration', () => {
    const snapshot = parseGalleryViewerSessionSnapshot(validSnapshot)!;
    expect(resolveGalleryGridRestoreScrollTop({
      cardWidth: 160,
      columns: 3,
      gap: 14,
      itemIds: [10, 20],
      maxScrollable: 2000,
      snapshot,
    })).toBe(800);
    expect(resolveGalleryGridRestoreScrollTop({
      cardWidth: 160,
      columns: 3,
      gap: 14,
      itemIds: [10, 20],
      maxScrollable: 1500,
      snapshot: { ...snapshot, gridScrollRatio: null },
    })).toBe(1200);
  });
});

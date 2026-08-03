import { describe, expect, it } from 'vitest';
import {
  parseGalleryArchiveViewerSessionSnapshot,
  resolveGalleryArchiveRestoreScrollTop,
} from './gallery-archive-viewer-session';

const validSnapshot = {
  anchorCardId: 42,
  anchorOffsetRatio: 0.25,
  scrollRatio: 0.4,
  scrollTop: 900,
};

describe('Gallery archive viewer session snapshot', () => {
  it('parses stable card anchors and scroll fallbacks', () => {
    expect(parseGalleryArchiveViewerSessionSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('allows an empty anchor and absolute fallback', () => {
    expect(parseGalleryArchiveViewerSessionSnapshot({
      ...validSnapshot,
      anchorCardId: null,
      scrollRatio: null,
    })).toMatchObject({
      anchorCardId: null,
      scrollRatio: null,
    });
  });

  it('rejects incomplete, non-finite and invalid card identities', () => {
    expect(parseGalleryArchiveViewerSessionSnapshot({ scrollTop: 0 })).toBeNull();
    expect(parseGalleryArchiveViewerSessionSnapshot({
      ...validSnapshot,
      anchorCardId: 0,
    })).toBeNull();
    expect(parseGalleryArchiveViewerSessionSnapshot({
      ...validSnapshot,
      scrollRatio: Number.NaN,
    })).toBeNull();
  });

  it('prefers the stable card anchor after layout changes', () => {
    const snapshot = parseGalleryArchiveViewerSessionSnapshot(validSnapshot)!;
    expect(resolveGalleryArchiveRestoreScrollTop({
      anchorHeight: 220,
      anchorOffsetTop: 500,
      maxScrollable: 2000,
      snapshot,
    })).toBe(555);
  });

  it('falls back to proportional and then absolute scroll restoration', () => {
    const snapshot = parseGalleryArchiveViewerSessionSnapshot(validSnapshot)!;
    expect(resolveGalleryArchiveRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable: 2000,
      snapshot,
    })).toBe(800);
    expect(resolveGalleryArchiveRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable: 1000,
      snapshot: { ...snapshot, scrollRatio: null },
    })).toBe(900);
  });
});

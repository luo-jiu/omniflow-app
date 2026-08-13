import { describe, expect, it } from 'vitest';
import { parsePdfViewerSnapshot } from './pdf-viewer-session';

describe('PDF viewer session payload', () => {
  it('normalizes valid reading-position snapshots', () => {
    expect(parsePdfViewerSnapshot({
      currentPage: 4.4,
      zoom: 1.25,
      scrollTop: 880,
      scrollRatio: 1.4,
      anchorPage: 4,
      anchorOffsetRatio: -0.2,
    })).toEqual({
      currentPage: 4,
      zoom: 1.25,
      scrollTop: 880,
      scrollRatio: 1,
      anchorPage: 4,
      anchorOffsetRatio: 0,
    });
  });

  it('rejects incomplete or non-finite payloads', () => {
    expect(parsePdfViewerSnapshot({ currentPage: 1 })).toBeNull();
    expect(parsePdfViewerSnapshot({
      currentPage: 1,
      zoom: Number.NaN,
      scrollTop: 0,
      scrollRatio: 0,
      anchorPage: 1,
      anchorOffsetRatio: 0,
    })).toBeNull();
  });
});

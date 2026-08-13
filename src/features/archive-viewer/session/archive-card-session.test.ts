import { describe, expect, it } from 'vitest';
import {
  parseArchiveCardSessionSnapshot,
  resolveArchiveCardRestoreScrollTop,
} from './archive-card-session';

const validSnapshot = {
  anchorCardId: 42,
  anchorOffsetRatio: 0.25,
  scrollRatio: 0.4,
  scrollTop: 900,
  selectedCardId: null,
};

describe('Archive card session snapshot', () => {
  it('parses stable card identities and scroll fallbacks', () => {
    expect(parseArchiveCardSessionSnapshot(validSnapshot)).toEqual(validSnapshot);
    expect(parseArchiveCardSessionSnapshot({
      ...validSnapshot,
      selectedCardId: 84,
    })?.selectedCardId).toBe(84);
  });

  it('rejects temporary or incomplete payload shapes', () => {
    expect(parseArchiveCardSessionSnapshot({ scrollTop: 0 })).toBeNull();
    expect(parseArchiveCardSessionSnapshot({ ...validSnapshot, anchorCardId: 0 })).toBeNull();
    expect(parseArchiveCardSessionSnapshot({ ...validSnapshot, scrollRatio: Number.NaN })).toBeNull();
    expect(parseArchiveCardSessionSnapshot({ ...validSnapshot, cards: [{ coverUrl: 'signed' }] })).toEqual(validSnapshot);
  });

  it('prefers the stable anchor, then ratio, then absolute position', () => {
    const snapshot = parseArchiveCardSessionSnapshot(validSnapshot)!;
    expect(resolveArchiveCardRestoreScrollTop({
      anchorHeight: 220,
      anchorOffsetTop: 500,
      maxScrollable: 2000,
      snapshot,
    })).toBe(555);
    expect(resolveArchiveCardRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable: 2000,
      snapshot,
    })).toBe(800);
    expect(resolveArchiveCardRestoreScrollTop({
      anchorHeight: null,
      anchorOffsetTop: null,
      maxScrollable: 1000,
      snapshot: { ...snapshot, scrollRatio: null },
    })).toBe(900);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createTextContentRevision,
  parseTextViewerSessionSnapshot,
} from './text-viewer-session';

describe('Text viewer session payload', () => {
  it('normalizes valid editor UI snapshots', () => {
    expect(parseTextViewerSessionSnapshot({
      fontSize: 15,
      wordWrap: true,
      selectionAnchor: 4.4,
      selectionHead: 8.6,
      topLine: 12.2,
      topLineOffset: -4,
      scrollTop: 900,
      scrollLeft: -8,
    })).toEqual({
      fontSize: 15,
      wordWrap: true,
      selectionAnchor: 4,
      selectionHead: 9,
      topLine: 12,
      topLineOffset: 0,
      scrollTop: 900,
      scrollLeft: 0,
    });
  });

  it('rejects incomplete or non-finite editor snapshots', () => {
    expect(parseTextViewerSessionSnapshot({ fontSize: 15 })).toBeNull();
    expect(parseTextViewerSessionSnapshot({
      fontSize: Number.NaN,
      wordWrap: false,
      selectionAnchor: 0,
      selectionHead: 0,
      topLine: 1,
      topLineOffset: 0,
      scrollTop: 0,
      scrollLeft: 0,
    })).toBeNull();
  });

  it('creates stable SHA-256 content revisions', async () => {
    expect(await createTextContentRevision('hello')).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { parseAsmrViewerSessionSnapshot } from './asmr-viewer-session';

const validSnapshot = {
  currentAudioId: 8,
  currentAudioParentNodeId: 2,
  listAnchorItemId: 9,
  listAnchorOffsetRatio: 0.2,
  listScrollRatio: 0.5,
  listScrollTop: 320,
  pathStack: [{ id: 1, name: 'ROOT' }, { id: 2, name: 'Disc 1' }],
  selectedId: 9,
};

describe('ASMR viewer session snapshot', () => {
  it('accepts stable path, selection and list anchors', () => {
    expect(parseAsmrViewerSessionSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects invalid paths and node identities', () => {
    expect(parseAsmrViewerSessionSnapshot({ ...validSnapshot, pathStack: [] })).toBeNull();
    expect(parseAsmrViewerSessionSnapshot({ ...validSnapshot, selectedId: 0 })).toBeNull();
    expect(parseAsmrViewerSessionSnapshot({ ...validSnapshot, currentAudioParentNodeId: 0 })).toBeNull();
    expect(parseAsmrViewerSessionSnapshot({ ...validSnapshot, listScrollTop: Number.NaN })).toBeNull();
  });

  it('does not admit temporary URLs or fetched node arrays into the parsed payload', () => {
    const parsed = parseAsmrViewerSessionSnapshot({
      ...validSnapshot,
      items: [{ id: 9 }],
      coverUrl: 'signed-cover-url',
      currentAudioSrc: 'signed-audio-url',
    });
    expect(parsed).toEqual(validSnapshot);
  });
});

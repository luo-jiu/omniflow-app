import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearQQMusicLyricsSaveDirectory,
  loadQQMusicLyricsSaveDirectory,
  saveQQMusicLyricsSaveDirectory,
} from './qqmusic-lyrics.preferences';

function createStorage() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
}

describe('QQ music lyrics preferences', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the last directory independently for each library', () => {
    saveQQMusicLyricsSaveDirectory(2, { parentId: 21, pathLabel: '/music/lyrics' });
    saveQQMusicLyricsSaveDirectory(3, { parentId: 31, pathLabel: '/win/lyrics' });

    expect(loadQQMusicLyricsSaveDirectory(2)).toEqual({
      parentId: 21,
      pathLabel: '/music/lyrics',
    });
    expect(loadQQMusicLyricsSaveDirectory(3)).toEqual({
      parentId: 31,
      pathLabel: '/win/lyrics',
    });
  });

  it('removes malformed JSON instead of exposing an invalid default', () => {
    storage.setItem('qqmusic-lyrics-preferences:v1:3', '{broken');

    expect(loadQQMusicLyricsSaveDirectory(3)).toBeNull();
    expect(storage.getItem('qqmusic-lyrics-preferences:v1:3')).toBeNull();
  });

  it('clears a directory that no longer exists', () => {
    saveQQMusicLyricsSaveDirectory(3, { parentId: 31, pathLabel: '/win/lyrics' });

    clearQQMusicLyricsSaveDirectory(3);

    expect(loadQQMusicLyricsSaveDirectory(3)).toBeNull();
  });

  it.each([
    { parentId: 0, pathLabel: '/lyrics' },
    { parentId: -1, pathLabel: '/lyrics' },
    { parentId: 1.5, pathLabel: '/lyrics' },
    { parentId: 12, pathLabel: '   ' },
  ])('rejects an invalid directory preference: %o', (saveDirectory) => {
    storage.setItem('qqmusic-lyrics-preferences:v1:3', JSON.stringify({ saveDirectory }));

    expect(loadQQMusicLyricsSaveDirectory(3)).toBeNull();
    expect(storage.getItem('qqmusic-lyrics-preferences:v1:3')).toBeNull();
  });
});

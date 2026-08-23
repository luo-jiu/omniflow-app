import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { qrc } from 'smart-lyric';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { parseTimedText } from '@/features/file-viewer/timed-text/subtitle';
import {
  previewQQMusicLyrics,
  searchQQMusicLyrics,
  type QQMusicLyricsServicePaths,
} from './qqMusicLyricsService';

function openDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(database));
  });
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe.runIf(process.platform === 'darwin')('QQ Music lyrics service', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  async function createFixture(): Promise<QQMusicLyricsServicePaths> {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-qqmusic-lyrics-'));
    temporaryDirectories.push(directory);
    const libraryDatabasePath = path.join(directory, 'qqmusic.sqlite');
    const cacheDatabasePath = path.join(directory, 'rrdbcache.sqlite');
    const library = await openDatabase(libraryDatabasePath);
    const cache = await openDatabase(cacheDatabasePath);
    const xml = '<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[0,1000]你(0,500)好(500,500)"/></LyricInfo></QrcInfos>';
    const encrypted = qrc.encrypt(xml);
    try {
      await exec(library, `
        CREATE TABLE SONGS (
          id INTEGER PRIMARY KEY,
          K_SONG_RESERVE1 TEXT,
          name TEXT,
          singer TEXT
        );
        INSERT INTO SONGS VALUES (253397657, 'song-mid', 'WATER / demo', 'A-39');
        INSERT INTO SONGS VALUES (2, 'other-mid', 'Other', 'Singer');
      `);
      await new Promise<void>((resolve, reject) => {
        cache.exec(`
          CREATE TABLE Cache (
            keyId TEXT PRIMARY KEY,
            type INTEGER,
            size INTEGER,
            accessTime INTEGER,
            data BLOB
          );
        `, (error) => {
          if (error) {
            reject(error);
            return;
          }
          cache.run(
            'INSERT INTO Cache VALUES (?, 0, ?, 0, ?)',
            ['253397657.qrc', encrypted.length, encrypted],
            (insertError) => {
              if (insertError) {
                reject(insertError);
                return;
              }
              cache.run(
                'INSERT INTO Cache VALUES (?, 0, ?, -1, ?)',
                ['999.qrc', encrypted.length, encrypted],
                fallbackError => fallbackError ? reject(fallbackError) : resolve(),
              );
            },
          );
        });
      });
    } finally {
      await Promise.all([close(library), close(cache)]);
    }
    return { cacheDatabasePath, libraryDatabasePath };
  }

  it('searches songs and reports local QRC availability', async () => {
    const paths = await createFixture();

    await expect(searchQQMusicLyrics({ query: 'WAT' }, paths)).resolves.toEqual([
      expect.objectContaining({
        cachedKinds: ['qrc'],
        name: 'WATER / demo',
        qrcBytes: expect.any(Number),
        singer: 'A-39',
        songId: 253397657,
      }),
    ]);
  });

  it('lists songs that already have local QRC cache entries', async () => {
    const paths = await createFixture();

    await expect(searchQQMusicLyrics({ cachedOnly: true }, paths)).resolves.toEqual([
      expect.objectContaining({
        cachedKinds: ['qrc'],
        name: 'WATER / demo',
        songId: 253397657,
      }),
      expect.objectContaining({
        cachedKinds: ['qrc'],
        name: 'SongID 999',
        singer: '未知歌手',
        songId: 999,
      }),
    ]);
    await expect(searchQQMusicLyrics({ cachedOnly: true, query: 'Other' }, paths)).resolves.toEqual([]);
    await expect(searchQQMusicLyrics({ cachedOnly: true, limit: 1, offset: 1 }, paths)).resolves.toEqual([
      expect.objectContaining({ songId: 999 }),
    ]);
  });

  it('keeps all-library pagination moving beyond the cached-song candidate limit', async () => {
    const paths = await createFixture();
    const library = await openDatabase(paths.libraryDatabasePath);
    try {
      const values = Array.from({ length: 2_100 }, (_, index) => {
        const id = 1_000_000 + index;
        return `(${id}, 'mid-${id}', 'Song ${id}', 'Singer')`;
      }).join(',');
      await exec(library, `
        INSERT INTO SONGS (id, K_SONG_RESERVE1, name, singer)
        VALUES ${values};
      `);
    } finally {
      await close(library);
    }

    await expect(searchQQMusicLyrics({ limit: 1, offset: 2_050 }, paths)).resolves.toHaveLength(1);
  });

  it('rejects an excessive search offset instead of repeating a capped page', async () => {
    const paths = await createFixture();

    await expect(searchQQMusicLyrics({ offset: 100_001 }, paths)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('decodes cached QRC in memory and creates a safe XML filename', async () => {
    const paths = await createFixture();

    const preview = await previewQQMusicLyrics(253397657, paths);

    expect(preview.fileName).toBe('WATER _ demo - A-39 [253397657].qrc.xml');
    expect(preview.qrcXml).toContain('LyricContent="[0,1000]你(0,500)好(500,500)"');
  });

  it('previews cached QRC even when QQMusic no longer has song metadata', async () => {
    const paths = await createFixture();

    const preview = await previewQQMusicLyrics(999, paths);

    expect(preview.fileName).toBe('SongID 999 - 未知歌手 [999].qrc.xml');
    expect(preview.song.songId).toBe(999);
  });

  it('reports invalid decrypted content as a QRC decode error', async () => {
    const paths = await createFixture();
    const cache = await openDatabase(paths.cacheDatabasePath);
    try {
      const invalidXml = qrc.encrypt('not a QRC document');
      await new Promise<void>((resolve, reject) => {
        cache.run(
          'UPDATE Cache SET size = ?, data = ? WHERE keyId = ?',
          [invalidXml.length, invalidXml, '253397657.qrc'],
          error => error ? reject(error) : resolve(),
        );
      });
    } finally {
      await close(cache);
    }

    await expect(previewQQMusicLyrics(253397657, paths)).rejects.toMatchObject({
      code: 'QRC_DECODE_FAILED',
    });
  });
});

describe.runIf(
  process.platform === 'darwin'
  && Boolean(process.env.OMNIFLOW_QQMUSIC_TEST_QUERY)
  && Boolean(process.env.OMNIFLOW_QQMUSIC_TEST_SONG_ID),
)('QQ Music lyrics local integration', () => {
  it('reads and decodes an explicitly selected local cache entry', async () => {
    const query = String(process.env.OMNIFLOW_QQMUSIC_TEST_QUERY);
    const songId = Number(process.env.OMNIFLOW_QQMUSIC_TEST_SONG_ID);
    const songs = await searchQQMusicLyrics({ query });
    const song = songs.find(item => item.songId === songId);
    expect(song?.cachedKinds).toContain('qrc');

    const preview = await previewQQMusicLyrics(songId);
    const cues = parseTimedText(preview.qrcXml);
    const words = cues.reduce((sum, cue) => sum + (cue.segmentLines?.[0]?.length || 0), 0);
    expect(cues.length).toBeGreaterThan(0);
    expect(words).toBeGreaterThan(0);
    console.info(JSON.stringify({
      fileName: preview.fileName,
      firstLine: cues[0]?.lines[0],
      lastLine: cues.at(-1)?.lines[0],
      lines: cues.length,
      songId,
      words,
      xmlCharacters: preview.qrcXml.length,
    }));
  });
});

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bplistParser from 'bplist-parser';
import { qrc } from 'smart-lyric';
import sqlite3 from 'sqlite3';

import type {
  QQMusicLyricsErrorCode,
  QQMusicLyricsPreview,
  QQMusicLyricsSearchInput,
  QQMusicLyricsSong,
  QQMusicLyricsStatus,
} from '@/shared/qqmusic-lyrics/qqmusic-lyrics.types';

const QQMUSIC_APPLICATION_SUPPORT = path.join(
  os.homedir(),
  'Library',
  'Containers',
  'com.tencent.QQMusicMac',
  'Data',
  'Library',
  'Application Support',
  'QQMusicMac',
);
const DEFAULT_LIBRARY_DATABASE_PATH = path.join(QQMUSIC_APPLICATION_SUPPORT, 'qqmusic.sqlite');
const DEFAULT_CACHE_DATABASE_PATH = path.join(QQMUSIC_APPLICATION_SUPPORT, 'iRRCache', 'rrdbcache.sqlite');
const MAX_SEARCH_LENGTH = 120;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 50;
const MAX_CACHED_SONG_CANDIDATES = 2_000;
const MAX_SEARCH_OFFSET = 100_000;
const SONG_ID_QUERY_CHUNK_SIZE = 500;
const SAFE_FILE_PART_MAX_BYTES = 90;

interface SongRow {
  id: number;
  name: string | null;
  singer: string | null;
  song_mid: string | null;
}

interface CacheMetadataRow {
  data_length: number;
  key_id: string;
  size: number;
}

interface CachePayloadRow extends CacheMetadataRow {
  data: Buffer;
}

interface CacheKeyRow {
  key_id: string;
}

export interface QQMusicLyricsServicePaths {
  cacheDatabasePath: string;
  libraryDatabasePath: string;
}

export class QQMusicLyricsServiceError extends Error {
  readonly code: QQMusicLyricsErrorCode;

  constructor(code: QQMusicLyricsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    this.name = 'QQMusicLyricsServiceError';
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function defaultPaths(): QQMusicLyricsServicePaths {
  return {
    cacheDatabasePath: DEFAULT_CACHE_DATABASE_PATH,
    libraryDatabasePath: DEFAULT_LIBRARY_DATABASE_PATH,
  };
}

function openReadonlyDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function all<T>(database: sqlite3.Database, sql: string, parameters: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function get<T>(database: sqlite3.Database, sql: string, parameters: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get<T>(sql, parameters, (error, row) => error ? reject(error) : resolve(row));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

async function withReadonlyDatabase<T>(
  databasePath: string,
  task: (database: sqlite3.Database) => Promise<T>,
): Promise<T> {
  let database: sqlite3.Database | null = null;
  try {
    database = await openReadonlyDatabase(databasePath);
    return await task(database);
  } finally {
    if (database) await close(database).catch(() => undefined);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, character => `\\${character}`);
}

function normalizeSearchInput(input: QQMusicLyricsSearchInput): Required<QQMusicLyricsSearchInput> {
  const query = String(input?.query || '').replace(/\s+/gu, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
  const singer = String(input?.singer || '').replace(/\s+/gu, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
  const requestedLimit = Math.floor(Number(input?.limit) || DEFAULT_SEARCH_LIMIT);
  const requestedOffset = Math.floor(Number(input?.offset) || 0);
  if (requestedOffset > MAX_SEARCH_OFFSET) {
    throw new QQMusicLyricsServiceError(
      'INVALID_REQUEST',
      `搜索偏移量不能超过 ${MAX_SEARCH_OFFSET}`,
    );
  }
  return {
    cachedOnly: input?.cachedOnly === true,
    limit: Math.min(MAX_SEARCH_LIMIT, Math.max(1, requestedLimit)),
    offset: Math.max(0, requestedOffset),
    query,
    singer,
  };
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function requireSupportedPlatform(): void {
  if (process.platform !== 'darwin') {
    throw new QQMusicLyricsServiceError('UNSUPPORTED_PLATFORM', 'QQ 音乐歌词缓存读取目前仅支持 macOS');
  }
}

function requireDatabase(databasePath: string, code: QQMusicLyricsErrorCode, label: string): void {
  if (!existsSync(databasePath)) {
    throw new QQMusicLyricsServiceError(code, `未找到 QQ 音乐${label}数据库，请确认已安装并使用过 QQ音乐Mac版`);
  }
}

function cacheKind(key: string): QQMusicLyricsSong['cachedKinds'][number] | null {
  if (key.endsWith('.qrc')) return 'qrc';
  if (key.endsWith('_trans.lrc')) return 'translation';
  if (key.endsWith('_yinyi.lrc')) return 'transliteration';
  if (key.endsWith('.lrc')) return 'lrc';
  return null;
}

function toSong(row: SongRow, cacheRows: CacheMetadataRow[]): QQMusicLyricsSong {
  const cachedKinds = cacheRows
    .map(item => cacheKind(item.key_id))
    .filter((item): item is QQMusicLyricsSong['cachedKinds'][number] => Boolean(item));
  const qrcRow = cacheRows.find(item => item.key_id.endsWith('.qrc'));
  return {
    cachedKinds: Array.from(new Set(cachedKinds)),
    name: String(row.name || '未知歌曲'),
    ...(qrcRow ? { qrcBytes: Number(qrcRow.size) || Number(qrcRow.data_length) || 0 } : {}),
    singer: String(row.singer || '未知歌手'),
    songId: Number(row.id),
    songMid: String(row.song_mid || ''),
  };
}

function fallbackSongRow(songId: number): SongRow {
  return {
    id: songId,
    name: `SongID ${songId}`,
    singer: '未知歌手',
    song_mid: '',
  };
}

async function loadCacheRows(databasePath: string, songIds: number[]): Promise<Map<number, CacheMetadataRow[]>> {
  const rowsBySong = new Map<number, CacheMetadataRow[]>();
  if (songIds.length === 0) return rowsBySong;
  const keys = songIds.flatMap(songId => [
    `${songId}.qrc`,
    `${songId}.lrc`,
    `${songId}_trans.lrc`,
    `${songId}_yinyi.lrc`,
  ]);
  const placeholders = keys.map(() => '?').join(',');
  const rows = await withReadonlyDatabase(databasePath, database => all<CacheMetadataRow>(database, `
    SELECT keyId AS key_id, size, length(data) AS data_length
    FROM Cache
    WHERE keyId IN (${placeholders})
  `, keys));
  rows.forEach((row) => {
    const match = /^(\d+)/u.exec(row.key_id);
    if (!match) return;
    const songId = Number(match[1]);
    rowsBySong.set(songId, [...(rowsBySong.get(songId) || []), row]);
  });
  return rowsBySong;
}

async function loadCachedQrcSongIds(databasePath: string): Promise<number[]> {
  const rows = await withReadonlyDatabase(databasePath, database => all<CacheKeyRow>(database, `
    SELECT keyId AS key_id
    FROM Cache
    WHERE keyId GLOB '[0-9]*.qrc'
    ORDER BY accessTime DESC, rowid DESC
    LIMIT ?
  `, [MAX_CACHED_SONG_CANDIDATES]));
  const songIds: number[] = [];
  const seen = new Set<number>();
  rows.forEach((row) => {
    const match = /^(\d+)\.qrc$/u.exec(row.key_id);
    const songId = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(songId) || songId <= 0 || seen.has(songId)) return;
    seen.add(songId);
    songIds.push(songId);
  });
  return songIds;
}

async function loadCachedSongs(
  libraryDatabasePath: string,
  cacheDatabasePath: string,
  input: Required<QQMusicLyricsSearchInput>,
): Promise<QQMusicLyricsSong[]> {
  const cachedSongIds = await loadCachedQrcSongIds(cacheDatabasePath);
  if (cachedSongIds.length === 0) return [];
  const songsById = new Map<number, SongRow>();
  for (let offset = 0; offset < cachedSongIds.length; offset += SONG_ID_QUERY_CHUNK_SIZE) {
    const songIds = cachedSongIds.slice(offset, offset + SONG_ID_QUERY_CHUNK_SIZE);
    const rows = await withReadonlyDatabase(libraryDatabasePath, database => all<SongRow>(database, `
      SELECT id, K_SONG_RESERVE1 AS song_mid, name, singer
      FROM SONGS
      WHERE id IN (${songIds.map(() => '?').join(',')})
    `, songIds));
    rows.forEach(row => songsById.set(Number(row.id), row));
  }
  const normalizedQuery = input.query.toLocaleLowerCase();
  const normalizedSinger = input.singer.toLocaleLowerCase();
  const songs = cachedSongIds
    .map(songId => songsById.get(songId) || fallbackSongRow(songId))
    .filter((song) => {
      const queryMatches = !normalizedQuery
        || String(song.name || '').toLocaleLowerCase().includes(normalizedQuery)
        || String(song.id).includes(normalizedQuery);
      const singerMatches = !normalizedSinger
        || String(song.singer || '').toLocaleLowerCase().includes(normalizedSinger);
      return queryMatches && singerMatches;
    })
    .slice(input.offset, input.offset + input.limit);
  const cacheRows = await loadCacheRows(cacheDatabasePath, songs.map(song => Number(song.id)));
  return songs.map(song => toSong(song, cacheRows.get(Number(song.id)) || []));
}

export function getQQMusicLyricsStatus(
  paths: QQMusicLyricsServicePaths = defaultPaths(),
): QQMusicLyricsStatus {
  return {
    cacheDatabaseFound: existsSync(paths.cacheDatabasePath),
    cacheDatabasePath: paths.cacheDatabasePath,
    libraryDatabaseFound: existsSync(paths.libraryDatabasePath),
    libraryDatabasePath: paths.libraryDatabasePath,
    platform: process.platform,
    supported: process.platform === 'darwin',
  };
}

export async function searchQQMusicLyrics(
  input: QQMusicLyricsSearchInput,
  paths: QQMusicLyricsServicePaths = defaultPaths(),
): Promise<QQMusicLyricsSong[]> {
  requireSupportedPlatform();
  requireDatabase(paths.libraryDatabasePath, 'LIBRARY_DATABASE_MISSING', '曲库');
  requireDatabase(paths.cacheDatabasePath, 'CACHE_DATABASE_MISSING', '歌词缓存');
  const normalized = normalizeSearchInput(input);
  if (normalized.cachedOnly) {
    try {
      return await loadCachedSongs(paths.libraryDatabasePath, paths.cacheDatabasePath, normalized);
    } catch (error) {
      if (error instanceof QQMusicLyricsServiceError) throw error;
      throw new QQMusicLyricsServiceError('DATABASE_READ_FAILED', '读取 QQ 音乐本地数据库失败', { cause: error });
    }
  }
  const conditions = ["K_SONG_RESERVE1 <> ''"];
  const parameters: unknown[] = [];
  if (normalized.query) {
    conditions.push("name LIKE ? ESCAPE '\\'");
    parameters.push(`%${escapeLike(normalized.query)}%`);
  }
  if (normalized.singer) {
    conditions.push("singer LIKE ? ESCAPE '\\'");
    parameters.push(`%${escapeLike(normalized.singer)}%`);
  }
  parameters.push(normalized.limit);
  parameters.push(normalized.offset);

  try {
    const songs = await withReadonlyDatabase(paths.libraryDatabasePath, database => all<SongRow>(database, `
      SELECT id, K_SONG_RESERVE1 AS song_mid, name, singer
      FROM SONGS
      WHERE ${conditions.join(' AND ')}
      ORDER BY rowid DESC
      LIMIT ?
      OFFSET ?
    `, parameters));
    const cacheRows = await loadCacheRows(paths.cacheDatabasePath, songs.map(song => Number(song.id)));
    return songs.map(song => toSong(song, cacheRows.get(Number(song.id)) || []));
  } catch (error) {
    if (error instanceof QQMusicLyricsServiceError) throw error;
    throw new QQMusicLyricsServiceError('DATABASE_READ_FAILED', '读取 QQ 音乐本地数据库失败', { cause: error });
  }
}

function unwrapQrcPayload(data: Buffer): Buffer {
  let payload: unknown = data;
  if (data.subarray(0, 8).toString('ascii') === 'bplist00') {
    try {
      const root = bplistParser.parseBuffer<Record<string, unknown>>(data)[0];
      const objects = root?.$objects;
      payload = Array.isArray(objects) && objects.length > 1 ? objects[1] : root;
    } catch (error) {
      throw new QQMusicLyricsServiceError('PLIST_DECODE_FAILED', 'QQ 音乐歌词缓存 plist 无法解析', { cause: error });
    }
  }
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'string') {
    const compact = payload.trim();
    if (/^[0-9a-f]+$/iu.test(compact) && compact.length % 2 === 0) {
      return Buffer.from(compact, 'hex');
    }
  }
  throw new QQMusicLyricsServiceError('PLIST_DECODE_FAILED', 'QQ 音乐歌词缓存中没有可识别的 QRC 数据');
}

function safeFilePart(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|]+/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim();
  return truncateUtf8(normalized, SAFE_FILE_PART_MAX_BYTES) || '未知歌曲';
}

export async function previewQQMusicLyrics(
  songIdInput: number,
  paths: QQMusicLyricsServicePaths = defaultPaths(),
): Promise<QQMusicLyricsPreview> {
  requireSupportedPlatform();
  requireDatabase(paths.libraryDatabasePath, 'LIBRARY_DATABASE_MISSING', '曲库');
  requireDatabase(paths.cacheDatabasePath, 'CACHE_DATABASE_MISSING', '歌词缓存');
  const songId = Number(songIdInput);
  if (!Number.isSafeInteger(songId) || songId <= 0) {
    throw new QQMusicLyricsServiceError('INVALID_REQUEST', '缺少有效的 QQ 音乐 SongID');
  }

  try {
    const storedSongRow = await withReadonlyDatabase(paths.libraryDatabasePath, database => get<SongRow>(database, `
      SELECT id, K_SONG_RESERVE1 AS song_mid, name, singer
      FROM SONGS
      WHERE id = ?
      LIMIT 1
    `, [songId]));
    const songRow = storedSongRow || fallbackSongRow(songId);
    const cacheRow = await withReadonlyDatabase(paths.cacheDatabasePath, database => get<CachePayloadRow>(database, `
      SELECT keyId AS key_id, size, length(data) AS data_length, data
      FROM Cache
      WHERE keyId = ?
      LIMIT 1
    `, [`${songId}.qrc`]));
    if (!cacheRow) {
      throw new QQMusicLyricsServiceError(
        'CACHE_ENTRY_MISSING',
        '这首歌还没有本地 QRC 缓存，请在 QQ音乐Mac版中播放并显示歌词后刷新',
      );
    }
    const encryptedPayload = unwrapQrcPayload(cacheRow.data);
    let xml: string | null = null;
    try {
      xml = qrc.decrypt(encryptedPayload);
    } catch (error) {
      throw new QQMusicLyricsServiceError('QRC_DECODE_FAILED', '本地 QRC 缓存解码失败', { cause: error });
    }
    if (!xml || !/<(?:QrcInfos|LyricInfo)\b/iu.test(xml)) {
      throw new QQMusicLyricsServiceError('QRC_DECODE_FAILED', '本地 QRC 缓存解码失败');
    }
    const song = toSong(songRow, [cacheRow]);
    return {
      fileName: `${safeFilePart(song.name)} - ${safeFilePart(song.singer)} [${song.songId}].qrc.xml`,
      qrcXml: xml,
      song,
    };
  } catch (error) {
    if (error instanceof QQMusicLyricsServiceError) throw error;
    throw new QQMusicLyricsServiceError('DATABASE_READ_FAILED', '读取 QQ 音乐本地歌词失败', { cause: error });
  }
}

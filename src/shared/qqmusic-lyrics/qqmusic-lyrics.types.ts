export type QQMusicLyricsErrorCode =
  | 'CACHE_DATABASE_MISSING'
  | 'CACHE_ENTRY_MISSING'
  | 'DATABASE_READ_FAILED'
  | 'INVALID_REQUEST'
  | 'LIBRARY_DATABASE_MISSING'
  | 'PLIST_DECODE_FAILED'
  | 'QRC_DECODE_FAILED'
  | 'SONG_NOT_FOUND'
  | 'UNSUPPORTED_PLATFORM';

export interface QQMusicLyricsErrorPayload {
  code: QQMusicLyricsErrorCode;
  message: string;
}

export type QQMusicLyricsOperation<T> =
  | { data: T; ok: true }
  | { error: QQMusicLyricsErrorPayload; ok: false };

export interface QQMusicLyricsStatus {
  cacheDatabaseFound: boolean;
  cacheDatabasePath: string;
  libraryDatabaseFound: boolean;
  libraryDatabasePath: string;
  platform: NodeJS.Platform;
  supported: boolean;
}

export interface QQMusicLyricsSearchInput {
  cachedOnly?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  singer?: string;
}

export interface QQMusicLyricsSong {
  cachedKinds: Array<'lrc' | 'qrc' | 'translation' | 'transliteration'>;
  name: string;
  qrcBytes?: number;
  singer: string;
  songId: number;
  songMid: string;
}

export interface QQMusicLyricsPreview {
  fileName: string;
  qrcXml: string;
  song: QQMusicLyricsSong;
}

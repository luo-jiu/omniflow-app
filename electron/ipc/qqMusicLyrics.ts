import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';

import type {
  QQMusicLyricsErrorPayload,
  QQMusicLyricsOperation,
  QQMusicLyricsSearchInput,
} from '@/shared/qqmusic-lyrics/qqmusic-lyrics.types';
import {
  getQQMusicLyricsStatus,
  previewQQMusicLyrics,
  QQMusicLyricsServiceError,
  searchQQMusicLyrics,
} from '../service/qqMusicLyricsService';
import { assertMainWindowQQMusicLyricsSender } from './aiServiceAccess';

interface RegisterQQMusicLyricsIpcOptions {
  getMainWindow: () => BrowserWindow | null;
}

async function runOperation<T>(task: () => Promise<T>): Promise<QQMusicLyricsOperation<T>> {
  try {
    return { data: await task(), ok: true };
  } catch (error) {
    const payload: QQMusicLyricsErrorPayload = error instanceof QQMusicLyricsServiceError
      ? { code: error.code, message: error.message }
      : { code: 'DATABASE_READ_FAILED', message: 'QQ 音乐本地歌词操作失败' };
    return { error: payload, ok: false };
  }
}

export function registerQQMusicLyricsIpc(
  ipcMain: IpcMain,
  options: RegisterQQMusicLyricsIpcOptions,
) {
  function requireMainWindow(event: IpcMainInvokeEvent) {
    assertMainWindowQQMusicLyricsSender(event, options.getMainWindow);
  }

  ipcMain.handle('qqmusic-lyrics:status', (event) => {
    requireMainWindow(event);
    return getQQMusicLyricsStatus();
  });
  ipcMain.handle('qqmusic-lyrics:search', (event, input: QQMusicLyricsSearchInput) => {
    requireMainWindow(event);
    return runOperation(() => searchQQMusicLyrics(input));
  });
  ipcMain.handle('qqmusic-lyrics:preview', (event, songId: number) => {
    requireMainWindow(event);
    return runOperation(() => previewQQMusicLyrics(songId));
  });
}

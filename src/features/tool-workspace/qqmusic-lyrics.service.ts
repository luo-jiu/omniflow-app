import type {
  QQMusicLyricsPreview,
  QQMusicLyricsSearchInput,
  QQMusicLyricsSong,
  QQMusicLyricsStatus,
} from '@/shared/qqmusic-lyrics/qqmusic-lyrics.types';
import { fetchNodeDetailById } from '@/features/file-explorer/services/file.api';
import { fetchProviders } from '@/features/storage-config/services/storage-config.api';
import { uploadGeneratedSubtitleContent } from './subtitle-translation.service';

export interface QQMusicStorageProviderOption {
  alias: string;
  isDefault: boolean;
  label: string;
}

export class QQMusicLyricsClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'QQMusicLyricsClientError';
  }
}

function bridge() {
  if (!window.electronQQMusicLyrics) {
    throw new QQMusicLyricsClientError('BRIDGE_UNAVAILABLE', '当前环境无法访问桌面端 QQ 音乐歌词能力');
  }
  return window.electronQQMusicLyrics;
}

export function fetchQQMusicLyricsStatus(): Promise<QQMusicLyricsStatus> {
  return bridge().status();
}

export async function searchLocalQQMusicLyrics(
  input: QQMusicLyricsSearchInput,
): Promise<QQMusicLyricsSong[]> {
  const result = await bridge().search(input);
  if (!result.ok) throw new QQMusicLyricsClientError(result.error.code, result.error.message);
  return result.data;
}

export async function loadLocalQQMusicLyricsPreview(songId: number): Promise<QQMusicLyricsPreview> {
  const result = await bridge().preview(songId);
  if (!result.ok) throw new QQMusicLyricsClientError(result.error.code, result.error.message);
  return result.data;
}

export async function fetchQQMusicStorageProviders(): Promise<{
  defaultProvider: string;
  providers: QQMusicStorageProviderOption[];
}> {
  const result = await fetchProviders();
  const defaultProvider = String(result.defaultProvider || '').trim();
  return {
    defaultProvider,
    providers: result.providers.map(provider => ({
      alias: String(provider.alias || '').trim(),
      isDefault: String(provider.alias || '').trim() === defaultProvider,
      label: String(provider.label || provider.alias || '').trim(),
    })).filter(provider => Boolean(provider.alias)),
  };
}

export function saveQQMusicLyricsToLibrary(input: {
  content: string;
  fileName: string;
  libraryId: number;
  parentId: number;
  storageProvider?: string;
}) {
  return uploadGeneratedSubtitleContent(
    input.fileName,
    input.content,
    input.libraryId,
    input.parentId,
    { storageProvider: input.storageProvider },
  );
}

export async function validateQQMusicLyricsSaveDirectory(
  libraryId: number,
  parentId: number,
): Promise<boolean> {
  try {
    const detail = await fetchNodeDetailById(parentId);
    return detail.id === parentId
      && detail.libraryId === libraryId
      && detail.type === 'dir';
  } catch {
    return false;
  }
}

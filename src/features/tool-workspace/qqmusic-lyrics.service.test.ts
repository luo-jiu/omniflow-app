import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchNodeDetailById,
  fetchProviders,
  uploadGeneratedSubtitleContent,
} = vi.hoisted(() => ({
  fetchNodeDetailById: vi.fn(),
  fetchProviders: vi.fn(),
  uploadGeneratedSubtitleContent: vi.fn(),
}));

vi.mock('@/features/file-explorer/services/file.api', () => ({
  fetchNodeDetailById,
}));

vi.mock('@/features/storage-config/services/storage-config.api', () => ({
  fetchProviders,
}));

vi.mock('./subtitle-translation.service', () => ({
  uploadGeneratedSubtitleContent,
}));

import {
  fetchQQMusicStorageProviders,
  saveQQMusicLyricsToLibrary,
  validateQQMusicLyricsSaveDirectory,
} from './qqmusic-lyrics.service';

describe('QQ Music lyrics storage provider integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects provider choices without retaining credentials', async () => {
    fetchProviders.mockResolvedValue({
      defaultProvider: 'win-minio',
      providers: [{
        accessKey: 'secret-access-key',
        alias: 'local-minio',
        bucket: 'my-bucket',
        endpoint: 'localhost:9000',
        label: '本地 MinIO',
        region: '',
        secretKey: 'secret-key',
        type: 'minio',
        useSSL: false,
      }],
    });

    await expect(fetchQQMusicStorageProviders()).resolves.toEqual({
      defaultProvider: 'win-minio',
      providers: [{
        alias: 'local-minio',
        isDefault: false,
        label: '本地 MinIO',
      }],
    });
  });

  it('forwards the selected provider to the controlled staging upload', async () => {
    uploadGeneratedSubtitleContent.mockResolvedValue({ id: 1 });

    await saveQQMusicLyricsToLibrary({
      content: '<QrcInfos />',
      fileName: 'lyrics.qrc.xml',
      libraryId: 2,
      parentId: 10,
      storageProvider: 'local-minio',
    });

    expect(uploadGeneratedSubtitleContent).toHaveBeenCalledWith(
      'lyrics.qrc.xml',
      '<QrcInfos />',
      2,
      10,
      { storageProvider: 'local-minio' },
    );
  });

  it('only accepts a directory from the active library', async () => {
    fetchNodeDetailById.mockResolvedValue({ id: 10, libraryId: 2, type: 'dir' });
    await expect(validateQQMusicLyricsSaveDirectory(2, 10)).resolves.toBe(true);

    fetchNodeDetailById.mockResolvedValue({ id: 10, libraryId: 3, type: 'dir' });
    await expect(validateQQMusicLyricsSaveDirectory(2, 10)).resolves.toBe(false);

    fetchNodeDetailById.mockRejectedValue(new Error('not found'));
    await expect(validateQQMusicLyricsSaveDirectory(2, 10)).resolves.toBe(false);
  });
});

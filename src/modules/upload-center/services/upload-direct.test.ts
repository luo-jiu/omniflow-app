import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  abortUploadSession: vi.fn(),
  completeUploadSession: vi.fn(),
  initUploadSession: vi.fn(),
  reconcileUploadCompletion: vi.fn(),
  renewUploadSession: vi.fn(),
  signUploadParts: vi.fn(),
}));

vi.mock('./upload-session.api', () => {
  class UploadSessionExpiredError extends Error {}
  class UploadSessionNotFoundError extends Error {}
  class UploadSessionRequestError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return {
    ...apiMocks,
    UploadSessionExpiredError,
    UploadSessionNotFoundError,
    UploadSessionRequestError,
  };
});

import { UploadSessionExpiredError, UploadSessionNotFoundError } from './upload-session.api';
import { runDirectUpload, UploadCommitUnknownError } from './upload-direct';

const electronAPI = {
  onUploadProgress: vi.fn(() => vi.fn()),
  uploadAbort: vi.fn(),
  uploadPresignedPut: vi.fn(),
};

function configureSinglePartUpload() {
  apiMocks.initUploadSession.mockResolvedValue({
    uploadId: 'upload-1',
    storageKey: 'libraries/2/file.txt',
    mode: 'single',
    partSize: 4,
    totalParts: 1,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  apiMocks.signUploadParts.mockResolvedValue({
    parts: [{
      partNumber: 1,
      url: 'http://storage.test/file.txt',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  electronAPI.uploadPresignedPut.mockResolvedValue({ etag: 'etag-1' });
}

describe('runDirectUpload completion reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { electronAPI });
    configureSinglePartUpload();
  });

  it('returns the committed node when the complete response was lost', async () => {
    const committedNode = { id: 42, name: 'file.txt', type: 'file', libraryId: 2 };
    apiMocks.completeUploadSession.mockRejectedValue(new Error('connection reset'));
    apiMocks.reconcileUploadCompletion.mockResolvedValue({
      state: 'committed',
      node: committedNode,
    });

    await expect(runDirectUpload({
      filePath: '/tmp/file.txt',
      fileName: 'file.txt',
      fileSize: 4,
      libraryId: 2,
      parentId: 0,
    })).resolves.toEqual(committedNode);

    expect(apiMocks.abortUploadSession).not.toHaveBeenCalled();
  });

  it('preserves the session when the completion outcome is still unknown', async () => {
    apiMocks.completeUploadSession.mockRejectedValue(new Error('connection reset'));
    apiMocks.reconcileUploadCompletion.mockResolvedValue({ state: 'uncommitted' });

    await expect(runDirectUpload({
      filePath: '/tmp/file.txt',
      fileName: 'file.txt',
      fileSize: 4,
      libraryId: 2,
      parentId: 0,
    })).rejects.toBeInstanceOf(UploadCommitUnknownError);

    expect(apiMocks.abortUploadSession).not.toHaveBeenCalled();
    expect(electronAPI.uploadAbort).not.toHaveBeenCalled();
  });

  it('keeps lease expiry as a definitive failure and aborts normally', async () => {
    apiMocks.completeUploadSession.mockRejectedValue(new UploadSessionExpiredError('expired'));

    await expect(runDirectUpload({
      filePath: '/tmp/file.txt',
      fileName: 'file.txt',
      fileSize: 4,
      libraryId: 2,
      parentId: 0,
    })).rejects.toBeInstanceOf(UploadSessionExpiredError);

    expect(apiMocks.reconcileUploadCompletion).not.toHaveBeenCalled();
    expect(apiMocks.abortUploadSession).toHaveBeenCalledWith('upload-1');
  });

  it('keeps a missing session as a definitive failure and aborts normally', async () => {
    apiMocks.completeUploadSession.mockRejectedValue(new UploadSessionNotFoundError('not found'));

    await expect(runDirectUpload({
      filePath: '/tmp/file.txt',
      fileName: 'file.txt',
      fileSize: 4,
      libraryId: 2,
      parentId: 0,
    })).rejects.toBeInstanceOf(UploadSessionNotFoundError);

    expect(apiMocks.reconcileUploadCompletion).not.toHaveBeenCalled();
    expect(apiMocks.abortUploadSession).toHaveBeenCalledWith('upload-1');
  });
});

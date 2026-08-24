import {
  abortUploadSession,
  completeUploadSession,
  initUploadSession,
  reconcileUploadCompletion,
  renewUploadSession,
  signUploadParts,
  UploadSessionExpiredError,
  UploadSessionRequestError,
  UploadSessionNotFoundError,
} from './upload-session.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

// 直传 MinIO 流程的共享实现：UploadManager 执行器与 uploadLocalPathAndCreateNode 共用同一条链路，
// 保证心跳/续约/abort 语义只有一处。
const PRESIGN_BATCH_CONCURRENCY = 4;
// 心跳间隔从 init 返回的 expiresAt 反推（lease 周期 / 3），避免后端调短 TTL 时前端过期；
// 下界 1min（防 lease 异常短时心跳风暴），上界 8h（防 lease 异常长时心跳缺失被代理/路由 idle kill）。
const HEARTBEAT_MIN_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_MAX_INTERVAL_MS = 8 * 60 * 60 * 1000;
const HEARTBEAT_FALLBACK_INTERVAL_MS = 8 * 60 * 60 * 1000;

function computeHeartbeatIntervalMs(expiresAtIso: string): number {
  const expiresAtMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return HEARTBEAT_FALLBACK_INTERVAL_MS;
  const remaining = expiresAtMs - Date.now();
  if (remaining <= 0) return HEARTBEAT_MIN_INTERVAL_MS;
  const interval = Math.floor(remaining / 3);
  return Math.min(Math.max(interval, HEARTBEAT_MIN_INTERVAL_MS), HEARTBEAT_MAX_INTERVAL_MS);
}

export interface DirectUploadInput {
  filePath: string;
  fileName: string;
  fileSize: number;
  contentType?: string;
  libraryId: number;
  parentId: number;
  storageProvider?: string;
  conflictPolicy?: 'error' | 'auto_rename' | 'replace';
  onProgress?: (uploadedBytes: number) => void;
  setAbort?: (aborter: () => Promise<void>) => void;
}

export class UploadCommitUnknownError extends Error {
  readonly uploadId: string;
  readonly clientOperationId: string;
  readonly cause: unknown;

  constructor(uploadId: string, clientOperationId: string, cause: unknown) {
    super(`上传提交结果暂时无法确认 (operation: ${clientOperationId})`);
    this.name = 'UploadCommitUnknownError';
    this.uploadId = uploadId;
    this.clientOperationId = clientOperationId;
    this.cause = cause;
  }
}

function createCompletionOperationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isDefinitiveCompletionFailure(error: unknown): boolean {
  if (error instanceof UploadSessionExpiredError) return true;
  if (error instanceof UploadSessionNotFoundError) return true;
  if (error instanceof UploadSessionRequestError) {
    return error.status >= 400
      && error.status < 500
      && error.status !== 408
      && error.status !== 429;
  }
  return false;
}

async function completeWithReconciliation(
  request: Parameters<typeof completeUploadSession>[0],
): Promise<unknown> {
  try {
    return await completeUploadSession(request);
  } catch (error) {
    if (isDefinitiveCompletionFailure(error)) throw error;

    try {
      const status = await reconcileUploadCompletion(request.clientOperationId);
      if (status.state === 'committed' && status.node) return status.node;
    } catch (reconcileError) {
      runtimeLogger.warn('upload completion reconciliation failed', reconcileError);
    }
    throw new UploadCommitUnknownError(request.uploadId, request.clientOperationId, error);
  }
}

export async function runDirectUpload(input: DirectUploadInput): Promise<unknown> {
  const initResult = await initUploadSession({
    libraryId: input.libraryId,
    parentId: input.parentId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    contentType: input.contentType || undefined,
    storageProvider: input.storageProvider,
  });

  const { uploadId, mode, partSize, totalParts } = initResult;
  const clientOperationId = createCompletionOperationId();

  const partBytes = new Map<number, number>();
  let aborted = false;

  const reportProgress = () => {
    if (aborted || !input.onProgress) return;
    let total = 0;
    for (const value of partBytes.values()) total += value;
    input.onProgress(Math.min(total, input.fileSize));
  };

  const offProgress = window.electronAPI.onUploadProgress((event) => {
    if (event.uploadId !== uploadId) return;
    if (typeof event.partNumber !== 'number') return;
    const previous = partBytes.get(event.partNumber) ?? 0;
    if (event.uploadedBytes > previous) {
      partBytes.set(event.partNumber, event.uploadedBytes);
      reportProgress();
    }
  });

  const heartbeatIntervalMs = computeHeartbeatIntervalMs(initResult.expiresAt);
  const heartbeatTimer = setInterval(() => {
    if (aborted) return;
    void renewUploadSession(uploadId).catch((err) => {
      runtimeLogger.warn('upload session heartbeat renew failed', err);
    });
  }, heartbeatIntervalMs);

  if (input.setAbort) {
    input.setAbort(async () => {
      aborted = true;
      try {
        await window.electronAPI.uploadAbort(uploadId);
      } catch (err) {
        runtimeLogger.warn('uploadAbort failed', err);
      }
      try {
        await abortUploadSession(uploadId);
      } catch (err) {
        runtimeLogger.warn('abortUploadSession failed', err);
      }
    });
  }

  const cleanup = () => {
    clearInterval(heartbeatTimer);
    offProgress();
  };

  try {
    const allPartNumbers = Array.from({ length: Math.max(1, totalParts) }, (_, i) => i + 1);
    const collectedEtags = new Map<number, string>();

    for (let cursor = 0; cursor < allPartNumbers.length; cursor += PRESIGN_BATCH_CONCURRENCY) {
      if (aborted) throw new Error('upload canceled');

      const batchNumbers = allPartNumbers.slice(cursor, cursor + PRESIGN_BATCH_CONCURRENCY);
      const signResult = await signUploadParts({ uploadId, partNumbers: batchNumbers });
      if (aborted) throw new Error('upload canceled');

      const signedByPartNumber = new Map<number, string>();
      for (const part of signResult.parts) {
        signedByPartNumber.set(part.partNumber, part.url);
      }

      await Promise.all(batchNumbers.map(async (partNumber) => {
        if (aborted) return;
        const presignedUrl = signedByPartNumber.get(partNumber);
        if (!presignedUrl) {
          throw new Error(`后端未返回 part ${partNumber} 的预签名 URL`);
        }

        const byteOffset = (partNumber - 1) * partSize;
        const byteLength = mode === 'single'
          ? input.fileSize
          : Math.min(partSize, input.fileSize - byteOffset);

        const result = await window.electronAPI.uploadPresignedPut({
          uploadId,
          partNumber,
          presignedUrl,
          filePath: input.filePath,
          byteOffset,
          byteLength,
          contentType: input.contentType || undefined,
        });

        if (!result.etag) {
          throw new Error(`MinIO 未返回 part ${partNumber} 的 ETag`);
        }
        collectedEtags.set(partNumber, result.etag);
        partBytes.set(partNumber, byteLength);
        reportProgress();
      }));
    }

    if (aborted) throw new Error('upload canceled');

    const completeRequestParts = allPartNumbers.map((partNumber) => ({
      partNumber,
      etag: collectedEtags.get(partNumber) ?? '',
    }));

    const node = await completeWithReconciliation({
      uploadId,
      clientOperationId,
      parts: mode === 'single' ? [] : completeRequestParts,
      conflictPolicy: input.conflictPolicy,
    });

    cleanup();
    return node;
  } catch (err) {
    cleanup();
    if (!aborted && !(err instanceof UploadCommitUnknownError)) {
      try {
        await abortUploadSession(uploadId);
      } catch (abortErr) {
        if (!(abortErr instanceof UploadSessionNotFoundError)) {
          runtimeLogger.warn('abortUploadSession (post-error) failed', abortErr);
        }
      }
    }
    throw err;
  }
}

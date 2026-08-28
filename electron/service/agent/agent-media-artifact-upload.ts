import crypto from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';

import { runtimeLogger } from '../../runtimeLogger';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import type { AgentMediaArtifactUploadResult } from '../../../src/shared/agent/agent.types';
import type {
  AgentMediaArtifactOwner,
  AgentMediaArtifactStore,
  AgentMediaOwnedFile,
} from './agent-media-artifact-store';
import {
  AgentMediaUploadControlPlaneError,
  type AgentMediaUploadControlPlane,
  type AgentMediaUploadCredentials,
} from './agent-media-upload-control-plane';

const MAX_UPLOAD_ID_LENGTH = 256;
const MAX_TOKEN_LENGTH = 32 * 1024;
const MAX_PARTS_PER_BATCH = 4;
const MAX_TOTAL_PARTS = 10_000;
const MAX_PRESIGNED_URL_LENGTH = 32 * 1024;
const DEFAULT_PUT_DEADLINE_MS = 10 * 60 * 1_000;
const DEFAULT_PUT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_RECONCILE_TIMEOUT_MS = 10_000;

export interface AgentMediaArtifactUploadTarget {
  conflictPolicy: 'error' | 'auto_rename' | 'replace';
  contentType?: string;
  fileName: string;
  libraryId: number;
  parentId: number;
  storageProvider: string;
}

export interface AgentMediaArtifactUploadInput {
  artifactId: string;
  credentials: AgentMediaUploadCredentials;
  expectedUserId: number;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  onSettlementStarted?: () => void;
  owner: AgentMediaArtifactOwner;
  signal: AbortSignal;
  target: AgentMediaArtifactUploadTarget;
}

interface UploadInitResult {
  mode: 'single' | 'multipart';
  partSize: number;
  totalParts: number;
  uploadId: string;
}

export interface AgentMediaArtifactPutTransport {
  put(input: {
    byteLength: number;
    byteOffset: number;
    contentType?: string;
    deadlineMs: number;
    fileHandle: FileHandle;
    idleTimeoutMs: number;
    onProgress: (uploadedBytes: number) => void;
    signal: AbortSignal;
    url: string;
  }): Promise<{ etag: string; sentBytes: number; status: number }>;
}

class AgentMediaArtifactUploadUncommittedError extends Error {
  constructor() {
    super('Agent 媒体产物上传未提交');
    this.name = 'AgentMediaArtifactUploadUncommittedError';
  }
}

interface AgentMediaArtifactUploadManagerOptions {
  artifactStore: Pick<AgentMediaArtifactStore, 'withOwnedFile'>;
  controlPlane: AgentMediaUploadControlPlane;
  putDeadlineMs?: number;
  putIdleTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  transport?: AgentMediaArtifactPutTransport;
}

function abortError(): Error {
  const error = new Error('Agent 媒体产物上传已取消');
  error.name = 'AbortError';
  return error;
}

function stableError(message: string): Error {
  return new Error(message);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maxLength || /[\0\r\n]/u.test(normalized)) {
    throw stableError(`${label}无效`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw stableError(`${label}无效`);
  return normalized;
}

function normalizeCredentials(input: AgentMediaUploadCredentials): AgentMediaUploadCredentials {
  const token = boundedText(input?.token, 'Agent 上传凭据', MAX_TOKEN_LENGTH);
  const username = boundedText(input?.username, 'Agent 上传用户名', 256);
  return { token, username };
}

function normalizeOwner(input: AgentMediaArtifactOwner): AgentMediaArtifactOwner {
  return {
    executionId: boundedText(input?.executionId, 'Agent executionId', 256),
    ownerScope: normalizeAgentOwnerScope(input?.ownerScope),
    ownerWebContentsId: positiveInteger(input?.ownerWebContentsId, 'Agent 媒体产物上传窗口'),
    runId: boundedText(input?.runId, 'Agent runId', 256),
    sessionId: boundedText(input?.sessionId, 'Agent sessionId', 256),
  };
}

function normalizeTarget(input: AgentMediaArtifactUploadTarget): AgentMediaArtifactUploadTarget {
  const conflictPolicy = input?.conflictPolicy;
  if (conflictPolicy !== 'error' && conflictPolicy !== 'auto_rename' && conflictPolicy !== 'replace') {
    throw stableError('Agent 上传冲突策略无效');
  }
  const contentType = String(input?.contentType ?? '').trim();
  if (contentType && (contentType.length > 256 || /[\0\r\n]/u.test(contentType))) {
    throw stableError('Agent 上传内容类型无效');
  }
  return {
    conflictPolicy,
    ...(contentType ? { contentType } : {}),
    fileName: boundedText(input?.fileName, 'Agent 上传文件名', 512),
    libraryId: positiveInteger(input?.libraryId, 'Agent 资料库 ID'),
    parentId: positiveInteger(input?.parentId, 'Agent 上传目标目录'),
    storageProvider: boundedText(input?.storageProvider, 'Agent 上传存储 Provider', 256),
  };
}

function normalizeInitResult(input: UploadInitResult, fileSize: number): UploadInitResult {
  const uploadId = boundedText(input?.uploadId, 'Agent uploadId', MAX_UPLOAD_ID_LENGTH);
  const partSize = positiveInteger(input?.partSize, 'Agent 上传分片大小');
  const totalParts = positiveInteger(input?.totalParts, 'Agent 上传总分片数');
  if (totalParts > MAX_TOTAL_PARTS || Math.ceil(fileSize / partSize) !== totalParts) {
    throw stableError('Agent 上传分片布局无效');
  }
  if (input?.mode !== 'single' && input?.mode !== 'multipart') {
    throw stableError('Agent 上传模式无效');
  }
  return { mode: input.mode, partSize, totalParts, uploadId };
}

function normalizeSignedUrl(input: unknown): string {
  const url = boundedText(input, 'Agent 上传签名地址', MAX_PRESIGNED_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw stableError('Agent 上传签名地址无效');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw stableError('Agent 上传签名地址无效');
  }
  return url;
}

function normalizeCommittedNode(
  input: unknown,
): Extract<AgentMediaArtifactUploadResult, { commitState: 'committed' }>['node'] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const id = Number(source.id);
  const name = String(source.name || '').trim().slice(0, 512);
  if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;
  const rawExt = String(source.ext || '').trim().replace(/^\./u, '').slice(0, 32);
  const ext = /^[a-z0-9][a-z0-9_-]{0,31}$/iu.test(rawExt) ? rawExt : '';
  return { ...(ext ? { ext } : {}), id, name };
}

function isDefinitiveClientError(error: unknown): boolean {
  if (!(error instanceof AgentMediaUploadControlPlaneError)) return false;
  const status = Number(error.status || 0);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function isAuthenticationError(error: unknown): boolean {
  return error instanceof AgentMediaUploadControlPlaneError
    && error.reason === 'auth_expired';
}

function operationIdFor(input: {
  artifactId: string;
  owner: AgentMediaArtifactOwner;
  target: AgentMediaArtifactUploadTarget;
}): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    artifactId: input.artifactId,
    executionId: input.owner.executionId,
    ownerScope: input.owner.ownerScope,
    parentId: input.target.parentId,
    provider: input.target.storageProvider,
    conflictPolicy: input.target.conflictPolicy,
    contentType: input.target.contentType || null,
    runId: input.owner.runId,
    sessionId: input.owner.sessionId,
    targetFileName: input.target.fileName,
    targetLibraryId: input.target.libraryId,
  })).digest('hex');
}

export function createAgentMediaArtifactPutTransport(): AgentMediaArtifactPutTransport {
  return {
    put(input) {
      throwIfAborted(input.signal);
      return new Promise((resolve, reject) => {
        const parsedUrl = new URL(normalizeSignedUrl(input.url));
        const requestTransport = parsedUrl.protocol === 'https:' ? https : http;
        const headers: Record<string, string> = { 'Content-Length': String(input.byteLength) };
        if (input.contentType) headers['Content-Type'] = input.contentType;
        const request = requestTransport.request({
          headers,
          hostname: parsedUrl.hostname,
          method: 'PUT',
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
          protocol: parsedUrl.protocol,
        });
        const fileStream = input.fileHandle.createReadStream({
          autoClose: false,
          end: input.byteOffset + input.byteLength - 1,
          highWaterMark: 1024 * 1024,
          start: input.byteOffset,
        });
        let settled = false;
        let fileEnded = false;
        let sentBytes = 0;
        let response: IncomingMessage | undefined;
        const cleanup = () => {
          clearTimeout(deadlineTimer);
          input.signal.removeEventListener('abort', handleAbort);
          request.setTimeout(0);
          response?.removeAllListeners();
        };
        const finish = (handler: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          handler();
        };
        const fail = (error: Error) => {
          if (settled) return;
          fileStream.destroy();
          request.destroy();
          finish(() => reject(error));
        };
        const handleAbort = () => fail(abortError());
        const deadlineTimer = setTimeout(
          () => fail(stableError('Agent 媒体分片上传超时')),
          input.deadlineMs,
        );
        deadlineTimer.unref?.();
        request.once('error', () => fail(
          input.signal.aborted ? abortError() : stableError('Agent 媒体分片上传连接失败'),
        ));
        request.setTimeout(input.idleTimeoutMs, () => fail(stableError('Agent 媒体分片上传连接超时')));
        input.signal.addEventListener('abort', handleAbort, { once: true });
        if (input.signal.aborted) {
          handleAbort();
          return;
        }

        request.on('response', (incoming) => {
          response = incoming;
          let responseEnded = false;
          incoming.on('data', () => undefined);
          incoming.once('aborted', () => fail(stableError('Agent 媒体分片上传响应中断')));
          incoming.once('error', () => fail(stableError('Agent 媒体分片上传响应失败')));
          incoming.once('end', () => {
            responseEnded = true;
            const status = Number(incoming.statusCode || 0);
            if (status < 200 || status >= 300) {
              fail(stableError('Agent 媒体分片上传被存储服务拒绝'));
              return;
            }
            if (!fileEnded || sentBytes !== input.byteLength) {
              fail(stableError('Agent 媒体分片读取不完整'));
              return;
            }
            const etag = String(incoming.headers.etag || '').replace(/^"+|"+$/gu, '').trim();
            if (!etag) {
              fail(stableError('Agent 媒体分片上传响应无效'));
              return;
            }
            finish(() => resolve({ etag, sentBytes, status }));
          });
          incoming.once('close', () => {
            if (!responseEnded) fail(stableError('Agent 媒体分片上传响应提前关闭'));
          });
        });
        fileStream.on('data', (chunk: string | Buffer) => {
          sentBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
          input.onProgress(sentBytes);
        });
        fileStream.once('end', () => {
          fileEnded = true;
          if (sentBytes !== input.byteLength) fail(stableError('Agent 媒体分片读取不完整'));
        });
        fileStream.once('error', () => fail(stableError('Agent 媒体分片读取失败')));
        fileStream.once('close', () => {
          if (!fileEnded) fail(stableError('Agent 媒体分片读取提前关闭'));
        });
        fileStream.pipe(request);
      });
    },
  };
}

function timeoutSignal(timeoutMs: number): { dispose: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { dispose: () => clearTimeout(timer), signal: controller.signal };
}

export function createAgentMediaArtifactUploadManager(options: AgentMediaArtifactUploadManagerOptions) {
  const transport = options.transport || createAgentMediaArtifactPutTransport();
  const putDeadlineMs = positiveInteger(options.putDeadlineMs ?? DEFAULT_PUT_DEADLINE_MS, 'Agent 上传分片 deadline');
  const putIdleTimeoutMs = positiveInteger(options.putIdleTimeoutMs ?? DEFAULT_PUT_IDLE_TIMEOUT_MS, 'Agent 上传分片 idle timeout');
  const reconcileTimeoutMs = positiveInteger(options.reconcileTimeoutMs ?? DEFAULT_RECONCILE_TIMEOUT_MS, 'Agent 上传核对 timeout');

  async function upload(input: AgentMediaArtifactUploadInput): Promise<AgentMediaArtifactUploadResult> {
    const controlPlane = options.controlPlane;
    const artifactId = boundedText(input?.artifactId, 'Agent 媒体产物 ID', 128);
    const credentials = normalizeCredentials(input?.credentials);
    const expectedUserId = positiveInteger(input?.expectedUserId, 'Agent 上传账号');
    const owner = normalizeOwner(input?.owner);
    const target = normalizeTarget(input?.target);
    const operationId = operationIdFor({ artifactId, owner, target });
    let nonRetryableSettlement: Extract<
      AgentMediaArtifactUploadResult,
      { commitState: 'committed' | 'commit_unknown' }
    > | null = null;
    throwIfAborted(input.signal);

    const consumeOwnedFile = async (
      ownedFile: AgentMediaOwnedFile,
    ): Promise<AgentMediaArtifactUploadResult> => {
      try {
        await controlPlane.verifyAccount(credentials, expectedUserId, input.signal);
      } catch (error) {
        if (input.signal.aborted) throw abortError();
        if (isAuthenticationError(error)) throw stableError('auth_expired');
        if (
          error instanceof AgentMediaUploadControlPlaneError
          && error.reason === 'forbidden'
        ) {
          throw stableError('当前登录账号与 Agent 任务不匹配');
        }
        throw stableError('Agent 上传账号验证失败，请稍后重试');
      }
      throwIfAborted(input.signal);
      if (ownedFile.artifact.fileName !== target.fileName) {
        throw stableError('Agent 媒体产物与冻结上传目标不匹配');
      }

      let uploadId = '';
      let completeStarted = false;
      let preserveForReconciliation = false;
      const abortSession = async () => {
        if (!uploadId || preserveForReconciliation) return;
        const isolated = timeoutSignal(reconcileTimeoutMs);
        try {
          await controlPlane.abort(credentials, uploadId, isolated.signal);
        } catch {
          // Best effort; never replace the stable primary failure.
        } finally {
          isolated.dispose();
        }
      };

      try {
        const initialized = normalizeInitResult(await controlPlane.init(credentials, {
          ...(target.contentType ? { contentType: target.contentType } : {}),
          fileName: target.fileName,
          fileSize: ownedFile.artifact.sizeBytes,
          libraryId: target.libraryId,
          parentId: target.parentId,
          storageProvider: target.storageProvider,
        }, input.signal), ownedFile.artifact.sizeBytes);
        uploadId = initialized.uploadId;
        const allPartNumbers = Array.from({ length: initialized.totalParts }, (_, index) => index + 1);
        const etags = new Map<number, string>();
        const progressByPart = new Map<number, number>();
        const reportProgress = () => {
          if (!input.onProgress || input.signal.aborted) return;
          let uploadedBytes = 0;
          progressByPart.forEach(value => { uploadedBytes += value; });
          input.onProgress(
            Math.min(uploadedBytes, ownedFile.artifact.sizeBytes),
            ownedFile.artifact.sizeBytes,
          );
        };

        for (let cursor = 0; cursor < allPartNumbers.length; cursor += MAX_PARTS_PER_BATCH) {
          throwIfAborted(input.signal);
          const batch = allPartNumbers.slice(cursor, cursor + MAX_PARTS_PER_BATCH);
          const signedParts = await controlPlane.sign(
            credentials,
            uploadId,
            batch,
            input.signal,
          );
          if (!Array.isArray(signedParts)) throw stableError('Agent 上传签名响应无效');
          const urls = new Map<number, string>();
          signedParts.forEach((part) => {
            const partNumber = positiveInteger(part?.partNumber, 'Agent 上传签名分片序号');
            if (!batch.includes(partNumber) || urls.has(partNumber)) throw stableError('Agent 上传签名响应无效');
            urls.set(partNumber, normalizeSignedUrl(part?.url));
          });
          if (urls.size !== batch.length) throw stableError('Agent 上传签名响应不完整');

          const batchController = new AbortController();
          const abortBatch = () => batchController.abort();
          input.signal.addEventListener('abort', abortBatch, { once: true });
          if (input.signal.aborted) batchController.abort();
          const pendingParts = batch.map(async (partNumber) => {
            try {
              const byteOffset = (partNumber - 1) * initialized.partSize;
              const byteLength = Math.min(initialized.partSize, ownedFile.artifact.sizeBytes - byteOffset);
              const result = await transport.put({
                byteLength,
                byteOffset,
                ...(target.contentType ? { contentType: target.contentType } : {}),
                deadlineMs: putDeadlineMs,
                fileHandle: ownedFile.fileHandle,
                idleTimeoutMs: putIdleTimeoutMs,
                onProgress: (uploadedBytes) => {
                  if (batchController.signal.aborted) return;
                  const bounded = Math.max(0, Math.min(Number(uploadedBytes) || 0, byteLength));
                  if (bounded > (progressByPart.get(partNumber) || 0)) {
                    progressByPart.set(partNumber, bounded);
                    reportProgress();
                  }
                },
                signal: batchController.signal,
                url: urls.get(partNumber) as string,
              });
              if (
                result.status < 200
                || result.status >= 300
                || result.sentBytes !== byteLength
                || !String(result.etag || '').trim()
              ) {
                throw stableError('Agent 媒体分片上传响应无效');
              }
              progressByPart.set(partNumber, byteLength);
              reportProgress();
              return { etag: String(result.etag).trim(), partNumber };
            } catch (error) {
              batchController.abort();
              if (input.signal.aborted) throw abortError();
              throw error instanceof Error
                && error.message === 'Agent 媒体分片上传响应无效'
                ? error
                : stableError('Agent 媒体分片上传失败');
            }
          });
          const settledParts = await Promise.allSettled(pendingParts);
          input.signal.removeEventListener('abort', abortBatch);
          const rejectedPart = settledParts.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (rejectedPart) {
            if (input.signal.aborted) throw abortError();
            throw rejectedPart.reason;
          }
          settledParts.forEach((result) => {
            if (result.status === 'fulfilled') {
              etags.set(result.value.partNumber, result.value.etag);
            }
          });
        }

        await ownedFile.verifyUnchanged();
        throwIfAborted(input.signal);
        input.onSettlementStarted?.();
        completeStarted = true;
        try {
          const node = normalizeCommittedNode(await controlPlane.complete(credentials, {
            clientOperationId: operationId,
            conflictPolicy: target.conflictPolicy,
            parts: initialized.mode === 'single' ? [] : allPartNumbers.map(partNumber => ({ etag: etags.get(partNumber) as string, partNumber })),
            uploadId,
          }, input.signal));
          if (node) {
            nonRetryableSettlement = { commitState: 'committed', node };
            return nonRetryableSettlement;
          }
        } catch (error) {
          if (isDefinitiveClientError(error)) throw error;
        }

        const reconciliation = timeoutSignal(reconcileTimeoutMs);
        try {
          const status = await controlPlane.reconcile(
            credentials,
            operationId,
            reconciliation.signal,
          );
          const node = status?.state === 'committed'
            ? normalizeCommittedNode(status.node)
            : null;
          if (node) {
            nonRetryableSettlement = { commitState: 'committed', node };
            return nonRetryableSettlement;
          }
          if (status?.state === 'uncommitted') {
            throw new AgentMediaArtifactUploadUncommittedError();
          }
          preserveForReconciliation = true;
          nonRetryableSettlement = { commitState: 'commit_unknown' };
          return nonRetryableSettlement;
        } catch (error) {
          if (error instanceof AgentMediaArtifactUploadUncommittedError) throw error;
          preserveForReconciliation = true;
          nonRetryableSettlement = { commitState: 'commit_unknown' };
          return nonRetryableSettlement;
        } finally {
          reconciliation.dispose();
        }
      } catch (error) {
        if (
          completeStarted
          && !isDefinitiveClientError(error)
          && !(error instanceof AgentMediaArtifactUploadUncommittedError)
        ) {
          preserveForReconciliation = true;
        }
        await abortSession();
        if (input.signal.aborted && !completeStarted) throw abortError();
        if (isAuthenticationError(error)) throw stableError('auth_expired');
        if (preserveForReconciliation) return { commitState: 'commit_unknown' };
        return { commitState: 'uncommitted' };
      }
    };

    try {
      return await options.artifactStore.withOwnedFile(artifactId, owner, consumeOwnedFile);
    } catch (error) {
      if (nonRetryableSettlement) {
        runtimeLogger.warn('Agent media artifact cleanup failed after non-retryable settlement');
        return nonRetryableSettlement;
      }
      throw error;
    }
  }

  return { upload };
}

export type AgentMediaArtifactUploadManager = ReturnType<typeof createAgentMediaArtifactUploadManager>;

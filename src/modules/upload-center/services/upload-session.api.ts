import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { runtimeLogger } from '@/utils/runtimeLogger';

// 后端 7 端点 + 直传 MinIO 的客户端封装；统一走 electronAPI.fetch（主进程，避免 CORS）。
// 失败语义：404 → session 不存在/无权（统一防 uploadId 枚举）；410 Gone → lease 过期需重新 init。

export type UploadSessionMode = 'single' | 'multipart';

export interface InitUploadSessionRequest {
  libraryId: number;
  parentId: number;
  fileName: string;
  fileSize: number;
  contentType?: string;
  storageProvider?: string;
}

export interface InitUploadSessionResult {
  uploadId: string;
  storageKey: string;
  mode: UploadSessionMode;
  partSize: number;
  totalParts: number;
  expiresAt: string;
}

export interface SignedUploadPart {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export interface SignUploadPartsResult {
  parts: SignedUploadPart[];
  expiresAt: string;
}

export interface UploadSessionPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface CompleteUploadSessionRequest {
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  conflictPolicy?: 'error' | 'auto_rename' | 'replace';
}

interface IpcHttpResponse<T = unknown> {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: T;
}

interface ApiEnvelope<T> {
  code?: string | number;
  data?: T;
  message?: string | null;
  success?: boolean;
}

class UploadSessionExpiredError extends Error {
  constructor(message = 'upload session lease expired') {
    super(message);
    this.name = 'UploadSessionExpiredError';
  }
}

export class UploadSessionNotFoundError extends Error {
  constructor(message = 'upload session not found') {
    super(message);
    this.name = 'UploadSessionNotFoundError';
  }
}

export const uploadSessionExpired = UploadSessionExpiredError;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function buildHeaders(): Record<string, string> {
  const token = auth.getToken();
  const username = auth.getUsername();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { username } : {}),
  };
}

function unwrapData<T>(envelope: unknown): T {
  if (!isObject(envelope)) {
    throw new Error('upload session 响应数据异常');
  }
  const wrapped = envelope as ApiEnvelope<T>;
  if (wrapped.success === false) {
    throw new Error(String(wrapped.message ?? 'upload session request failed'));
  }
  if (wrapped.data === undefined) {
    return envelope as T;
  }
  return wrapped.data as T;
}

async function requestJson<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const url = `${API_CONFIG.BASE_URL}${path}`;
  const res = await window.electronAPI.fetch(url, {
    method: init.method,
    headers: buildHeaders(),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as IpcHttpResponse;

  const status = Number(res?.status ?? 0);

  if (status === 401) {
    auth.clear();
    if (!window.location.hash.includes('/login')) {
      window.location.hash = '/login';
    }
    throw new Error(`登录状态已失效，请重新登录 (${path})`);
  }
  if (status === 404) {
    throw new UploadSessionNotFoundError(`upload session not found (${path})`);
  }
  if (status === 410) {
    throw new UploadSessionExpiredError(`upload session lease expired (${path})`);
  }
  if (status === 204) {
    return undefined as unknown as T;
  }
  if (status >= 400) {
    const body = res?.body as unknown;
    const msg = isObject(body) ? String((body as ApiEnvelope<T>).message ?? '') : '';
    throw new Error(`upload session HTTP ${status}: ${msg || path}`);
  }

  return unwrapData<T>(res?.body);
}

export async function initUploadSession(req: InitUploadSessionRequest): Promise<InitUploadSessionResult> {
  return requestJson<InitUploadSessionResult>('/v1/upload/init', {
    method: 'POST',
    body: req,
  });
}

export async function signUploadParts(req: { uploadId: string; partNumbers: number[] }): Promise<SignUploadPartsResult> {
  return requestJson<SignUploadPartsResult>('/v1/upload/parts/sign', {
    method: 'POST',
    body: req,
  });
}

export async function listUploadParts(uploadId: string): Promise<UploadSessionPart[]> {
  const res = await requestJson<{ parts: UploadSessionPart[] }>(
    `/v1/upload/parts?uploadId=${encodeURIComponent(uploadId)}`,
    { method: 'GET' },
  );
  return Array.isArray(res?.parts) ? res.parts : [];
}

export async function renewUploadSession(uploadId: string): Promise<{ expiresAt: string }> {
  return requestJson<{ expiresAt: string }>(
    `/v1/upload/${encodeURIComponent(uploadId)}/renew`,
    { method: 'POST' },
  );
}

export async function completeUploadSession(req: CompleteUploadSessionRequest): Promise<unknown> {
  return requestJson<unknown>('/v1/upload/complete', {
    method: 'POST',
    body: req,
  });
}

export async function abortUploadSession(uploadId: string): Promise<void> {
  try {
    await requestJson<void>(`/v1/upload/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    // abort 是 best-effort：404 视为已经被 janitor 清理或 actor 不一致，不再上抛。
    if (err instanceof UploadSessionNotFoundError) return;
    runtimeLogger.warn('abort upload session failed', err);
    throw err;
  }
}

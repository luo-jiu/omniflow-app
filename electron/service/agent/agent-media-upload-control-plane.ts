import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8850/api';
const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024;
const CONTROL_REQUEST_DEADLINE_MS = 15_000;
const CONTROL_SOCKET_IDLE_TIMEOUT_MS = 8_000;
const MAX_TOKEN_LENGTH = 32 * 1024;
const MAX_USERNAME_LENGTH = 256;
const MAX_UPLOAD_ID_LENGTH = 256;
const MAX_SIGNED_URL_LENGTH = 32 * 1024;
const MAX_TOTAL_PARTS = 10_000;

export type AgentMediaUploadControlPlaneErrorReason =
  | 'aborted'
  | 'auth_expired'
  | 'forbidden'
  | 'invalid_request'
  | 'invalid_response'
  | 'network_error'
  | 'not_found'
  | 'rate_limited'
  | 'request_timeout'
  | 'server_error'
  | 'session_expired';

export class AgentMediaUploadControlPlaneError extends Error {
  readonly reason: AgentMediaUploadControlPlaneErrorReason;
  readonly status: number;

  constructor(reason: AgentMediaUploadControlPlaneErrorReason, status = 0) {
    super(`Agent 上传控制面请求失败：${reason}`);
    this.name = 'AgentMediaUploadControlPlaneError';
    this.reason = reason;
    this.status = status;
  }
}

export interface AgentMediaUploadCredentials {
  token: string;
  username: string;
}

export interface AgentMediaUploadInitInput {
  contentType?: string;
  fileName: string;
  fileSize: number;
  libraryId: number;
  parentId: number;
  storageProvider: string;
}

export interface AgentMediaUploadInitResult {
  mode: 'single' | 'multipart';
  partSize: number;
  totalParts: number;
  uploadId: string;
}

export interface AgentMediaUploadSignedPart {
  partNumber: number;
  url: string;
}

export interface AgentMediaUploadCompletionStatus {
  node?: unknown;
  state: 'unknown' | 'uncommitted' | 'committed';
}

export interface AgentMediaUploadControlPlane {
  readonly apiBaseUrl: string;
  abort: (
    credentials: AgentMediaUploadCredentials,
    uploadId: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  complete: (
    credentials: AgentMediaUploadCredentials,
    input: {
      clientOperationId: string;
      conflictPolicy: 'error' | 'auto_rename' | 'replace';
      parts: Array<{ etag: string; partNumber: number }>;
      uploadId: string;
    },
    signal: AbortSignal,
  ) => Promise<unknown>;
  init: (
    credentials: AgentMediaUploadCredentials,
    input: AgentMediaUploadInitInput,
    signal: AbortSignal,
  ) => Promise<AgentMediaUploadInitResult>;
  reconcile: (
    credentials: AgentMediaUploadCredentials,
    clientOperationId: string,
    signal: AbortSignal,
  ) => Promise<AgentMediaUploadCompletionStatus>;
  sign: (
    credentials: AgentMediaUploadCredentials,
    uploadId: string,
    partNumbers: number[],
    signal: AbortSignal,
  ) => Promise<AgentMediaUploadSignedPart[]>;
  verifyAccount: (
    credentials: AgentMediaUploadCredentials,
    expectedUserId: number,
    signal: AbortSignal,
  ) => Promise<void>;
}

interface AgentMediaUploadControlPlaneOptions {
  apiBaseUrl?: string;
  deadlineMs?: number;
  idleTimeoutMs?: number;
  maxResponseBytes?: number;
}

interface ApiEnvelope {
  code?: string | number;
  data?: unknown;
}

interface JsonResponse {
  body: unknown;
  status: number;
}

function abortError(): Error {
  const error = new Error('Agent 上传已取消');
  error.name = 'AbortError';
  return error;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeApiBaseUrl(value: unknown): string {
  const raw = String(value || '').trim().replace(/\/+$/u, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Agent API 基址无效');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Agent API 基址无效');
  }
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  return `${parsed.origin}${pathname}`;
}

export function resolveAgentMediaUploadApiBaseUrl(): string {
  const configured = typeof __OMNIFLOW_API_BASE_URL__ === 'string'
    ? __OMNIFLOW_API_BASE_URL__
    : '';
  return normalizeApiBaseUrl(configured || DEFAULT_API_BASE_URL);
}

function normalizeCredential(
  value: unknown,
  maxLength: number,
): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength || /[\0\r\n]/u.test(normalized)) {
    throw new AgentMediaUploadControlPlaneError('auth_expired');
  }
  return normalized;
}

function normalizeCredentials(input: AgentMediaUploadCredentials): AgentMediaUploadCredentials {
  return {
    token: normalizeCredential(input?.token, MAX_TOKEN_LENGTH),
    username: normalizeCredential(input?.username, MAX_USERNAME_LENGTH),
  };
}

function normalizeUploadId(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > MAX_UPLOAD_ID_LENGTH || /[\0\r\n]/u.test(normalized)) {
    throw new AgentMediaUploadControlPlaneError('invalid_response');
  }
  return normalized;
}

function normalizePositiveInteger(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function reasonForStatus(status: number): AgentMediaUploadControlPlaneErrorReason {
  if (status === 401) return 'auth_expired';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout';
  if (status === 410) return 'session_expired';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'server_error';
}

function safeJsonParse(buffer: Buffer): unknown {
  if (buffer.length === 0) return undefined;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new AgentMediaUploadControlPlaneError('invalid_response');
  }
}

function unwrapEnvelope(response: JsonResponse): unknown {
  if (response.status === 204) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new AgentMediaUploadControlPlaneError(
      reasonForStatus(response.status),
      response.status,
    );
  }
  if (!isObject(response.body)) {
    throw new AgentMediaUploadControlPlaneError('invalid_response', response.status);
  }
  const envelope = response.body as ApiEnvelope;
  if (envelope.code !== undefined && String(envelope.code) !== '0') {
    const reason = String(envelope.code) === 'A00200' ? 'auth_expired' : 'invalid_request';
    throw new AgentMediaUploadControlPlaneError(reason, response.status);
  }
  return Object.prototype.hasOwnProperty.call(envelope, 'data')
    ? envelope.data
    : response.body;
}

function buildApiUrl(apiBaseUrl: string, relativePath: string): URL {
  const base = new URL(`${apiBaseUrl}/`);
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  const resolved = new URL(normalizedPath, base);
  if (
    resolved.origin !== base.origin
    || !resolved.pathname.startsWith(base.pathname)
    || resolved.username
    || resolved.password
    || resolved.hash
  ) {
    throw new Error('Agent 上传控制面路径无效');
  }
  return resolved;
}

function requestJson(
  url: URL,
  input: {
    body?: unknown;
    credentials: AgentMediaUploadCredentials;
    deadlineMs: number;
    idleTimeoutMs: number;
    maxResponseBytes: number;
    method: 'DELETE' | 'GET' | 'POST';
    signal?: AbortSignal;
  },
): Promise<JsonResponse> {
  if (input.signal?.aborted) return Promise.reject(abortError());
  const credentials = normalizeCredentials(input.credentials);
  const body = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let response: IncomingMessage | undefined;
    let settled = false;
    let responseEnded = false;
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    const request = transport.request({
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.token}`,
        ...(body ? {
          'Content-Length': String(body.length),
          'Content-Type': 'application/json',
        } : {}),
        username: credentials.username,
      },
      hostname: url.hostname,
      method: input.method,
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : undefined,
      protocol: url.protocol,
    });
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      input.signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };
    const fail = (error: unknown) => {
      const normalized = error instanceof AgentMediaUploadControlPlaneError
        || (error instanceof Error && error.name === 'AbortError')
        ? error
        : new AgentMediaUploadControlPlaneError('network_error');
      finish(() => {
        response?.destroy();
        request.destroy();
        reject(normalized);
      });
    };
    const handleAbort = () => fail(abortError());
    const deadlineTimer = setTimeout(() => {
      fail(new AgentMediaUploadControlPlaneError('request_timeout'));
    }, Math.max(1, input.deadlineMs));
    deadlineTimer.unref?.();
    request.on('error', (error) => fail(error));
    input.signal?.addEventListener('abort', handleAbort, { once: true });
    if (input.signal?.aborted) {
      handleAbort();
      return;
    }
    request.setTimeout(Math.max(1, input.idleTimeoutMs), () => {
      fail(new AgentMediaUploadControlPlaneError('request_timeout'));
    });
    request.on('response', (incoming) => {
      response = incoming;
      incoming.setTimeout(Math.max(1, input.idleTimeoutMs), () => {
        fail(new AgentMediaUploadControlPlaneError('request_timeout'));
      });
      incoming.on('data', (chunk: Buffer) => {
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > input.maxResponseBytes) {
          fail(new AgentMediaUploadControlPlaneError('invalid_response'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('aborted', () => {
        fail(new AgentMediaUploadControlPlaneError('network_error'));
      });
      incoming.on('error', () => {
        fail(new AgentMediaUploadControlPlaneError('network_error'));
      });
      incoming.on('end', () => {
        responseEnded = true;
        if (!incoming.complete) {
          fail(new AgentMediaUploadControlPlaneError('network_error'));
          return;
        }
        let parsed: unknown;
        try {
          parsed = safeJsonParse(Buffer.concat(chunks));
        } catch (error) {
          fail(error);
          return;
        }
        finish(() => resolve({ body: parsed, status: incoming.statusCode || 0 }));
      });
      incoming.on('close', () => {
        if (!responseEnded && !settled) {
          fail(new AgentMediaUploadControlPlaneError('network_error'));
        }
      });
    });
    if (body) request.write(body);
    request.end();
  });
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new AgentMediaUploadControlPlaneError('invalid_response');
  }
  return value;
}

export function createAgentMediaUploadControlPlane(
  options: AgentMediaUploadControlPlaneOptions = {},
): AgentMediaUploadControlPlane {
  const apiBaseUrl = normalizeApiBaseUrl(
    options.apiBaseUrl || resolveAgentMediaUploadApiBaseUrl(),
  );
  const deadlineMs = Math.max(1, options.deadlineMs || CONTROL_REQUEST_DEADLINE_MS);
  const idleTimeoutMs = Math.max(1, options.idleTimeoutMs || CONTROL_SOCKET_IDLE_TIMEOUT_MS);
  const maxResponseBytes = Math.max(
    1,
    options.maxResponseBytes || MAX_CONTROL_RESPONSE_BYTES,
  );

  async function invoke(
    credentials: AgentMediaUploadCredentials,
    method: 'DELETE' | 'GET' | 'POST',
    relativePath: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await requestJson(buildApiUrl(apiBaseUrl, relativePath), {
      ...(body !== undefined ? { body } : {}),
      credentials,
      deadlineMs,
      idleTimeoutMs,
      maxResponseBytes,
      method,
      ...(signal ? { signal } : {}),
    });
    return unwrapEnvelope(response);
  }

  return {
    apiBaseUrl,
    abort: async (credentials, uploadId, signal) => {
      try {
        await invoke(
          credentials,
          'DELETE',
          `v1/upload/${encodeURIComponent(normalizeUploadId(uploadId))}`,
          undefined,
          signal,
        );
      } catch (error) {
        if (
          error instanceof AgentMediaUploadControlPlaneError
          && error.reason === 'not_found'
        ) return;
        throw error;
      }
    },
    complete: async (credentials, input, signal) => invoke(
      credentials,
      'POST',
      'v1/upload/complete',
      input,
      signal,
    ),
    init: async (credentials, input, signal) => {
      const data = assertObject(await invoke(credentials, 'POST', 'v1/upload/init', input, signal));
      const uploadId = normalizeUploadId(data.uploadId);
      const mode = data.mode === 'single' || data.mode === 'multipart' ? data.mode : null;
      const partSize = normalizePositiveInteger(data.partSize);
      const totalParts = normalizePositiveInteger(data.totalParts);
      if (
        !mode
        || partSize == null
        || totalParts == null
        || totalParts > MAX_TOTAL_PARTS
        || Math.ceil(input.fileSize / partSize) !== totalParts
      ) {
        throw new AgentMediaUploadControlPlaneError('invalid_response');
      }
      return { mode, partSize, totalParts, uploadId };
    },
    reconcile: async (credentials, clientOperationId, signal) => {
      const query = new URLSearchParams({ clientOperationId }).toString();
      const data = assertObject(await invoke(
        credentials,
        'GET',
        `v1/upload/complete/status?${query}`,
        undefined,
        signal,
      ));
      if (
        data.state !== 'unknown'
        && data.state !== 'uncommitted'
        && data.state !== 'committed'
      ) {
        throw new AgentMediaUploadControlPlaneError('invalid_response');
      }
      return {
        ...(data.node !== undefined ? { node: data.node } : {}),
        state: data.state,
      };
    },
    sign: async (credentials, uploadId, partNumbers, signal) => {
      const data = assertObject(await invoke(
        credentials,
        'POST',
        'v1/upload/parts/sign',
        { partNumbers, uploadId: normalizeUploadId(uploadId) },
        signal,
      ));
      if (!Array.isArray(data.parts)) {
        throw new AgentMediaUploadControlPlaneError('invalid_response');
      }
      return data.parts.map((part) => {
        const value = assertObject(part);
        const partNumber = normalizePositiveInteger(value.partNumber);
        const url = String(value.url || '').trim();
        if (
          partNumber == null
          || !partNumbers.includes(partNumber)
          || !url
          || url.length > MAX_SIGNED_URL_LENGTH
          || /[\0\r\n]/u.test(url)
        ) {
          throw new AgentMediaUploadControlPlaneError('invalid_response');
        }
        return { partNumber, url };
      });
    },
    verifyAccount: async (credentials, expectedUserId, signal) => {
      const data = assertObject(await invoke(credentials, 'GET', 'v1/user/me', undefined, signal));
      if (normalizePositiveInteger(data.id) !== expectedUserId) {
        throw new AgentMediaUploadControlPlaneError('forbidden', 403);
      }
    },
  };
}

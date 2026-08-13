import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { clearAuthSessionAndDisposeWorkspaces } from '@/service/auth-session-release';

// 存储迁移 HTTP 客户端：6 端点的轻封装。
// 调用走 electronAPI.fetch（主进程，避免 CORS / Cookie 问题）。

export interface MigrationTask {
  id: string;
  actorId: string;
  libraryId: number;
  rootNodeId: number;
  targetProvider: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | string;
  totalObjects: number;
  completedObjects: number;
  failedObjects: number;
  skippedObjects: number;
  totalBytes: number;
  transferredBytes: number;
  currentObjectKey: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface MigrationTaskItem {
  id: number;
  taskId: string;
  storageObjectId: number;
  sourceProvider: string;
  sourceBucket: string;
  sourceKey: string;
  targetStorageObjectId: number;
  targetKey: string;
  fileSize: number;
  status: string;
  errorMessage: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface EnqueueMigrationRequest {
  libraryId: number;
  rootNodeId: number;
  targetProvider: string;
}

export interface EnqueueMigrationResult {
  task?: MigrationTask;
  plannedObjects: number;
  plannedBytes: number;
  targetProvider: string;
  targetBucket: string;
  storageObjectIds: number[];
}

export interface StorageDistributionEntry {
  provider: string;
  fileCount: number;
  totalBytes: number;
}

export interface StorageDistributionResult {
  byProvider: StorageDistributionEntry[];
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

interface DryRunEnvelope<T> {
  dryRun?: boolean;
  result?: T;
}

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
    throw new Error('migration response invalid');
  }
  const wrapped = envelope as ApiEnvelope<T>;
  if (wrapped.success === false) {
    throw new Error(String(wrapped.message ?? 'migration request failed'));
  }
  if (wrapped.data === undefined) {
    return envelope as T;
  }
  const data = wrapped.data;
  if (isObject(data) && 'dryRun' in (data as object) && 'result' in (data as object)) {
    const dr = data as DryRunEnvelope<T>;
    return (dr.result ?? data) as T;
  }
  return data as T;
}

async function requestJson<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const url = `${API_CONFIG.BASE_URL}${path}`;
  const res = (await window.electronAPI.fetch(url, {
    method: init.method,
    headers: buildHeaders(),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })) as IpcHttpResponse;

  const status = Number(res?.status ?? 0);
  if (status === 401) {
    await clearAuthSessionAndDisposeWorkspaces({
      reason: `migration auth expired ${path}`,
      redirectToLogin: true,
    });
    throw new Error(`登录状态已失效 (${path})`);
  }
  if (status === 204) {
    return undefined as unknown as T;
  }
  if (status >= 400) {
    const body = res?.body as unknown;
    const msg = isObject(body) ? String((body as ApiEnvelope<T>).message ?? '') : '';
    throw new Error(`migration HTTP ${status}: ${msg || path}`);
  }
  return unwrapData<T>(res?.body);
}

export async function enqueueMigration(
  req: EnqueueMigrationRequest,
  options?: { dryRun?: boolean },
): Promise<EnqueueMigrationResult> {
  const qs = options?.dryRun ? '?dryRun=true' : '';
  return requestJson<EnqueueMigrationResult>(`/v1/migration/tasks${qs}`, {
    method: 'POST',
    body: req,
  });
}

export async function listMigrationTasks(params: {
  libraryId?: number;
  status?: string[];
  limit?: number;
}): Promise<MigrationTask[]> {
  const search = new URLSearchParams();
  if (params.libraryId && params.libraryId > 0) search.set('libraryId', String(params.libraryId));
  if (params.status && params.status.length > 0) search.set('status', params.status.join(','));
  if (params.limit && params.limit > 0) search.set('limit', String(params.limit));
  const qs = search.toString();
  const res = await requestJson<{ tasks: MigrationTask[] }>(
    `/v1/migration/tasks${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
  );
  return Array.isArray(res?.tasks) ? res.tasks : [];
}

export async function getMigrationTask(taskId: string): Promise<MigrationTask> {
  const res = await requestJson<{ task: MigrationTask }>(
    `/v1/migration/tasks/${encodeURIComponent(taskId)}`,
    { method: 'GET' },
  );
  return res.task;
}

export async function listMigrationTaskItems(taskId: string): Promise<MigrationTaskItem[]> {
  const res = await requestJson<{ items: MigrationTaskItem[] }>(
    `/v1/migration/tasks/${encodeURIComponent(taskId)}/items`,
    { method: 'GET' },
  );
  return Array.isArray(res?.items) ? res.items : [];
}

export async function cancelMigrationTask(
  taskId: string,
  options?: { dryRun?: boolean },
): Promise<void> {
  const qs = options?.dryRun ? '?dryRun=true' : '';
  await requestJson<void>(`/v1/migration/tasks/${encodeURIComponent(taskId)}/cancel${qs}`, {
    method: 'POST',
  });
}

export async function getStorageDistribution(
  libraryId: number,
  nodeId: number,
): Promise<StorageDistributionEntry[]> {
  const res = await requestJson<StorageDistributionResult>(
    `/v1/libraries/${libraryId}/storage-distribution?nodeId=${nodeId}`,
    { method: 'GET' },
  );
  return Array.isArray(res?.byProvider) ? res.byProvider : [];
}

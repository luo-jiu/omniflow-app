import { createIpcChunkedUploadTask, createIpcUploadTask, ipcRequest as request, ipcUpload } from '@/service/request/ipcRequest';
import type { ArchiveBuiltInType } from '@/shared/file-viewer-types';
import { CHUNKED_UPLOAD_THRESHOLD_BYTES, MAX_SINGLE_UPLOAD_BYTES, MAX_SINGLE_UPLOAD_ERROR_MESSAGE } from '@/shared/upload-limits';

const ENABLE_CHUNKED_UPLOAD = false;

export type Library = {
  createdAt: string;
  updatedAt: string;
  id: number;
  userId: number;
  name: string;
  delFlag: number;
  starred: boolean;
};

const LIST_KEYS = ['list', 'records', 'items', 'libraries', 'content', 'result', 'data'] as const;
type NodeKind = 'dir' | 'file';

function resolveNodeType(source: Record<string, unknown> | null | undefined, fallback: NodeKind = 'file'): NodeKind {
  if (!source) return fallback;

  const candidates = [source.type, source.nodeType, source.node_type];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'dir' || normalized === 'directory' || normalized === 'folder' || normalized === '0') {
      return 'dir';
    }
    if (normalized === 'file' || normalized === '1') {
      return 'file';
    }
  }

  return fallback;
}

function normalizeNodePayload<T extends Record<string, unknown>>(source: T, fallback: NodeKind = 'file'): T & { type: NodeKind } {
  return {
    ...source,
    type: resolveNodeType(source, fallback),
  };
}

function extractDataPayload<T = unknown>(response: any): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data as T;
  }
  return response as T;
}

function extractLibraryArray(payload: unknown): Library[] {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload as Library[];
  }

  if (typeof payload !== 'object' || payload === null) {
    return [];
  }

  const normalizedPayload = payload as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    const candidate = normalizedPayload[key];
    if (Array.isArray(candidate)) {
      return candidate as Library[];
    }
  }

  return [];
}

function normalizeLibrary(raw: Record<string, unknown>): Library {
  const starredValue = raw.starred;
  return {
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    id: Number(raw.id || 0),
    userId: Number(raw.userId || 0),
    name: String(raw.name || ''),
    delFlag: Number(raw.delFlag || 0),
    starred: starredValue === true || starredValue === 1 || starredValue === '1',
  };
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toNumberOrDefault(value: unknown, defaultValue = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

function normalizeNodeDetailPayload(source: Record<string, unknown>): NodeDetailDTO {
  const normalized = normalizeNodePayload(source);
  return {
    createdAt: toOptionalString(normalized.createdAt ?? normalized.created_at),
    id: toNumberOrDefault(normalized.id),
    name: String(normalized.name ?? ''),
    type: normalized.type,
    parentId: toNumberOrDefault(normalized.parentId ?? normalized.parent_id),
    libraryId: toNumberOrDefault(normalized.libraryId ?? normalized.library_id),
    ext: toOptionalString(normalized.ext),
    mimeType: toOptionalString(normalized.mimeType ?? normalized.mime_type),
    fileSize: toOptionalNumber(normalized.fileSize ?? normalized.file_size),
    storageKey: toOptionalString(normalized.storageKey ?? normalized.storage_key),
    storageProvider: toOptionalString(normalized.storageProvider ?? normalized.storage_provider),
    storageProviderType: toOptionalString(normalized.storageProviderType ?? normalized.storage_provider_type),
    storageProviderLabel: toOptionalString(normalized.storageProviderLabel ?? normalized.storage_provider_label),
    storageEndpoint: toOptionalString(normalized.storageEndpoint ?? normalized.storage_endpoint),
    storageBucket: toOptionalString(normalized.storageBucket ?? normalized.storage_bucket),
    builtInType: toOptionalString(normalized.builtInType ?? normalized.built_in_type),
    archiveMode: toOptionalNumber(normalized.archiveMode ?? normalized.archive_mode),
    updatedAt: toOptionalString(normalized.updatedAt ?? normalized.updated_at),
    viewMeta: normalized.viewMeta === null ? null : toOptionalString(normalized.viewMeta ?? normalized.view_meta),
  };
}

function normalizeRecycleBinItemPayload(source: Record<string, unknown>): RecycleBinItem {
  const normalized = normalizeNodePayload(source);
  return {
    id: toNumberOrDefault(normalized.id),
    name: String(normalized.name ?? ''),
    ext: toOptionalString(normalized.ext),
    mimeType: toOptionalString(normalized.mimeType ?? normalized.mime_type),
    fileSize: toOptionalNumber(normalized.fileSize ?? normalized.file_size),
    type: normalized.type,
    parentId: toNumberOrDefault(normalized.parentId ?? normalized.parent_id),
    libraryId: toNumberOrDefault(normalized.libraryId ?? normalized.library_id),
    deletedAt: String(normalized.deletedAt ?? normalized.deleted_at ?? ''),
    deletedDescendantCount: toOptionalNumber(normalized.deletedDescendantCount ?? normalized.deleted_descendant_count),
  };
}

function assertUploadFileSize(file: File) {
  const fileSize = Number(file.size || 0);
  if (fileSize > MAX_SINGLE_UPLOAD_BYTES) {
    throw new Error(MAX_SINGLE_UPLOAD_ERROR_MESSAGE);
  }
}

// 获取仓库列表
export async function fetchRepositories(lastId?: number, size = 10): Promise<Library[]> {
  const query = new URLSearchParams({
    ...(lastId !== undefined ? { lastId: String(lastId) } : {}),
    size: String(size),
  });
  const body = await request(`/v1/libraries/scroll?${query}`, {
    method: 'GET',
  });
  const listSource = body?.data ?? body;
  return extractLibraryArray(listSource).map(item => normalizeLibrary(item as Record<string, unknown>));
}

// 创建仓库
export async function createLibrary(payload: { userId: number; name: string }) {
  const body = await request('/v1/libraries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return body.data;
}

// 重命名库
export async function renameLibrary(id: number, name: string) {
  return updateLibrary(id, { name });
}

export async function updateLibrary(id: number, payload: { name?: string; starred?: number }) {
  const body = await request(`/v1/libraries/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return body.data
}

export async function toggleLibraryStar(id: number, starred: boolean) {
  return updateLibrary(id, { starred: starred ? 1 : 0 });
}

// 删除仓库
export async function deleteLibrary(id: number) {
  return await request(`/v1/libraries/${id}`, {
    method: 'DELETE',
  });
}

// 获取直接子节点
export async function getChildrenByNodeId(nodeId: number, libraryId: number) {
  const body = await request(`/v1/nodes/${nodeId}/children?libraryId=${libraryId}`, {
    method: 'GET',
  });
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    if (item && typeof item === 'object') {
      return normalizeNodePayload(item as Record<string, unknown>);
    }
    return item;
  });
}

// 获取当前节点及其完整子树（包含当前节点）
export async function getAllDescendantsByNodeId(nodeId: number, libraryId: number) {
  const body = await request(`/v1/nodes/${nodeId}/descendants?libraryId=${libraryId}`, {
    method: 'GET',
  });
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    if (item && typeof item === 'object') {
      return normalizeNodePayload(item as Record<string, unknown>);
    }
    return item;
  });
}

// 获取库根节点（后端会在必要时自动修复根结构与闭包关系）
export async function getLibraryRootNodeId(libraryId: number): Promise<number> {
  const body = await request(`/v1/nodes/library/${libraryId}/root`, {
    method: 'GET',
  });
  return Number(body?.data || 0);
}

export interface NodeDetailDTO {
  createdAt?: string;
  id: number;
  name: string;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  storageKey?: string;
  storageProvider?: string;
  storageProviderType?: string;
  storageProviderLabel?: string;
  storageEndpoint?: string;
  storageBucket?: string;
  builtInType?: string;
  archiveMode?: number;
  updatedAt?: string;
  viewMeta?: string | null;
}

export type NodeNameConflictPolicy = 'error' | 'auto_rename' | 'replace';

export async function fetchNodeDetailById(nodeId: number): Promise<NodeDetailDTO> {
  const body = await request(`/v1/nodes/${nodeId}`, {
    method: 'GET',
  });
  const data = body?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('节点详情响应数据异常');
  }
  return normalizeNodeDetailPayload(data as Record<string, unknown>);
}

export async function updateNodeFileContent(payload: {
  nodeId: number;
  libraryId: number;
  content: string;
  contentType?: string;
}): Promise<NodeDetailDTO> {
  const body = await request(`/v1/nodes/${payload.nodeId}/content`, {
    method: 'PUT',
    body: JSON.stringify({
      libraryId: payload.libraryId,
      content: payload.content,
      contentType: payload.contentType,
    }),
  });
  const data = body?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('文件内容保存响应数据异常');
  }
  return normalizeNodeDetailPayload(data as Record<string, unknown>);
}

// 上传文件并创建节点
export async function uploadAndCreateNode(
  file: File,
  parentId: number,
  libraryId: number,
  options?: {
    conflictPolicy?: NodeNameConflictPolicy;
    onProgress?: (uploadedBytes: number, totalBytes: number, percentage: number, speedBps: number) => void;
    setAbort?: (aborter: () => void | Promise<void | boolean>) => void;
    storageProvider?: string;
  },
) {
  assertUploadFileSize(file);

  const filePath = (file as any).path;
  if (!filePath) {
    throw new Error("Unable to retrieve file path for upload.");
  }

  if (ENABLE_CHUNKED_UPLOAD && file.size >= CHUNKED_UPLOAD_THRESHOLD_BYTES) {
    const uploadTask = createIpcChunkedUploadTask<any>(
      filePath,
      {
        libraryId,
        parentId,
        fileName: file.name,
        fileSize: file.size,
        conflictPolicy: options?.conflictPolicy,
        storageProvider: options?.storageProvider,
      },
      (progress) => {
        if (options?.onProgress) {
          options.onProgress(
            progress.uploadedBytes,
            progress.totalBytes,
            progress.percentage,
            progress.speedBps,
          );
        }
      },
    );

    options?.setAbort?.(uploadTask.abort);

    const json = await uploadTask.promise;
    if (!json) throw new Error('上传响应为空');
    const d = extractDataPayload<Record<string, unknown>>(json);
    if (!d || typeof d !== 'object') throw new Error('上传响应数据异常');
    return normalizeNodePayload(d as Record<string, unknown>, 'file');
  }

  const formDataParams: Record<string, string> = {
    parent_id: String(parentId),
    library_id: String(libraryId),
  };
  if (options?.conflictPolicy) {
    formDataParams.conflictPolicy = options.conflictPolicy;
  }
  if (options?.storageProvider) {
    formDataParams.storage_provider = options.storageProvider;
  }

  const uploadTask = createIpcUploadTask<any>(
    "/v1/directory/upload",
    filePath,
    formDataParams,
    (progress) => {
      if (options?.onProgress) {
        options.onProgress(
          progress.uploadedBytes,
          progress.totalBytes,
          progress.percentage,
          progress.speedBps,
        );
      }
    },
  );

  if (options?.setAbort) {
    options.setAbort(uploadTask.abort);
  }

  const json = await uploadTask.promise;
  if (!json) {
    throw new Error('上传响应为空');
  }

  const d = extractDataPayload<Record<string, unknown>>(json);
  if (!d || typeof d !== 'object') {
    throw new Error('上传响应数据异常');
  }
  return normalizeNodePayload(d as Record<string, unknown>, 'file');
}

// 兼容旧上传（无进度）
export async function uploadAndCreateNodeLegacy(file: File, parentId: number, libraryId: number) {
  assertUploadFileSize(file);

  const json = await ipcUpload("/v1/directory/upload", (file as any).path, {
    parent_id: String(parentId),
    library_id: String(libraryId),
  });

  const d = extractDataPayload<Record<string, unknown>>(json);
  if (!d || typeof d !== 'object') {
    throw new Error('上传响应数据异常');
  }
  return normalizeNodePayload(d as Record<string, unknown>, 'file');
}

export async function uploadLocalPathAndCreateNode(
  filePath: string,
  parentId: number,
  libraryId: number,
  options?: {
    conflictPolicy?: NodeNameConflictPolicy;
  },
) {
  const normalizedFilePath = String(filePath || '').trim();
  if (!normalizedFilePath) {
    throw new Error('上传路径不能为空');
  }

  const formDataParams: Record<string, string> = {
    parent_id: String(parentId),
    library_id: String(libraryId),
  };
  if (options?.conflictPolicy) {
    formDataParams.conflictPolicy = options.conflictPolicy;
  }

  const json = await ipcUpload("/v1/directory/upload", normalizedFilePath, formDataParams);

  const d = extractDataPayload<Record<string, unknown>>(json);
  if (!d || typeof d !== 'object') {
    throw new Error('上传响应数据异常');
  }
  return normalizeNodePayload(d as Record<string, unknown>, 'file');
}

// 创建节点（新建文件或文件夹）
export async function createNode(payload: {
  name: string;
  parentId: number;
  libraryId: number;
  type: 'dir' | 'file';
  ext?: string;
  conflictPolicy?: NodeNameConflictPolicy;
}) {
  // 后端期望 type 为数字：0=文件夹，1=文件
  const body = await request('/v1/nodes', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      ext: payload.ext?.trim().replace(/^\./, ''),
      parentId: payload.parentId,
      libraryId: payload.libraryId,
      type: payload.type === 'dir' ? 0 : 1,
      conflictPolicy: payload.conflictPolicy,
    }),
  });
  const d = body.data;
  return normalizeNodePayload(d as Record<string, unknown>, payload.type);
}

// 重命名节点
export async function renameNode(payload: {
  id: number;
  name: string;
  ext?: string;
}) {
  const body = await request(`/v1/nodes/${payload.id}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      ext: payload.ext ?? '',
    }),
  });
  return body.data;
}

// 更新节点内置配置（内置类型/归档模式）
export async function updateNodeConfig(payload: {
  id: number;
  builtInType?: string;
  archiveMode?: number;
  viewMeta?: string | null;
}) {
  const body = await request(`/v1/nodes/${payload.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: payload.id,
      builtInType: payload.builtInType,
      archiveMode: payload.archiveMode,
      viewMeta: payload.viewMeta,
    }),
  });
  return body.data;
}

export interface MoveNodesBatchItemPayload {
  nodeId: number;
  name?: string;
}

export interface MoveNodesBatchResult {
  movedCount: number;
  affectedParentIds: number[];
  movedNodeIds: number[];
}

// 移动节点（单拖/多拖统一走批量接口）
export async function moveNodesBatch(payload: {
  items: MoveNodesBatchItemPayload[];
  newParentId: number;
  beforeNodeId?: number | null;
  libraryId: number;
}): Promise<MoveNodesBatchResult> {
  const normalizedItems = (payload.items || [])
    .map((item) => ({
      nodeId: Number(item.nodeId),
      name: String(item.name ?? ''),
    }))
    .filter(item => Number.isFinite(item.nodeId) && item.nodeId > 0);

  const body = await request('/v1/nodes/move/batch', {
    method: 'PATCH',
    body: JSON.stringify({
      newParentId: payload.newParentId,
      beforeNodeId: payload.beforeNodeId ?? null,
      libraryId: payload.libraryId,
      items: normalizedItems,
    }),
  });

  const data = (body?.data ?? {}) as Record<string, unknown>;
  const affectedRaw = Array.isArray(data.affectedParentIds) ? data.affectedParentIds : [];
  const movedRaw = Array.isArray(data.movedNodeIds) ? data.movedNodeIds : [];

  return {
    movedCount: toNumberOrDefault(data.movedCount),
    affectedParentIds: affectedRaw
      .map(item => toNumberOrDefault(item))
      .filter(item => item > 0),
    movedNodeIds: movedRaw
      .map(item => toNumberOrDefault(item))
      .filter(item => item > 0),
  };
}

// 漫画目录：按名称重排直接子项（重建 sort_order 间隔）
export async function sortComicChildrenByName(nodeId: number) {
  const body = await request(`/v1/nodes/${nodeId}/comic/sort-by-name`, {
    method: 'PATCH',
  });
  return body.data;
}

export interface BatchSetArchiveChildrenBuiltInTypeResult {
  nodeId: number;
  libraryId: number;
  builtInType: string;
  totalChildren: number;
  dirChildren: number;
  updatedCount: number;
}

export async function batchSetArchiveChildrenBuiltInType(
  nodeId: number,
): Promise<BatchSetArchiveChildrenBuiltInTypeResult> {
  const body = await request(`/v1/nodes/${nodeId}/archive/built-in-type/batch-set`, {
    method: 'PATCH',
  });

  const payload = (body?.data ?? {}) as Record<string, unknown>;
  return {
    nodeId: toNumberOrDefault(payload.nodeId),
    libraryId: toNumberOrDefault(payload.libraryId),
    builtInType: String(payload.builtInType ?? ''),
    totalChildren: toNumberOrDefault(payload.totalChildren),
    dirChildren: toNumberOrDefault(payload.dirChildren),
    updatedCount: toNumberOrDefault(payload.updatedCount),
  };
}

export interface ArchiveCardDTO {
  id: number;
  name: string;
  sortOrder?: number;
  viewMeta?: string;
  coverNodeId?: number;
}

export interface ArchiveCardsPageResult {
  items: ArchiveCardDTO[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function fetchArchiveCardsPage(payload: {
  nodeId: number;
  libraryId: number;
  builtInType: ArchiveBuiltInType;
  offset?: number;
  limit?: number;
}): Promise<ArchiveCardsPageResult> {
  const query = new URLSearchParams({
    libraryId: String(payload.libraryId),
    builtInType: payload.builtInType,
    offset: String(Math.max(Math.floor(payload.offset ?? 0), 0)),
    limit: String(Math.max(Math.floor(payload.limit ?? 24), 1)),
  });
  const body = await request(`/v1/nodes/${payload.nodeId}/archive/cards?${query}`, {
    method: 'GET',
  });

  const data = (body?.data ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: ArchiveCardDTO[] = rawItems
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map(item => ({
      id: toNumberOrDefault(item.id),
      name: String(item.name ?? ''),
      sortOrder: toOptionalNumber(item.sortOrder ?? item.sort_order),
      viewMeta: toOptionalString(item.viewMeta ?? item.view_meta),
      coverNodeId: toOptionalNumber(item.coverNodeId ?? item.cover_node_id),
    }))
    .filter(item => item.id > 0);

  return {
    items,
    total: toNumberOrDefault(data.total),
    offset: toNumberOrDefault(data.offset),
    limit: toNumberOrDefault(data.limit, payload.limit ?? 24),
    hasMore: Boolean(data.hasMore ?? data.has_more),
  };
}

export async function batchGetFileLinks(payload: {
  libraryId: number;
  nodeIds: number[];
  expiry?: number;
}): Promise<Map<number, string>> {
  const normalizedNodeIds = payload.nodeIds
    .map(item => Math.floor(Number(item)))
    .filter(item => Number.isFinite(item) && item > 0);
  if (normalizedNodeIds.length === 0) {
    return new Map<number, string>();
  }

  const body = await request('/v1/directory/links/batch', {
    method: 'POST',
    body: JSON.stringify({
      libraryId: payload.libraryId,
      nodeIds: normalizedNodeIds,
      expiry: payload.expiry ?? 120,
    }),
  });

  const data = body?.data;
  const rows = Array.isArray(data) ? data : [];
  const map = new Map<number, string>();
  rows.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const normalized = item as Record<string, unknown>;
    const nodeId = toNumberOrDefault(normalized.nodeId ?? normalized.node_id);
    const url = String(normalized.url ?? '');
    if (nodeId > 0 && url) {
      map.set(nodeId, url);
    }
  });
  return map;
}

// 删除节点及其后代
export async function deleteNodeAndChildren(ancestorId: number, libraryId: number) {
  const body = await request(`/v1/nodes/${ancestorId}/library/${libraryId}`, {
    method: 'DELETE',
  });
  return body.data;
}

export interface RecycleBinItem {
  id: number;
  name: string;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
  deletedAt: string;
  deletedDescendantCount?: number;
}

export async function fetchRecycleBinItems(libraryId: number): Promise<RecycleBinItem[]> {
  const body = await request(`/v1/nodes/recycle/library/${libraryId}`, {
    method: 'GET',
  });
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => normalizeRecycleBinItemPayload(item));
}

export async function restoreNodeAndChildren(ancestorId: number, libraryId: number): Promise<boolean> {
  const body = await request(`/v1/nodes/${ancestorId}/library/${libraryId}/restore`, {
    method: 'PATCH',
  });
  return Boolean(body?.data);
}

export async function hardDeleteNodeAndChildren(ancestorId: number, libraryId: number): Promise<boolean> {
  const body = await request(`/v1/nodes/${ancestorId}/library/${libraryId}/hard`, {
    method: 'DELETE',
  });
  return Boolean(body?.data);
}

export async function clearRecycleBin(libraryId: number): Promise<number> {
  const body = await request(`/v1/nodes/recycle/library/${libraryId}/clear`, {
    method: 'DELETE',
  });
  const count = Number(body?.data?.clearedCount ?? body?.data ?? 0);
  return Number.isFinite(count) ? count : 0;
}

// 获取文件的临时访问链接
export async function getFileLink(nodeId: number, libraryId: number, expiry: number = 60): Promise<string> {
  const query = new URLSearchParams({
    node_id: String(nodeId),
    library_id: String(libraryId),
    expiry: String(expiry),
  });
  
  const body = await request(`/v1/directory/link?${query}`, {
    method: 'GET',
  });
  return body.data || body;
}

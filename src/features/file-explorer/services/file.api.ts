import { createIpcUploadTask, ipcRequest as request, ipcUpload } from '@/service/request/ipcRequest';
import { MAX_SINGLE_UPLOAD_BYTES, MAX_SINGLE_UPLOAD_ERROR_MESSAGE } from '@/shared/upload-limits';

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
    id: toNumberOrDefault(normalized.id),
    name: String(normalized.name ?? ''),
    type: normalized.type,
    parentId: toNumberOrDefault(normalized.parentId ?? normalized.parent_id),
    libraryId: toNumberOrDefault(normalized.libraryId ?? normalized.library_id),
    ext: toOptionalString(normalized.ext),
    mimeType: toOptionalString(normalized.mimeType ?? normalized.mime_type),
    fileSize: toOptionalNumber(normalized.fileSize ?? normalized.file_size),
    builtInType: toOptionalString(normalized.builtInType ?? normalized.built_in_type),
    archiveMode: toOptionalNumber(normalized.archiveMode ?? normalized.archive_mode),
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
  id: number;
  name: string;
  type: 'dir' | 'file';
  parentId: number;
  libraryId: number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
  builtInType?: string;
  archiveMode?: number;
  viewMeta?: string | null;
}

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

// 上传文件并创建节点
export async function uploadAndCreateNode(
  file: File,
  parentId: number,
  libraryId: number,
  options?: {
    onProgress?: (uploadedBytes: number, totalBytes: number, percentage: number, speedBps: number) => void;
    setAbort?: (aborter: () => void | Promise<void | boolean>) => void;
  },
) {
  assertUploadFileSize(file);

  const filePath = (file as any).path;
  if (!filePath) {
    throw new Error("Unable to retrieve file path for upload.");
  }

  const uploadTask = createIpcUploadTask<any>(
    "/v1/directory/upload",
    filePath,
    {
      parent_id: String(parentId),
      library_id: String(libraryId),
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

// 创建节点（新建文件或文件夹）
export async function createNode(payload: {
  name: string;
  parentId: number;
  libraryId: number;
  type: 'dir' | 'file';
}) {
  // 后端期望 type 为数字：0=文件夹，1=文件
  const body = await request('/v1/nodes', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      parentId: payload.parentId,
      libraryId: payload.libraryId,
      type: payload.type === 'dir' ? 0 : 1,
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

// 移动节点（支持同级排序与跨目录移动）
export async function moveNode(payload: {
  nodeId: number;
  name: string;
  newParentId: number;
  beforeNodeId?: number | null;
  libraryId: number;
}) {
  const body = await request(`/v1/nodes/${payload.nodeId}/move`, {
    method: 'PATCH',
    body: JSON.stringify({
      nodeId: payload.nodeId,
      name: payload.name,
      newParentId: payload.newParentId,
      beforeNodeId: payload.beforeNodeId ?? null,
      libraryId: payload.libraryId,
    }),
  });
  return body.data;
}

// 漫画目录：按名称重排直接子项（重建 sort_order 间隔）
export async function sortComicChildrenByName(nodeId: number) {
  const body = await request(`/v1/nodes/${nodeId}/comic/sort-by-name`, {
    method: 'PATCH',
  });
  return body.data;
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

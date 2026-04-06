import { createIpcUploadTask, ipcRequest as request, ipcUpload } from '@/service/request/ipcRequest';
import { MAX_SINGLE_UPLOAD_BYTES, MAX_SINGLE_UPLOAD_ERROR_MESSAGE } from '@/shared/upload-limits';

export type Library = {
  createdAt: string;
  updatedAt: string;
  id: number;
  userId: number;
  name: string;
  delFlag: number;
  starred?: boolean;
};

const LIST_KEYS = ['list', 'records', 'items', 'libraries', 'content', 'result', 'data'] as const;

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
  return extractLibraryArray(listSource);
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
  const body = await request(`/v1/libraries/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  return body.data
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
  return body?.data || [];
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
  return body?.data as NodeDetailDTO;
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

  if (!json.success) {
    throw new Error(json.message || "上传失败");
  }

  const d = json.data;
  return {
    ...d,
    type: d.type === 0 || d.type === "0" ? "dir" : "file",
  };
}

// 兼容旧上传（无进度）
export async function uploadAndCreateNodeLegacy(file: File, parentId: number, libraryId: number) {
  assertUploadFileSize(file);

  const json = await ipcUpload("/v1/directory/upload", (file as any).path, {
    parent_id: String(parentId),
    library_id: String(libraryId),
  });

  if (!json.success) {
    throw new Error(json.message || "上传失败");
  }

  const d = json.data;
  return {
    ...d,
    type: d.type === 0 || d.type === "0" ? "dir" : "file",
  };
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
  return {
    ...d,
    type: d.type === 0 || d.type === "0" ? "dir" : "file",
  };
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
  const data = (body?.data || []) as RecycleBinItem[];
  return Array.isArray(data) ? data : [];
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

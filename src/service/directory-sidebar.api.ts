import { request } from './request';

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

// 上传文件并创建节点
export async function uploadAndCreateNode(file: File, parentId: number, libraryId: number) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("parent_id", String(parentId));
  formData.append("library_id", String(libraryId));

  const resp = await fetch("http://localhost:8848/api/v1/directory/upload", {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (!json.success) {
    throw new Error(json.message || "上传失败");
  }

  const d = json.data;
  return {
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    libraryId: d.libraryId,
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
  return {
    id: body.data.id,
    name: body.data.name,
    parentId: body.data.parentId,
    libraryId: body.data.libraryId,
    type: body.data.type === 0 || body.data.type === "0" ? "dir" : "file",
  };
}
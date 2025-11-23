import {request} from './request';

// 获取仓库列表
export async function fetchRepositories(lastId?: number, size = 10) {
  const query = new URLSearchParams({
    ...(lastId !== undefined ? { lastId: String(lastId) } : {}),
    size: String(size),
  });
  const body = await request(`/v1/libraries/scroll?${query}`, {
    method: 'GET',
  });
  return body.data;
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
import { request } from './request';

// 获取仓库列表
export async function fetchRepositories(lastId?: number, size = 10) {
  const query = new URLSearchParams({
    ...(lastId !== undefined ? { lastId: String(lastId) } : {}),
    size: String(size),
  });
  const body = await request(`/omniflow/v1/scroll/cursor?${query}`, {
    method: 'GET',
  });
  return body.data;
}

// 获取直接子节点
export async function getChildrenByNodeId(nodeId: number, libraryId: number) {
  const body = await request(`/omniflow/v1/${nodeId}/children?libraryId=${libraryId}`, {
    method: 'GET',
  });
  return body?.data || [];
}
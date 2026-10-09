import { ipcRequest } from '@/service/request/ipcRequest';
import { normalizeAgentLibraryNode } from '@/shared/agent/agent-library-query';
import type { AgentNodeConfig } from '@/shared/agent/agent-node-config';

export async function configureAgentLibraryNode(input: Partial<AgentNodeConfig> & {
  nodeId: number; libraryId: number; expectedUpdatedAt: string;
}): Promise<void> {
  const { nodeId, ...body } = input;
  await ipcRequest(`/v1/nodes/${nodeId}`, {
    method: 'PUT', body: JSON.stringify({ ...body, requireDirectory: true }),
  });
}

export async function copyAgentLibraryNode(input: {
  libraryId: number; nodeId: number; parentId: number; name?: string; recursive?: boolean; conflictPolicy?: 'error' | 'auto_rename';
}) {
  const { nodeId, ...body } = input;
  const response = await ipcRequest(`/v1/nodes/${nodeId}/copy`, { method: 'POST', body: JSON.stringify(body) });
  const data = response?.data;
  if (!data || typeof data !== 'object') throw new Error('复制提交回执无效，请检查目标目录');
  const result = data as Record<string, unknown>;
  const node = normalizeAgentLibraryNode(result.node, input.libraryId);
  if (node.parentId !== input.parentId) throw new Error('复制返回的目标目录不匹配，请核对结果');
  if (!Number.isSafeInteger(result.copiedCount) || Number(result.copiedCount) < 1 || Number(result.copiedCount) > 1000) throw new Error('复制数量回执无效，请核对结果');
  return { node, copiedCount: Number(result.copiedCount) };
}

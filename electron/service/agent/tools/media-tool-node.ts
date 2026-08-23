import type { AgentDirectoryEntry } from '@/shared/agent/agent.types';
import type { AgentToolExecutionContext } from '../agent-tool-registry';

function requestedNodeId(input: unknown): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Number((input as Record<string, unknown>).nodeId);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function visibleNode(
  nodeId: number,
  context: AgentToolExecutionContext,
): AgentDirectoryEntry | null {
  const selectedNodes = context.perception?.selectedNodes || [];
  const directoryEntries = context.perception?.currentDirectory?.entries || [];
  return selectedNodes.find(node => node.id === nodeId)
    || directoryEntries.find(node => node.id === nodeId)
    || null;
}

export function resolveAgentMediaNode(
  input: unknown,
  context: AgentToolExecutionContext,
): AgentDirectoryEntry {
  const selectedNodes = context.perception?.selectedNodes || [];
  const nodeId = requestedNodeId(input)
    || (selectedNodes.length === 1 ? selectedNodes[0].id : null);
  if (!nodeId) throw new Error('请指定当前可见媒体文件的 nodeId');
  const node = visibleNode(nodeId, context);
  if (!node) throw new Error('目标节点不在当前选中项或当前目录的感知范围内');
  if (node.type !== 'file') throw new Error('媒体工具只能处理单个文件');
  return node;
}

export function buildAgentMediaFileName(node: AgentDirectoryEntry): string {
  const extension = String(node.ext || '').trim().replace(/^\.+/, '');
  if (!extension || node.name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
    return node.name;
  }
  return `${node.name}.${extension}`;
}

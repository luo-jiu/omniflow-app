import type { AgentDirectoryEntry } from '@/shared/agent/agent.types';
import type { AgentTool } from '../agent-tool-registry';

function requestedNodeId(input: unknown, key: 'directoryId' | 'nodeId'): number | null {
  if (!input || typeof input !== 'object') return null;
  const value = Number((input as Record<string, unknown>)[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function findVisibleNode(
  nodeId: number,
  selectedNodes: AgentDirectoryEntry[],
  directoryEntries: AgentDirectoryEntry[],
): AgentDirectoryEntry | null {
  return selectedNodes.find(node => node.id === nodeId)
    || directoryEntries.find(node => node.id === nodeId)
    || null;
}

export const fileListTool: AgentTool = {
  description: '列出 OmniFlow 当前目录的直属文件和文件夹。只能读取当前已感知目录，不递归读取子目录。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      directoryId: {
        description: '可选。当前目录节点 ID；省略时使用当前目录。',
        type: 'integer',
      },
    },
    type: 'object',
  },
  name: 'file.list',
  risk: 'read',
  async execute(input, context) {
    const directory = context.perception?.currentDirectory;
    if (!directory) {
      return { message: '当前没有可读取的目录上下文', ok: false };
    }
    const requestedId = requestedNodeId(input, 'directoryId');
    if (requestedId && requestedId !== directory.id) {
      return { message: '只能读取当前目录，目标目录尚未进入本轮感知范围', ok: false };
    }
    context.onProgress({ message: `正在读取 ${directory.name}` });
    return {
      data: {
        directory: { id: directory.id, name: directory.name },
        entries: directory.entries,
        entryCount: directory.entryCount,
      },
      message: `已读取 ${directory.entryCount} 个直属条目`,
      ok: true,
    };
  },
};

export const fileStatTool: AgentTool = {
  description: '读取当前选中节点或当前目录直属节点的名称、类型、扩展名、大小、MIME 类型和更新时间。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      nodeId: {
        description: '节点 ID。只有一个选中节点时可以省略。',
        type: 'integer',
      },
    },
    type: 'object',
  },
  name: 'file.stat',
  risk: 'read',
  async execute(input, context) {
    const selectedNodes = context.perception?.selectedNodes || [];
    const directoryEntries = context.perception?.currentDirectory?.entries || [];
    const nodeId = requestedNodeId(input, 'nodeId')
      || (selectedNodes.length === 1 ? selectedNodes[0].id : null);
    if (!nodeId) {
      return { message: '请指定当前可见节点的 nodeId', ok: false };
    }
    const node = findVisibleNode(nodeId, selectedNodes, directoryEntries);
    if (!node) {
      return { message: '目标节点不在当前选中项或当前目录的感知范围内', ok: false };
    }
    context.onProgress({ message: `正在读取 ${node.name} 的信息` });
    return {
      data: node,
      message: `已读取 ${node.name} 的节点信息`,
      ok: true,
    };
  },
};

export function getBuiltInReadTools(): AgentTool[] {
  return [fileListTool, fileStatTool];
}

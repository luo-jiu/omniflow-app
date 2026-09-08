import type { AgentDirectoryEntry } from '@/shared/agent/agent.types';
import type { AgentTool } from '../agent-tool-registry';
import type { AgentLibraryQuery } from '@/shared/agent/agent-library-query';

const pathProperty = { type: 'string', minLength: 1, maxLength: 2048, description: '当前资料库内的绝对路径，例如 /音乐；不是操作系统路径。' };
const pagingProperties = {
  path: pathProperty,
  limit: { type: 'integer', minimum: 1, maximum: 50, description: '每页条数，默认 20；页面过大时减小该值并重试原游标。' },
  cursor: { type: 'string', maxLength: 256, description: '上页返回的 nextCursor；其他筛选条件保持不变。' },
  nodeType: { type: 'string', enum: ['dir', 'file'] },
};

function queryInput(input: unknown): Omit<AgentLibraryQuery, 'kind'> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Omit<AgentLibraryQuery, 'kind'> : {};
}

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
  description: '分页列出当前资料库任意目录的直属节点。用目录 ID 或资料库绝对路径定位，不需要先展开 UI；省略时列当前目录。只读元数据，不依赖 MinIO 在线，hasMore=true 时使用 nextCursor 继续。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      ...pagingProperties,
      directoryId: {
        description: '可选目录 ID，与 path 互斥；省略时使用当前目录或资料库根。',
        minimum: 1,
        type: 'integer',
      },
    },
    not: { properties: { directoryId: {}, path: {} }, required: ['directoryId', 'path'] },
    type: 'object',
  },
  name: 'file.list',
  presentation: { groupKind: 'resource-read', operationKind: 'list' },
  risk: 'read',
  async execute(input, context) {
    if (context.readLibraryMetadata) {
      const query = queryInput(input);
      const result = await context.readLibraryMetadata({ ...query, kind: 'list',
        ...(!query.path && !query.directoryId ? { directoryId: context.appContext.currentDirectory?.id } : {}),
      }, context.signal);
      return { ok: true, data: result, message: `已读取 ${result.entries?.length || 0} 项${result.hasMore ? '，还有下一页' : ''}` };
    }
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
        returnedEntryCount: directory.entries.length,
        truncated: directory.truncated === true || directory.entryCount > directory.entries.length,
      },
      message: directory.truncated || directory.entryCount > directory.entries.length
        ? `当前目录共 ${directory.entryCount} 项，本次仅返回 ${directory.entries.length} 项，不能据此判断未展示文件不存在`
        : `已读取 ${directory.entryCount} 个直属条目`,
      ok: true,
    };
  },
};

export const fileStatTool: AgentTool = {
  description: '按节点 ID 或资料库绝对路径读取当前资料库内的节点、规范路径和存储身份，支持搜索发现但未在 UI 选中的节点。省略参数时读取唯一选中项。只读元数据不代表文件内容已经可读；媒体工具会独立检查来源。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      path: pathProperty,
      nodeId: {
        description: '节点 ID。只有一个选中节点时可以省略。',
        type: 'integer',
        minimum: 1,
      },
    },
    not: { properties: { nodeId: {}, path: {} }, required: ['nodeId', 'path'] },
    type: 'object',
  },
  name: 'file.stat',
  presentation: { groupKind: 'resource-read', operationKind: 'stat' },
  risk: 'read',
  async execute(input, context) {
    if (context.readLibraryMetadata) {
      const query = queryInput(input);
      const selected = context.perception?.selectedNodes || [];
      const nodeId = query.nodeId || (!query.path && selected.length === 1 ? selected[0].id : undefined);
      const result = await context.readLibraryMetadata({ ...query, nodeId, kind: 'stat' }, context.signal);
      return { ok: true, data: result.node, message: `已读取 ${result.node?.name || '节点'} 的元数据` };
    }
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
      message: node.storage?.availability === 'unavailable'
        ? `已读取 ${node.name} 的元数据；源存储「${node.storage.providerLabel || node.storage.providerAlias}」当前不可达，文件内容尚不可读取`
        : `已读取 ${node.name} 的节点信息`,
      ok: true,
    };
  },
};

export function getBuiltInReadTools(): AgentTool[] {
  return [fileListTool, fileStatTool, fileSearchTool, fileResolveTool];
}

export const fileSearchTool: AgentTool = {
  name: 'file.search', risk: 'read', presentation: { groupKind: 'resource-read', operationKind: 'search' },
  description: '搜索当前资料库中的文件和目录名称、类型或标签，可用 path 或 directoryId 限定子树；不搜索文件正文，不访问 MinIO。结果含节点 ID 与规范路径，分页读取，不受当前 UI 选择范围限制。',
  inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      ...pagingProperties, directoryId: { type: 'integer', minimum: 1 },
      keyword: { type: 'string', maxLength: 512, description: '名称中的字面文本，不是 Shell 命令或正则。' },
      tagIds: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1 } },
      tagMatchMode: { type: 'string', enum: ['ANY', 'ALL'] },
    }, not: { properties: { directoryId: {}, path: {} }, required: ['directoryId', 'path'] },
  },
  async execute(input, context) {
    if (!context.readLibraryMetadata) return { ok: false, message: '当前运行时未接入资料库查询' };
    const result = await context.readLibraryMetadata({ ...queryInput(input), kind: 'search' }, context.signal);
    return { ok: true, data: result, message: `找到 ${result.entries?.length || 0} 项${result.hasMore ? '，还有下一页' : ''}` };
  },
};

export const fileResolveTool: AgentTool = {
  name: 'file.resolve', risk: 'read', presentation: { groupKind: 'resource-read', operationKind: 'search' },
  description: '将当前资料库中的绝对路径精确解析成节点 ID 和元数据，例如 /音乐。逐段校验父子关系和类型，重名或缺失时报错，不猜测、不创建目录。',
  inputSchema: { type: 'object', additionalProperties: false, properties: { path: pathProperty, nodeType: pagingProperties.nodeType }, required: ['path'] },
  async execute(input, context) {
    if (!context.readLibraryMetadata) return { ok: false, message: '当前运行时未接入资料库查询' };
    const result = await context.readLibraryMetadata({ ...queryInput(input), kind: 'resolve' }, context.signal);
    return { ok: true, data: result.node, message: `已定位 ${result.node?.path || result.node?.name || '节点'}` };
  },
};

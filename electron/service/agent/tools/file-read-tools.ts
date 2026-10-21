import type { AgentDirectoryEntry } from '@/shared/agent/agent.types';
import { attachmentReadTool } from './attachment-read-tool';
import { attachmentInspectTool, attachmentViewTool, attachmentQueryTool } from './attachment-document-tools';
import type { AgentTool } from '../agent-tool-registry';
import type { AgentLibraryQuery } from '@/shared/agent/agent-library-query';
import { assessFileScope, fileContentTool } from './file-content-tool';
import { libraryDocumentTools } from './library-document-tools';
import { queryAgentHostFiles } from '../agent-host-file-query';
import { agentGlobProperty, createAgentFileGlob } from '../agent-file-glob';
import { searchAgentFiles } from '../agent-file-search';
import { fileGrepTool } from './file-grep-tool';
import { resolveAgentFileToolInput } from '../agent-file-path-resolver';

const pathProperty = { type: 'string', minLength: 1, maxLength: 4096, description: '绝对或相对路径。' };
const basePathProperty = { type: 'string', minLength: 1, maxLength: 4096, description: '相对path基目录；host必填。' };
const scopeProperty = { type: 'string', enum: ['library', 'host'], description: '默认 library；host 明确访问本机，并按权限模式授权。' };
const pagingProperties = {
  scope: scopeProperty,
  path: pathProperty,
  basePath: basePathProperty,
  limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 50，最多 100；按输出预算自动减少实际条数，hasMore 时继续 nextCursor。' },
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
  assess: assessFileScope,
  description: '分页列目录直属项，scope默认library。资料库用directoryId或path，省略时列当前目录；host须path。返回entries/hasMore/nextCursor。库内元数据不依赖MinIO。',
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
    input = await resolveAgentFileToolInput('file.list', input, context);
    if ((input as { scope?: string })?.scope === 'host') return { ok: true,
      data: await queryAgentHostFiles('list', queryInput(input), context.signal), message: '已列出本机目录' };
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
        directory: { id: directory.id, name: directory.name, builtInType: directory.builtInType, archiveMode: directory.archiveMode },
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
  assess: assessFileScope,
  description: '读取元数据，scope默认library。资料库用nodeId或path，单选可省略；host须path，不接受库内ID。元数据存在不代表正文可读。',
  inputSchema: {
    additionalProperties: false,
    properties: {
      scope: scopeProperty,
      path: pathProperty,
      basePath: basePathProperty,
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
    input = await resolveAgentFileToolInput('file.stat', input, context);
    if ((input as { scope?: string })?.scope === 'host') return { ok: true,
      data: await queryAgentHostFiles('stat', queryInput(input), context.signal), message: '已读取本机节点元数据' };
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
  return [fileListTool, fileStatTool, fileSearchTool, fileResolveTool, fileContentTool, fileGrepTool, attachmentReadTool, attachmentInspectTool, attachmentViewTool, attachmentQueryTool, ...libraryDocumentTools];
}

export const fileSearchTool: AgentTool = {
  assess: assessFileScope,
  validate(input) {
    try {
      const query = input as { glob?: string; scope?: string; path?: string; directoryId?: number; tagIds?: number[] };
      createAgentFileGlob(query.glob);
      if (query.scope === 'host' && (!query.path || query.directoryId !== undefined || query.tagIds !== undefined)) {
        return { ok: false, message: '本机搜索必须提供 path，不接受资料库 ID 或标签' };
      }
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'glob 无效' }; }
  },
  name: 'file.search', risk: 'read', presentation: { groupKind: 'resource-read', operationKind: 'search' },
  description: '按名称字面包含、glob、类型搜索path子树，scope默认library。host须path，不支持ID/标签。两scope glob一致；内部按候选页过滤，空页hasMore仍须续搜。每页100候选，本机最多5000项，超限用Shell。',
  inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      ...pagingProperties, directoryId: { type: 'integer', minimum: 1 },
      glob: agentGlobProperty,
      cursor: { type: 'string', maxLength: 4096, description: 'nextCursor 原样传回，筛选条件不变。' },
      keyword: { type: 'string', maxLength: 512, description: '名称中的字面文本，不是 Shell 命令或正则。' },
      tagIds: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1 } },
      tagMatchMode: { type: 'string', enum: ['ANY', 'ALL'] },
    }, not: { properties: { directoryId: {}, path: {} }, required: ['directoryId', 'path'] },
  },
  async execute(input, context) {
    input = await resolveAgentFileToolInput('file.search', input, context);
    const result = await searchAgentFiles(queryInput(input), context);
    return { ok: true, data: result, message: `找到 ${result.entries?.length || 0} 项${result.hasMore ? '，还有下一页' : ''}` };
  },
};

export const fileResolveTool: AgentTool = {
  assess: assessFileScope,
  name: 'file.resolve', risk: 'read', presentation: { groupKind: 'resource-read', operationKind: 'search' },
  description: '精确定位path并返回元数据，scope默认library。缺失即报错。读取正文或列目录可直接给path，无需先resolve。',
  inputSchema: { type: 'object', additionalProperties: false, properties: { scope: scopeProperty, path: pathProperty, basePath: basePathProperty, nodeType: pagingProperties.nodeType }, required: ['path'] },
  async execute(input, context) {
    input = await resolveAgentFileToolInput('file.resolve', input, context);
    if ((input as { scope?: string })?.scope === 'host') return { ok: true,
      data: await queryAgentHostFiles('resolve', queryInput(input), context.signal), message: '已定位本机路径' };
    if (!context.readLibraryMetadata) return { ok: false, message: '当前运行时未接入资料库查询' };
    const result = await context.readLibraryMetadata({ ...queryInput(input), kind: 'resolve' }, context.signal);
    return { ok: true, data: result.node, message: `已定位 ${result.node?.path || result.node?.name || '节点'}` };
  },
};

import { ipcRequest } from '@/service/request/ipcRequest';
import { ensureStorageProviderAvailable } from '@/features/resource-monitor/services/storage-provider-health';
import { normalizeAgentLibraryDirectoryPath, splitAgentLibraryDirectoryPath } from '@/shared/agent/agent-library-path';
import {
  normalizeAgentLibraryNode, normalizeAgentLibraryReadResult,
  type AgentLibraryNode, type AgentLibraryQuery, type AgentLibraryReadResult,
} from '@/shared/agent/agent-library-query';

export interface LibraryMetadataQuery {
  mode: 'root' | 'children' | 'search' | 'node';
  parentId?: number;
  nodeId?: number;
  ancestorId?: number;
  names?: string[];
  keyword?: string;
  nodeType?: 'dir' | 'file';
  tagIds?: number[];
  tagMatchMode?: 'ANY' | 'ALL';
  cursor?: string;
  limit?: number;
}

export interface LibraryMetadataPage {
  root: AgentLibraryNode;
  entries: AgentLibraryNode[];
  hasMore: boolean;
  nextCursor?: string;
}

export async function queryLibraryMetadata(libraryId: number, query: LibraryMetadataQuery): Promise<LibraryMetadataPage> {
  const body = await ipcRequest('/v1/nodes/metadata/query', { method: 'POST', body: JSON.stringify({ ...query, libraryId }) });
  const data = body?.data;
  if (!data || !Array.isArray(data.entries) || data.entries.length > 100 || typeof data.hasMore !== 'boolean'
    || (data.hasMore && data.entries.length === 0)
    || (data.hasMore && (typeof data.nextCursor !== 'string' || !data.nextCursor || data.nextCursor.length > 256))) {
    throw new Error('后端没有返回有效的资料库分页结果');
  }
  return {
    root: normalizeAgentLibraryNode(data.root, libraryId),
    entries: data.entries.map((node: unknown) => normalizeAgentLibraryNode(node, libraryId)),
    hasMore: data.hasMore, ...(data.hasMore ? { nextCursor: data.nextCursor } : {}),
  };
}

type MetadataReader = typeof queryLibraryMetadata;

function fullName(node: AgentLibraryNode): string {
  return node.type === 'file' && node.ext && !node.name.toLowerCase().endsWith(`.${node.ext.toLowerCase()}`)
    ? `${node.name}.${node.ext}` : node.name;
}

export async function readAgentLibraryNode(libraryId: number, nodeId: number, read: MetadataReader = queryLibraryMetadata) {
  const page = await read(libraryId, { mode: 'node', nodeId, limit: 1 });
  const node = page.entries.find(item => item.id === nodeId);
  if (!node) throw new Error('节点不存在、已删除或不属于当前资料库');
  return node;
}

export async function resolveAgentLibraryPath(
  libraryId: number, path: string, nodeType?: 'dir' | 'file', read: MetadataReader = queryLibraryMetadata,
): Promise<AgentLibraryNode> {
  path = normalizeAgentLibraryDirectoryPath(path);
  const segments = splitAgentLibraryDirectoryPath(path);
  if (segments.length > 64) throw new Error('资料库路径层级过深，请使用节点 ID');
  let current = (await read(libraryId, { mode: 'root' })).root;
  const deadline = Date.now() + 25_000;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const type = index < segments.length - 1 ? 'dir' : nodeType;
    const dot = segment.lastIndexOf('.');
    const names = Array.from(new Set([segment, ...(type !== 'dir' && dot > 0 ? [segment.slice(0, dot)] : [])]));
    let cursor: string | undefined;
    const matches: AgentLibraryNode[] = [];
    let scanned = 0;
    do {
      if (Date.now() > deadline || scanned >= 5_000) throw new Error('路径候选过多或查询超时，请使用目录或节点 ID');
      const page = await read(libraryId, { mode: 'children', parentId: current.id, names, nodeType: type, cursor, limit: 50 });
      scanned += page.entries.length;
      for (const candidate of page.entries) {
        if (candidate.parentId !== current.id || candidate.libraryId !== libraryId) throw new Error('资料库目录层级或范围发生变化');
        if (fullName(candidate) === segment) matches.push(candidate);
      }
      if (matches.length > 1) throw new Error(`资料库路径存在重名节点：${segment}`);
      if (page.hasMore && page.nextCursor === cursor) throw new Error('资料库分页游标没有前进');
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor);
    if (matches.length !== 1) throw new Error(`资料库路径不存在：/${segments.slice(0, index + 1).join('/')}`);
    current = matches[0];
  }
  const fresh = await readAgentLibraryNode(libraryId, current.id, read);
  if (fresh.parentId !== current.parentId || fresh.name !== current.name || fresh.type !== current.type
    || (nodeType && fresh.type !== nodeType)) throw new Error('资料库目标已变化或类型不匹配');
  if (fresh.path !== path) throw new Error('资料库路径已变化或无法确认，请重新定位');
  return { ...fresh, path };
}

export async function resolveAgentLibraryDirectoryTarget(libraryId: number, target: { path?: string; nodeId?: number }): Promise<AgentLibraryNode> {
  const node = target.path ? await resolveAgentLibraryPath(libraryId, target.path, 'dir')
    : target.nodeId ? await readAgentLibraryNode(libraryId, target.nodeId)
      : (await queryLibraryMetadata(libraryId, { mode: 'root' })).root;
  if (node.type !== 'dir' || !node.path) throw new Error('资料库目标目录不存在或没有有效的规范路径');
  return node;
}

export async function executeAgentLibraryQuery(
  libraryId: number, query: AgentLibraryQuery, read: MetadataReader = queryLibraryMetadata,
  checkStorage: typeof ensureStorageProviderAvailable = ensureStorageProviderAvailable,
): Promise<AgentLibraryReadResult> {
  if (!Number.isSafeInteger(libraryId) || libraryId <= 0) throw new Error('资料库范围无效');
  if (!['list', 'search', 'resolve', 'stat'].includes(query.kind) || (query.path && (query.nodeId || query.directoryId))) throw new Error('资料库查询参数冲突');
  const limit = query.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('limit 必须在 1 到 50 之间');
  if (query.kind === 'resolve' || query.kind === 'stat') {
    const node = query.path ? await resolveAgentLibraryPath(libraryId, query.path, query.nodeType, read)
      : query.nodeId ? await readAgentLibraryNode(libraryId, query.nodeId, read) : null;
    if (!node) throw new Error('请提供节点 ID 或资料库绝对路径');
    if (query.kind === 'stat' && node.storage) {
      try {
        const status = await checkStorage(node.storage.providerAlias);
        node.storage = { ...node.storage, availability: status.available ? 'available' : status.status === 'error' ? 'unavailable' : 'unknown', observedAt: new Date().toISOString() };
      } catch { node.storage = { ...node.storage, availability: 'unknown' }; }
    }
    return normalizeAgentLibraryReadResult({ libraryId, node }, libraryId);
  }
  let directory: AgentLibraryNode | undefined;
  if (query.path) directory = await resolveAgentLibraryPath(libraryId, query.path, 'dir', read);
  else if (query.directoryId) directory = await readAgentLibraryNode(libraryId, query.directoryId, read);
  if (directory && directory.type !== 'dir') throw new Error('查询范围必须是目录');
  const page = await read(libraryId, {
    mode: query.kind === 'list' ? 'children' : 'search', limit, cursor: query.cursor,
    ...(query.kind === 'list' ? { parentId: directory?.id } : { ancestorId: directory?.id }),
    keyword: query.keyword, nodeType: query.nodeType, tagIds: query.tagIds, tagMatchMode: query.tagMatchMode,
  });
  return normalizeAgentLibraryReadResult({
    libraryId, entries: page.entries, hasMore: page.hasMore, nextCursor: page.nextCursor,
    ...(query.kind === 'list' ? { directory: directory || page.root } : {}),
  }, libraryId);
}

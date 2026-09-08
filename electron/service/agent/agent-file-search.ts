import type { AgentToolExecutionContext } from './agent-tool-registry';
import type { AgentLibraryQuery } from '@/shared/agent/agent-library-query';
import { createAgentFileGlob } from './agent-file-glob';
import { decodeSearchCursor, encodeSearchCursor, searchQueryHash } from './agent-search-cursor';
import { queryAgentHostFiles } from './agent-host-file-query';
import { normalizeAgentLibraryDirectoryPath } from '../../../src/shared/agent/agent-library-path';

export interface AgentFileSearchQuery extends Omit<AgentLibraryQuery, 'kind'> { scope?: 'library' | 'host'; glob?: string }
export interface AgentFileSearchEntry { id?: number; path?: string; name: string; type: string; ext?: string; fileSize?: number; updatedAt?: string }
export interface AgentFileSearchPage { entries: AgentFileSearchEntry[]; hasMore: boolean; nextCursor?: string; examinedEntries?: number }

export async function searchAgentFiles(query: AgentFileSearchQuery, context: AgentToolExecutionContext): Promise<AgentFileSearchPage> {
  const match = createAgentFileGlob(query.glob);
  if (query.scope === 'host') {
    const result = await queryAgentHostFiles('search', query, context.signal);
    if (!('entries' in result)) throw new Error('本机搜索结果无效');
    return result;
  }
  if (!context.readLibraryMetadata) throw new Error('当前运行时未接入资料库查询');
  if (!query.glob) {
    const result = await context.readLibraryMetadata({ ...query, kind: 'search' }, context.signal);
    return { ...result, entries: result.entries || [], hasMore: result.hasMore === true };
  }
  const hash = searchQueryHash([context.appContext.libraryId, query.path, query.directoryId, query.glob,
    query.keyword, query.nodeType, query.tagIds, query.tagMatchMode]);
  const state = decodeSearchCursor<{ cursor?: string }>(query.cursor, 'glob', hash);
  let root = normalizeAgentLibraryDirectoryPath(query.path || '/');
  if (query.directoryId) {
    const resolved = await context.readLibraryMetadata({ kind: 'stat', nodeId: query.directoryId }, context.signal);
    if (resolved.node?.type !== 'dir' || !resolved.node.path) throw new Error('无法确认搜索目录路径');
    root = resolved.node.path;
  }
  const { glob: _glob, scope: _scope, ...metadata } = query;
  void _glob; void _scope;
  const result = await context.readLibraryMetadata({ ...metadata, cursor: state?.cursor, kind: 'search' }, context.signal);
  const prefix = root === '/' ? '/' : `${root}/`;
  const entries = (result.entries || []).filter(node => {
    if (node.path === root) return false;
    if (!node.path || !node.path.startsWith(prefix)) throw new Error('搜索节点没有有效的范围内路径，不能完整应用 glob');
    return match(node.path.slice(prefix.length));
  });
  return { ...result, entries, examinedEntries: result.entries?.length || 0, hasMore: result.hasMore === true,
    nextCursor: result.hasMore ? encodeSearchCursor('glob', hash, { cursor: result.nextCursor }) : undefined };
}

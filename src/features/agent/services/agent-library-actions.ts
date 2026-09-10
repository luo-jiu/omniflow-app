import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { createAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import { AGENT_LIBRARY_MUTATION_TOOLS, normalizeAgentLibraryAction, splitAgentNodeName, type AgentLibraryMutationName } from '@/shared/agent/agent-library-actions';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { createNode, fetchRecycleBinItems, moveNodesBatch, renameNode, restoreNodeAndChildren } from '@/features/file-explorer/services/file.api';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { readAgentLibraryNode, resolveAgentLibraryPath } from './agent-library.api';
import { copyAgentLibraryNode } from './agent-library-actions.api';
import { reportAgentToolExecutionProgress } from './agent.api';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

export interface AgentLibraryActionDependencies {
  assertOwner?: () => void;
  beforeCommit?: () => Promise<void>;
  readLibraryNode?: typeof readAgentLibraryNode;
  resolvePath?: typeof resolveAgentLibraryPath;
  createDirectory?: typeof createNode;
  rename?: typeof renameNode;
  move?: typeof moveNodesBatch;
  copy?: typeof copyAgentLibraryNode;
  recycleItems?: typeof fetchRecycleBinItems;
  restore?: typeof restoreNodeAndChildren;
  notifyMutation?: typeof notifyLibraryNodesMutated;
  onCommitted?: (result: AgentToolResult) => Promise<void> | void;
  signal?: AbortSignal;
}

function sameNode(before: AgentLibraryNode, after: AgentLibraryNode): boolean {
  return before.id === after.id && before.libraryId === after.libraryId && before.parentId === after.parentId
    && before.name === after.name && (before.ext || '') === (after.ext || '') && before.type === after.type
    && before.path === after.path && before.updatedAt === after.updatedAt;
}

function scopedCheck(request: AgentToolExecutionRequest, deps: AgentLibraryActionDependencies, abort = true) {
  if (abort) deps.signal?.throwIfAborted();
  if (deps.assertOwner) deps.assertOwner();
  else if (serializeAgentOwnerScope(createAgentOwnerScope(API_CONFIG.BASE_URL, auth.getUserInfo()?.id)) !== serializeAgentOwnerScope(request.ownerScope)) {
    throw new Error('账号或服务端环境已变化，未继续操作');
  }
}

export async function executeAgentLibraryAction(request: AgentToolExecutionRequest, deps: AgentLibraryActionDependencies = {}): Promise<AgentRendererToolOutcome> {
  let attempted = false;
  let committed: AgentToolResult | undefined;
  try {
    scopedCheck(request, deps);
    const raw = request.input as Record<string, unknown>;
    if (!raw || !Number.isSafeInteger(raw.libraryId) || raw.libraryId !== request.appContext.libraryId || Number(raw.libraryId) <= 0) throw new Error('资料库操作范围无效');
    const { libraryId: rawLibrary, observedSource, ...args } = raw;
    const libraryId = Number(rawLibrary), operation = request.toolName as AgentLibraryMutationName;
    if (!(AGENT_LIBRARY_MUTATION_TOOLS as readonly string[]).includes(operation)) throw new Error('不支持的资料库操作');
    const input = normalizeAgentLibraryAction(operation, args);
    const read = deps.readLibraryNode || readAgentLibraryNode;
    const resolve = deps.resolvePath || resolveAgentLibraryPath;
    const source = operation === 'directory.create' || operation === 'recycle.restore' ? undefined
      : input.path ? await resolve(libraryId, input.path) : await read(libraryId, input.nodeId!);
    if (source && (source.libraryId !== libraryId || source.parentId <= 0 || source.path === '/')) throw new Error('不能操作其他资料库或根目录');
    if (source && observedSource && !sameNode(observedSource as AgentLibraryNode, source)) throw new Error('目标已变化，请重新定位后操作');
    const parent = ['directory.create', 'file.move', 'file.copy'].includes(operation)
      ? input.parentPath ? await resolve(libraryId, input.parentPath, 'dir') : input.parentId ? await read(libraryId, input.parentId)
        : await resolve(libraryId, '/', 'dir') : undefined;
    if (parent && (parent.libraryId !== libraryId || parent.type !== 'dir')) throw new Error('目标必须是当前资料库中的文件夹');
    if (source?.type === 'dir' && parent && (source.id === parent.id || (source.path && (source.path === parent.path || parent.path?.startsWith(source.path + '/'))))) throw new Error('不能移动或复制到自身或子目录');
    if (operation === 'file.copy' && source?.type === 'dir' && !input.recursive) throw new Error('复制整个文件夹需要 recursive=true');
    const recycle = operation === 'recycle.restore'
      ? (await (deps.recycleItems || fetchRecycleBinItems)(libraryId)).find(item => item.id === input.nodeId && item.libraryId === libraryId) : undefined;
    if (operation === 'recycle.restore' && !recycle) throw new Error('回收站条目不存在，请先 recycle.list 重新确认');
    scopedCheck(request, deps);
    for (const node of [source, parent]) if (node) {
      const fresh = await read(libraryId, node.id);
      if (!sameNode(node, fresh)) throw new Error('节点位置、名称或版本已变化，请重新定位');
      scopedCheck(request, deps);
    }
    if (recycle) {
      const fresh = (await (deps.recycleItems || fetchRecycleBinItems)(libraryId)).find(item => item.id === recycle.id && item.libraryId === libraryId);
      if (!fresh || fresh.deletedAt !== recycle.deletedAt || fresh.parentId !== recycle.parentId || fresh.name !== recycle.name) throw new Error('回收站条目已变化，请重新查询');
    }
    scopedCheck(request, deps);
    if (deps.beforeCommit) await deps.beforeCommit();
    else await reportAgentToolExecutionProgress({ executionId: request.executionId, libraryId, ownerScope: request.ownerScope,
      runId: request.runId, sessionId: request.sessionId, phase: 'committing', progress: { message: '正在提交资料库操作' } });
    scopedCheck(request, deps);
    let nodeId = source?.id || recycle?.id || 0;
    let parentId = parent?.id || source?.parentId || recycle?.parentId || 0;
    let nextName = source?.name || recycle?.name || input.name || '';
    let nextExt = source?.ext || recycle?.ext || '';
    let nodeType: 'file' | 'dir' = source?.type || recycle?.type || 'dir';
    let copiedCount: number | undefined;
    attempted = true;
    if (operation === 'directory.create') {
      const created = await (deps.createDirectory || createNode)({ name: input.name!, parentId, libraryId, type: 'dir', conflictPolicy: input.conflictPolicy || 'error' });
      nodeId = Number(created.id); nextName = String(created.name || input.name); nextExt = '';
    } else if (operation === 'file.rename') {
      const parts = splitAgentNodeName(input.name!, source!.type);
      await (deps.rename || renameNode)({ id: nodeId, ...parts }); nextName = parts.name; nextExt = parts.ext;
    } else if (operation === 'file.move') {
      const moved = await (deps.move || moveNodesBatch)({ libraryId, newParentId: parentId, items: [{ nodeId }] });
      if (moved.movedCount !== 1 || !moved.movedNodeIds.includes(nodeId)) throw new Error('移动回执无法确认');
    } else if (operation === 'file.copy') {
      const copied = await (deps.copy || copyAgentLibraryNode)({ libraryId, nodeId, parentId, name: input.name,
        recursive: input.recursive, conflictPolicy: input.conflictPolicy || 'error' });
      nodeId = copied.node.id; nextName = copied.node.name; nextExt = copied.node.ext || ''; nodeType = copied.node.type; copiedCount = copied.copiedCount;
    } else if (operation === 'recycle.restore') {
      if (!await (deps.restore || restoreNodeAndChildren)(nodeId, libraryId)) throw new Error('恢复回执无法确认');
    } else throw new Error('不支持的资料库操作');
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) throw new Error('操作未返回有效节点回执');
    const affectedParentIds = Array.from(new Set([parentId, ...(operation === 'file.move' && source ? [source.parentId] : [])].filter(id => id > 0)));
    const label = { 'directory.create': '已创建文件夹', 'file.rename': '已重命名', 'file.move': '已移动', 'file.copy': '已复制', 'recycle.restore': '已恢复' }[operation];
    committed = { ok: true, message: `${label} ${nextName}${nextExt ? '.' + nextExt : ''}`, data: {
      mutationCommitState: 'committed', operation, nodeId, name: nextName, ext: nextExt, affectedParentIds,
      destination: { kind: 'library', nodeId, parentId }, ...(copiedCount !== undefined ? { copiedCount } : {}),
    } };
    try { await deps.onCommitted?.(committed); } catch { /* Final completion retries the receipt. */ }
    let refreshed: AgentLibraryNode | undefined, refreshFailed = false;
    try {
      scopedCheck(request, deps, false);
      refreshed = await read(libraryId, nodeId);
      if (refreshed.libraryId !== libraryId || refreshed.id !== nodeId) throw new Error('结果范围不匹配');
      parentId = refreshed.parentId;
      if (!affectedParentIds.includes(parentId)) affectedParentIds.push(parentId);
      (committed.data as Record<string, unknown>).destination = { kind: 'library', nodeId, parentId };
      (committed.data as Record<string, unknown>).path = refreshed.path;
    } catch { refreshFailed = true; }
    try {
      scopedCheck(request, deps, false);
      await (deps.notifyMutation || notifyLibraryNodesMutated)({ ...request.ownerScope, libraryId, nodeId,
        affectedParentIds, parentId, name: refreshed?.name || nextName, ext: refreshed?.ext ?? nextExt, type: nodeType });
    } catch { refreshFailed = true; }
    return { committed: true, result: refreshFailed ? { ...committed, message: `${committed.message}，但结果校验或目录刷新未完成；不要重复执行` } : committed,
      ...(refreshed ? { perception: { knownNodes: [refreshed], selectedNodes: [], collectedAt: new Date().toISOString() } } : {}) };
  } catch (error) {
    if (committed) return { committed: true, result: { ...committed, message: `${committed.message}，但本地同步未完成；不要重复执行` } };
    const rejected = error instanceof IpcRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    const unknown = attempted && !rejected;
    return { result: { ok: false, message: unknown ? '操作提交状态无法确认，请核对来源、目标或回收站，不要盲目重试'
      : error instanceof Error ? error.message : '内部文件操作失败', data: { mutationCommitState: unknown ? 'commit_unknown' : 'uncommitted' } } };
  }
}

export async function executeAgentRecycleList(request: AgentToolExecutionRequest, deps: AgentLibraryActionDependencies = {}): Promise<AgentRendererToolOutcome> {
  try {
    scopedCheck(request, deps);
    const query = request.input as { libraryId: number; keyword?: string; limit?: number; offset?: number; revision?: string };
    if (!query || query.libraryId !== request.appContext.libraryId || !Number.isSafeInteger(query.libraryId) || query.libraryId <= 0) throw new Error('回收站范围无效');
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0
      || (query.keyword !== undefined && (typeof query.keyword !== 'string' || query.keyword.length > 256))) throw new Error('回收站查询参数无效');
    const rows = (await (deps.recycleItems || fetchRecycleBinItems)(query.libraryId)).filter(item => item.libraryId === query.libraryId
      && (!query.keyword || `${item.name}.${item.ext || ''}`.toLocaleLowerCase().includes(query.keyword.toLocaleLowerCase())))
      .sort((a, b) => b.id - a.id).map(item => ({ nodeId: item.id, parentId: item.parentId, name: item.name, ext: item.ext || '',
        type: item.type, deletedAt: item.deletedAt, fileSize: item.fileSize, deletedDescendantCount: item.deletedDescendantCount }));
    scopedCheck(request, deps);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ keyword: query.keyword || '', rows })));
    const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (query.revision !== undefined && query.revision !== revision) throw new Error('回收站或查询条件已变化，请从头查询');
    if (offset > rows.length) throw new Error('回收站 offset 超出范围');
    const entries: typeof rows = []; let bytes = 0;
    for (const row of rows.slice(offset, offset + limit)) {
      const size = new TextEncoder().encode(JSON.stringify(row)).length;
      if (bytes + size > 8000) break;
      entries.push(row); bytes += size;
    }
    if (!entries.length && offset < rows.length) throw new Error('回收站单条记录过大，未交付完整分页');
    const nextOffset = offset + entries.length, hasMore = nextOffset < rows.length;
    return { result: { ok: true, message: `已读取回收站 ${entries.length} 项`, data: { libraryId: query.libraryId, entries, revision, offset,
      hasMore, total: rows.length, ...(hasMore ? { nextOffset } : {}) } } };
  } catch (error) { return { result: { ok: false, message: error instanceof Error ? error.message : '回收站查询失败' } }; }
}

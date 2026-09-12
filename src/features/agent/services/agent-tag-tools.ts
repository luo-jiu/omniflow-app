import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { createAgentOwnerScope, normalizeAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import { fetchTags } from '@/features/tag-management/services/tag.api';
import { ipcRequest, IpcRequestError } from '@/service/request/ipcRequest';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { reportAgentToolExecutionProgress } from './agent.api';
import { readAgentLibraryNode } from './agent-library.api';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

export interface AgentTagToolDependencies {
  fetchTags?: typeof fetchTags;
  readNodeTags?: (nodeId: number, libraryId: number) => Promise<AgentNodeTagState>;
  updateNodeTags?: (nodeId: number, input: { libraryId: number; addTagIds: number[]; removeTagIds: number[] }) => Promise<AgentNodeTagState>;
  beforeCommit?: () => Promise<void>;
  onCommitted?: (result: AgentToolResult) => Promise<void> | void;
  notifyMutated?: typeof notifyLibraryNodesMutated;
  readLibraryNode?: typeof readAgentLibraryNode;
  assertOwner?: () => void;
  signal?: AbortSignal;
}

export interface AgentNodeTagState {
  nodeId: number; libraryId: number; parentId: number; tagIds: number[]; affectedParentIds: number[]; dryRun: boolean;
}

function validateState(state: AgentNodeTagState, nodeId: number, libraryId: number) {
  if (!state || state.nodeId !== nodeId || state.libraryId !== libraryId || state.dryRun !== false
    || !Number.isSafeInteger(state.parentId) || state.parentId < 0
    || !Array.isArray(state.tagIds) || !state.tagIds.every(positive)
    || !Array.isArray(state.affectedParentIds) || !state.affectedParentIds.every(positive)) {
    throw new Error('后端未返回有效节点标签回执');
  }
  return state;
}

async function readNodeTags(nodeId: number, libraryId: number): Promise<AgentNodeTagState> {
  const body = await ipcRequest(`/v1/nodes/${nodeId}/tags?libraryId=${libraryId}`, { method: 'GET' });
  return body?.data as AgentNodeTagState;
}

async function updateNodeTags(nodeId: number, input: { libraryId: number; addTagIds: number[]; removeTagIds: number[] }): Promise<AgentNodeTagState> {
  const body = await ipcRequest(`/v1/nodes/${nodeId}/tags`, { method: 'PATCH', body: JSON.stringify(input) });
  return body?.data as AgentNodeTagState;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export async function executeAgentTagTool(
  request: AgentToolExecutionRequest, deps: AgentTagToolDependencies = {},
): Promise<AgentRendererToolOutcome> {
  let attempted = false;
  let committed: AgentToolResult | undefined;
  try {
    const owner = normalizeAgentOwnerScope(request.ownerScope);
    const checkOwner = () => {
      if (deps.assertOwner) deps.assertOwner();
      else if (serializeAgentOwnerScope(createAgentOwnerScope(API_CONFIG.BASE_URL, auth.getUserInfo()?.id))
        !== serializeAgentOwnerScope(owner)) throw new Error('账号环境已变化，未继续查询标签');
    };
    const check = () => { deps.signal?.throwIfAborted(); checkOwner(); };
    check();
    const input = request.input as { libraryId: number; nodeId?: number; target?: AgentLibraryNode;
      keyword?: string; offset?: number; limit?: number; revision?: string; addTagIds?: number[]; removeTagIds?: number[] };
    if (!['tag.list', 'tag.update'].includes(request.toolName) || !input || !positive(input.libraryId)
      || input.libraryId !== request.appContext.libraryId
      || (input.nodeId !== undefined && !positive(input.nodeId))
      || (input.keyword !== undefined && (typeof input.keyword !== 'string' || input.keyword.length > 128))) {
      throw new Error('标签查询范围或参数无效');
    }
    const offset = input.offset ?? 0; const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('标签分页参数无效');
    if ((input.revision !== undefined && (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)))
      || (offset > 0 && !input.revision)) throw new Error('继续分页必须提供上一页 revision');
    let nodeTagIds: number[] | undefined;
    if (request.toolName === 'tag.update' && input.nodeId === undefined) throw new Error('需要明确 nodeId');
    if (input.nodeId !== undefined) {
      const target = input.target;
      if (!target || target.id !== input.nodeId || target.libraryId !== input.libraryId) throw new Error('缺少已确认的当前资料库节点');
      const fresh = await (deps.readLibraryNode || readAgentLibraryNode)(input.libraryId, input.nodeId);
      check();
      if (fresh.id !== target.id || fresh.libraryId !== target.libraryId || fresh.parentId !== target.parentId
        || fresh.name !== target.name || (fresh.ext || '') !== (target.ext || '') || fresh.type !== target.type
        || fresh.path !== target.path || (target.updatedAt !== undefined && fresh.updatedAt !== target.updatedAt)) {
        throw new Error('目标已变化，请重新 file.stat 确认');
      }
      if (request.toolName === 'tag.update') {
        const addTagIds = input.addTagIds ?? []; const removeTagIds = input.removeTagIds ?? [];
        if (![addTagIds, removeTagIds].every(ids => Array.isArray(ids) && ids.length <= 100 && ids.every(positive))) {
          throw new Error('标签 ID 必须为正整数数组，每组不超过100项');
        }
        const ids = [...addTagIds, ...removeTagIds];
        if (!ids.length || new Set(ids).size !== ids.length) throw new Error('增删标签必须非空且不可重复或重叠');
        if (deps.beforeCommit) await deps.beforeCommit();
        else await reportAgentToolExecutionProgress({ executionId: request.executionId, ownerScope: owner,
          libraryId: input.libraryId, runId: request.runId, sessionId: request.sessionId,
          phase: 'committing', progress: { message: '正在更新节点标签' } });
        check();
        attempted = true;
        const state = validateState(await (deps.updateNodeTags || updateNodeTags)(input.nodeId,
          { libraryId: input.libraryId, addTagIds, removeTagIds }), input.nodeId, input.libraryId);
        committed = { ok: true, message: '已更新节点标签', data: { mutationCommitState: 'committed', operationId: request.executionId,
          nodeId: state.nodeId, libraryId: state.libraryId, affectedParentIds: state.affectedParentIds,
          addedTagIds: addTagIds, removedTagIds: removeTagIds } };
        try { await deps.onCommitted?.(committed); } catch { /* 最终完成阶段可重试提交回执。 */ }
        try {
          checkOwner();
          await (deps.notifyMutated || notifyLibraryNodesMutated)({ ...owner, libraryId: state.libraryId,
            affectedParentIds: state.affectedParentIds, nodeId: state.nodeId });
        } catch { committed = { ...committed, message: '已更新节点标签，但目录同步未完成；不要重复修改' }; }
        try {
          check();
          const updated = await (deps.readLibraryNode || readAgentLibraryNode)(input.libraryId, input.nodeId);
          check();
          if (updated.id !== input.nodeId || updated.libraryId !== input.libraryId) throw new Error('节点感知范围变化');
          return { committed: true, result: committed, perception: { knownNodes: [updated], selectedNodes: [], collectedAt: new Date().toISOString() } };
        } catch {
          return { committed: true, result: { ...committed, message: `${committed.message}；节点最新感知未更新，后续操作请先 file.stat` } };
        }
      }
      const state = validateState(await (deps.readNodeTags || readNodeTags)(input.nodeId, input.libraryId), input.nodeId, input.libraryId);
      check();
      nodeTagIds = [...new Set(state.tagIds)];
      if (nodeTagIds.length > 10000) throw new Error('节点标签记录过大');
    }
    const catalog = await (deps.fetchTags || fetchTags)({ scope: 'resource' });
    check();
    const userId = Number(owner.accountScope.slice(5));
    const visible = catalog.filter(tag => (tag.ownerUserId === null || tag.ownerUserId === userId)
      && tag.scope === 'resource' && tag.enabled === 1);
    const keyword = (input.keyword || '').toLocaleLowerCase();
    const nodeIds = nodeTagIds === undefined ? undefined : new Set(nodeTagIds);
    const matching = visible.filter(tag => (nodeIds === undefined || nodeIds.has(tag.id))
      && tag.name.toLocaleLowerCase().includes(keyword)).sort((a, b) => a.id - b.id);
    const projected = matching.map(tag => ({ id: tag.id, name: tag.name,
      type: tag.type, dimension: tag.dimension, resourceKind: tag.resourceKind, targetKinds: tag.targetKinds || [] }));
    const visibleIds = new Set(visible.map(tag => tag.id));
    const unresolved = (nodeTagIds || []).filter(id => !visibleIds.has(id));
    // 普通条目与未知 ID 共用同一序列，续读游标只按实际返回数量前进。
    const snapshot = [...projected.map(entry => ({ id: entry.id, entry })),
      ...unresolved.map(id => ({ id, entry: undefined }))].sort((a, b) => a.id - b.id);
    if (snapshot.length > 100000) throw new Error('标签查询结果过大，请缩小范围');
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify({ owner, libraryId: input.libraryId,
      nodeId: input.nodeId, keyword, snapshot })));
    check();
    const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (input.revision && input.revision !== revision) throw new Error('标签查询或结果已变化，请清除 offset/revision 从头查询');
    if (offset > snapshot.length) throw new Error('标签分页偏移超出当前快照');
    const makeResult = (count: number): AgentToolResult => {
      const page = snapshot.slice(offset, offset + count);
      const hasMore = offset + count < snapshot.length;
      return { ok: true, message: `已查询 ${count} 个标签`, data: {
        libraryId: input.libraryId, ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        entries: page.flatMap(item => item.entry ? [item.entry] : []),
        total: snapshot.length, hasMore, revision, ...(hasMore ? { nextOffset: offset + count } : {}),
        ...(nodeTagIds !== undefined ? { source: 'node_tag_rel', authoritativeRelations: true,
          unresolvedTagIds: page.filter(item => !item.entry).map(item => item.id) } : { source: 'owner_resource_catalog' }),
        updateAvailable: true,
      } };
    };
    let count = Math.min(limit, snapshot.length - offset);
    let result = makeResult(count);
    while (encoder.encode(JSON.stringify(result)).byteLength > 8000 && count > 0) result = makeResult(--count);
    if (count === 0 && offset < snapshot.length) throw new Error('单个标签超过输出预算，无法完整返回，请调整该标签后重试');
    return { result };
  } catch (error) {
    if (committed) return { committed: true, result: committed };
    const rejected = error instanceof IpcRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    const unknown = attempted && !rejected;
    return { result: { ok: false, message: unknown ? '标签提交状态无法确认，请用 tag.list 核对，不要盲目重试'
      : error instanceof Error ? error.message.slice(0, 1000) : '标签操作失败',
      ...(request.toolName === 'tag.update' ? { data: { mutationCommitState: unknown ? 'commit_unknown' : 'uncommitted', operationId: request.executionId } } : {}) } };
  }
}

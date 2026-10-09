import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { createAgentOwnerScope, normalizeAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import { queryLibraryTags, updateNodeTags, type NodeTagState } from '@/features/tag-management/services/tag.api';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { reportAgentToolExecutionProgress } from './agent.api';
import { readAgentLibraryNode } from './agent-library.api';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

export interface AgentTagToolDependencies {
  queryLibraryTags?: typeof queryLibraryTags;
  updateNodeTags?: (nodeId: number, input: { libraryId: number; addTagIds: number[]; removeTagIds: number[] }) => Promise<AgentNodeTagState>;
  beforeCommit?: () => Promise<void>;
  onCommitted?: (result: AgentToolResult) => Promise<void> | void;
  notifyMutated?: typeof notifyLibraryNodesMutated;
  readLibraryNode?: typeof readAgentLibraryNode;
  assertOwner?: () => void;
  signal?: AbortSignal;
}

export type AgentNodeTagState = NodeTagState;

function validateState(state: AgentNodeTagState, nodeId: number, libraryId: number) {
  if (!state || state.nodeId !== nodeId || state.libraryId !== libraryId || state.dryRun !== false
    || !Number.isSafeInteger(state.parentId) || state.parentId < 0
    || !Array.isArray(state.tagIds) || !state.tagIds.every(positive)
    || !Array.isArray(state.affectedParentIds) || !state.affectedParentIds.every(positive)) {
    throw new Error('后端未返回有效节点标签回执');
  }
  return state;
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
      keyword?: string; dimension?: string; cursor?: string; limit?: number; addTagIds?: number[]; removeTagIds?: number[] };
    if (!['tag.list', 'tag.update'].includes(request.toolName) || !input || !positive(input.libraryId)
      || input.libraryId !== request.appContext.libraryId
      || (input.nodeId !== undefined && !positive(input.nodeId))
      || (input.keyword !== undefined && (typeof input.keyword !== 'string' || input.keyword.length > 64))
      || (input.dimension !== undefined && (typeof input.dimension !== 'string' || input.dimension.length > 64))) {
      throw new Error('标签查询范围或参数无效');
    }
    const limit = input.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10
      || (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 256))) {
      throw new Error('标签分页参数无效');
    }
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
    }
    const page = await (deps.queryLibraryTags || queryLibraryTags)({ libraryId: input.libraryId,
      nodeId: input.nodeId, keyword: input.keyword, dimension: input.dimension, cursor: input.cursor, limit,
      // 已绑定但停用的标签仍是正式关系，必须能够查看和移除。
      ...(input.nodeId === undefined ? { enabled: true } : {}),
    });
    check();
    if (!page || !Array.isArray(page.entries) || page.entries.length > limit || typeof page.hasMore !== 'boolean'
      || (page.hasMore && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor === input.cursor))
      || (page.nextCursor !== undefined && page.nextCursor.length > 256)
      || page.entries.some(tag => !positive(tag.id) || tag.libraryId !== input.libraryId
        || typeof tag.name !== 'string' || ![0, 1].includes(tag.enabled)
        || (tag.dimension !== undefined && typeof tag.dimension !== 'string'))
      || new Set(page.entries.map(tag => tag.id)).size !== page.entries.length) {
      throw new Error('后端未返回有效资料库标签分页');
    }
    const result: AgentToolResult = { ok: true, message: `已查询 ${page.entries.length} 个标签`, data: {
      libraryId: input.libraryId, ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      entries: page.entries.map(tag => ({ id: tag.id, name: tag.name, dimension: tag.dimension, enabled: tag.enabled, ...(tag.deleted ? { deleted: true } : {}), ...(tag.legacy ? { legacy: true } : {}) })),
      hasMore: page.hasMore, ...(page.hasMore ? { nextCursor: page.nextCursor } : {}),
      ...(input.nodeId !== undefined ? { source: 'node_tag_rel', authoritativeRelations: true }
        : { source: 'library_resource_catalog' }),
      updateAvailable: true,
    } };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 8000) {
      throw new Error('标签页超过输出预算，请减小 limit 后使用相同 cursor 重试');
    }
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

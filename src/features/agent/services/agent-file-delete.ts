import { API_CONFIG } from '@/config/api';
import { auth } from '@/utils/auth';
import { createAgentOwnerScope, serializeAgentOwnerScope } from '@/shared/agent/agent-owner-scope';
import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { softDeleteNodeSubtree } from '@/features/file-explorer/services/node-deletion';
import { notifyLibraryFilesDeleted } from '@/features/file-viewer/services/file-deletion-events';
import { markRepositoryTreeSnapshotDirty } from '@/features/file-explorer/hooks/use-repository-tree/snapshot-store';
import { refreshDirectoryInTree } from '@/features/file-explorer/services/tree-locate';
import { readAgentLibraryNode } from './agent-library.api';
import { reportAgentToolExecutionProgress } from './agent.api';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

export interface AgentFileDeleteDependencies {
  readLibraryNode?: typeof readAgentLibraryNode;
  deleteSubtree?: typeof softDeleteNodeSubtree;
  assertOwner?: () => void;
  beforeCommit?: () => Promise<void>;
  notifyDeleted?: typeof notifyLibraryFilesDeleted;
  markTreeDirty?: typeof markRepositoryTreeSnapshotDirty;
  onCommitted?: (result: AgentToolResult) => Promise<void> | void;
  onRefreshDirectory?: (id: number) => Promise<void> | void;
  signal?: AbortSignal;
}

export async function executeAgentFileDelete(request: AgentToolExecutionRequest, deps: AgentFileDeleteDependencies = {}): Promise<AgentRendererToolOutcome> {
  let attempted = false;
  let committed: AgentToolResult | undefined;
  const checkOwner = () => {
    if (deps.assertOwner) deps.assertOwner();
    else if (serializeAgentOwnerScope(createAgentOwnerScope(API_CONFIG.BASE_URL, auth.getUserInfo()?.id)) !== serializeAgentOwnerScope(request.ownerScope)) {
      throw new Error('账号环境已变化，未继续删除');
    }
  };
  const check = () => { deps.signal?.throwIfAborted(); checkOwner(); };
  try {
    check();
    const input = request.input as AgentLibraryNode & { nodeId: number; recursive: boolean };
    if (request.toolName !== 'file.delete' || !input || input.libraryId !== request.appContext.libraryId
      || !Number.isSafeInteger(input.libraryId) || input.libraryId <= 0
      || !Number.isSafeInteger(input.nodeId) || input.nodeId <= 0
      || !Number.isSafeInteger(input.parentId) || input.parentId <= 0 || input.path === '/'
      || typeof input.name !== 'string' || !input.name
      || !['file', 'dir'].includes(input.type) || (input.type === 'dir' && input.recursive !== true)) {
      throw new Error('删除目标范围或递归参数无效');
    }
    const verify = async () => {
      check();
      const fresh = await (deps.readLibraryNode || readAgentLibraryNode)(input.libraryId, input.nodeId);
      check();
      if (fresh.id !== input.nodeId || fresh.libraryId !== input.libraryId || fresh.parentId !== input.parentId
        || fresh.name !== input.name || (fresh.ext || '') !== (input.ext || '') || fresh.type !== input.type
        || (input.path !== undefined && fresh.path !== input.path)
        || (input.updatedAt !== undefined && fresh.updatedAt !== input.updatedAt)) {
        throw new Error('目标已移动、重命名或修改，请重新 file.stat 确认后删除');
      }
    };
    await verify();
    const outcome = await (deps.deleteSubtree || softDeleteNodeSubtree)({
      accountScope: request.ownerScope.accountScope, libraryId: input.libraryId, ancestorId: input.nodeId,
      beforeDelete: async () => {
        await verify();
        if (deps.beforeCommit) await deps.beforeCommit();
        else await reportAgentToolExecutionProgress({ executionId: request.executionId, ownerScope: request.ownerScope,
          libraryId: input.libraryId, runId: request.runId, sessionId: request.sessionId,
          phase: 'committing', progress: { message: '正在移入回收站' } });
        check(); attempted = true;
      },
      onDeleted: async nodeIds => {
        committed = { ok: true, message: `已移入回收站 ${input.path || input.name}`, data: {
          deleteCommitState: 'committed', recoverable: true, nodeId: input.nodeId, recursive: input.recursive,
          destination: { kind: 'library', nodeId: input.nodeId, parentId: input.parentId },
        } };
        try { await deps.onCommitted?.(committed); } catch { /* Final completion retries the receipt. */ }
        try {
          checkOwner();
          (deps.markTreeDirty || markRepositoryTreeSnapshotDirty)(input.libraryId);
          (deps.notifyDeleted || notifyLibraryFilesDeleted)({ ...request.ownerScope, libraryId: input.libraryId, nodeIds });
        } catch { /* A scope change must not reverse the committed deletion. */ }
      },
    });
    if (!committed) throw new Error('删除接口未返回提交回执');
    let cleanupFailed = outcome.draftCleanupFailed || outcome.viewerSessionCleanupFailed || outcome.subtreeCollectionFailed;
    try { checkOwner(); await (deps.onRefreshDirectory || refreshDirectoryInTree)(input.parentId); }
    catch { cleanupFailed = true; }
    return { committed: true, result: cleanupFailed ? { ...committed, message: `${committed.message}，但目录刷新或本地预览清理未完成；不要重复删除` } : committed };
  } catch (error) {
    if (committed) return { committed: true, result: { ...committed, message: `${committed.message}，但本地清理未完成；不要重复删除` } };
    const rejected = error instanceof IpcRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    const unknown = attempted && !rejected;
    return { result: { ok: false, message: unknown ? '删除提交状态无法确认，请检查回收站和原目录，不要盲目重试'
      : error instanceof Error ? error.message : '删除失败', data: { deleteCommitState: unknown ? 'commit_unknown' : 'uncommitted' } } };
  }
}

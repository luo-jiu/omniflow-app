import { normalizeAgentNodeConfigureInput, normalizeAgentNodeConfigFields, resolveAgentNodeConfig } from '@/shared/agent/agent-node-config';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { notifyLibraryNodesMutated } from '@/features/file-explorer/services/node-mutation-events';
import { readAgentLibraryNode, resolveAgentLibraryPath } from './agent-library.api';
import { configureAgentLibraryNode } from './agent-library-actions.api';
import { assertAgentLibraryActionScope, sameAgentLibraryNode, type AgentLibraryActionDependencies } from './agent-library-actions';
import { reportAgentToolExecutionProgress } from './agent.api';
import type { AgentRendererToolOutcome } from './agent-tool-executor';

export async function executeAgentNodeConfigure(
  request: AgentToolExecutionRequest, deps: AgentLibraryActionDependencies = {},
): Promise<AgentRendererToolOutcome> {
  let attempted = false;
  let committed: AgentToolResult | undefined;
  try {
    assertAgentLibraryActionScope(request, deps);
    const raw = request.input as Record<string, unknown>;
    if (!raw || Array.isArray(raw) || !Number.isSafeInteger(raw.libraryId) || Number(raw.libraryId) <= 0
      || raw.libraryId !== request.appContext.libraryId) throw new Error('目录配置的资料库范围无效');
    const { libraryId: rawLibrary, observedSource, ...args } = raw;
    const libraryId = Number(rawLibrary);
    const input = normalizeAgentNodeConfigureInput(args);
    const read = deps.readLibraryNode || readAgentLibraryNode;
    const source = input.path !== undefined
      ? await (deps.resolvePath || resolveAgentLibraryPath)(libraryId, input.path, 'dir') : await read(libraryId, input.nodeId!);
    if (source.libraryId !== libraryId || source.type !== 'dir'
      || (input.nodeId !== undefined && source.id !== input.nodeId)
      || (input.path !== undefined && source.path !== input.path)) throw new Error('目标必须是当前资料库中的目录');
    if (observedSource && !sameAgentLibraryNode(observedSource as AgentLibraryNode, source)) throw new Error('目标已变化，请重新读取目录后配置');
    const next = resolveAgentNodeConfig(normalizeAgentNodeConfigFields(source), input);
    if (typeof source.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(source.updatedAt)) {
      throw new Error('服务端未返回可核对的目录版本，请更新服务端后重试');
    }
    assertAgentLibraryActionScope(request, deps);
    const fresh = await read(libraryId, source.id);
    if (!sameAgentLibraryNode(source, fresh) || fresh.builtInType !== source.builtInType || fresh.archiveMode !== source.archiveMode) {
      throw new Error('目录位置或配置已变化，请重新读取后配置');
    }
    assertAgentLibraryActionScope(request, deps);
    if (deps.beforeCommit) await deps.beforeCommit();
    assertAgentLibraryActionScope(request, deps);
    await (deps.reportProgress || reportAgentToolExecutionProgress)({ executionId: request.executionId, libraryId, ownerScope: request.ownerScope,
      runId: request.runId, sessionId: request.sessionId, phase: 'committing', progress: { message: '正在更新资源类型与归档配置' } });
    assertAgentLibraryActionScope(request, deps);
    const patch = normalizeAgentNodeConfigFields(input);
    attempted = true;
    await (deps.configure || configureAgentLibraryNode)({ nodeId: source.id, libraryId,
      expectedUpdatedAt: source.updatedAt, ...patch });
    const affectedParentIds = [...new Set([source.parentId, source.id].filter(id => id > 0))];
    committed = { ok: true, message: `已更新“${source.name}”的资源配置`, data: {
      mutationCommitState: 'committed', operationId: request.executionId, operation: 'node.configure',
      libraryId, nodeId: source.id, name: source.name, path: source.path, affectedParentIds,
      previousConfig: { builtInType: source.builtInType, archiveMode: source.archiveMode }, requestedConfig: next,
      configVerification: 'unavailable', destination: { kind: 'library', nodeId: source.id, parentId: source.parentId },
    } };
    try { await deps.onCommitted?.(committed); } catch { /* Completion sends the authoritative receipt again. */ }
    let refreshed: AgentLibraryNode | undefined;
    let warning = '';
    try {
      assertAgentLibraryActionScope(request, deps, false);
      const result = await read(libraryId, source.id);
      if (result.libraryId !== libraryId || result.id !== source.id || result.type !== 'dir') throw new Error('结果身份不匹配');
      refreshed = result;
      const current = normalizeAgentNodeConfigFields(result);
      const matches = current.builtInType === next.builtInType && current.archiveMode === next.archiveMode;
      Object.assign(committed.data as object, { node: result, configVerification: matches ? 'verified' : 'changed' });
      if (!matches) warning = '当前配置与提交值不同，请根据最新节点信息继续';
      if (result.parentId > 0 && !affectedParentIds.includes(result.parentId)) affectedParentIds.push(result.parentId);
    } catch { warning = '结果核对未完成，请先读取当前目录配置，不要重复提交'; }
    try {
      assertAgentLibraryActionScope(request, deps, false);
      await (deps.notifyMutation || notifyLibraryNodesMutated)({ ...request.ownerScope, libraryId,
        nodeId: source.id, affectedParentIds, configChanged: true, ...(refreshed ? normalizeAgentNodeConfigFields(refreshed) : {}),
        parentId: refreshed?.parentId ?? source.parentId, name: refreshed?.name ?? source.name, type: 'dir',
      });
    } catch { warning ||= '目录刷新未完成，请刷新查看结果，不要重复提交'; }
    return { committed: true, result: warning ? { ...committed, message: `${committed.message}；${warning}` } : committed,
      ...(refreshed ? { perception: { knownNodes: [refreshed], selectedNodes: [], collectedAt: new Date().toISOString() } } : {}),
    };
  } catch (error) {
    if (committed) return { committed: true, result: { ...committed, message: `${committed.message}；本地同步未完成，请刷新查看结果` } };
    const rejected = error instanceof IpcRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
    const unknown = attempted && !rejected;
    return { result: { ok: false, message: unknown ? '目录配置提交状态无法确认，请读取当前配置核对，不要盲目重试'
      : error instanceof Error ? error.message : '目录配置失败', data: {
      mutationCommitState: unknown ? 'commit_unknown' : 'uncommitted', operationId: request.executionId,
    } } };
  }
}

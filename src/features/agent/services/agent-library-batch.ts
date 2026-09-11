import type { AgentToolExecutionRequest, AgentToolResult } from '@/shared/agent/agent.types';
import type { AgentRendererToolOutcome, AgentRendererToolExecutorDependencies } from './agent-tool-executor';
import { executeAgentLibraryAction } from './agent-library-actions';
import { executeAgentTagTool } from './agent-tag-tools';

type BatchOperation = 'file.rename' | 'file.move' | 'file.copy' | 'tag.update';
type Item = { operation: BatchOperation; path?: string; nodeId?: number; parentPath?: string; parentId?: number; name?: string; addTagIds?: number[]; removeTagIds?: number[]; conflictPolicy?: 'error' | 'auto_rename' };
const states = ['committed', 'uncommitted', 'commit_unknown', 'conflict', 'skipped', 'cancelled'] as const;

function bounded(value: unknown): AgentToolResult { const result = value as AgentToolResult; const json = JSON.stringify(result); return json.length > 40_000 ? { ok: false, message: '批量结果超过输出限制，请缩小 actions 数量' } : result; }

export async function executeAgentLibraryBatch(request: AgentToolExecutionRequest, deps: AgentRendererToolExecutorDependencies = {}): Promise<AgentRendererToolOutcome> {
  const input = request.input as { libraryId?: number; actions?: Item[] };
  if (!input || input.libraryId !== request.appContext.libraryId || !Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 50) return { result: { ok: false, message: '批量操作需要 1 至 50 个 actions，并且必须属于当前资料库' } };
  const libraryId = Number(request.appContext.libraryId);
  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < input.actions.length; index += 1) {
    const action = input.actions[index];
    try {
      deps.signal?.throwIfAborted();
      const { operation: toolName, ...actionInput } = action;
      if (!['file.rename', 'file.move', 'file.copy'].includes(toolName) && toolName !== 'tag.update') throw new Error('不支持的批量操作');
      let childInput: Record<string, unknown> = { ...actionInput, libraryId: input.libraryId };
      if (toolName === 'tag.update' && action.nodeId !== undefined) {
        const nodeId = action.nodeId;
        const readNode = deps.readLibraryNode;
        if (!readNode) throw new Error('无法读取节点');
        const node = await readNode(libraryId, nodeId);
        if (node.libraryId !== libraryId || node.id !== nodeId) throw new Error('节点不属于当前资料库');
        childInput = { ...childInput, target: node };
      }
      const child: AgentToolExecutionRequest = { ...request, toolName, input: childInput };
      // Child commits are folded into one authoritative batch receipt. Otherwise
      // the renderer broker may expose the first child receipt as the whole batch.
      const childDependencies = { ...deps, onCommitted: undefined };
      const outcome = toolName === 'tag.update' ? await executeAgentTagTool(child, childDependencies) : await executeAgentLibraryAction(child, childDependencies);
      const data = outcome.result.data as Record<string, unknown> | undefined;
      const state = outcome.result.ok ? 'committed' : data?.mutationCommitState === 'commit_unknown' ? 'commit_unknown' : /冲突|已存在/.test(outcome.result.message || '') ? 'conflict' : data?.mutationCommitState === 'uncommitted' ? 'uncommitted' : 'skipped';
      results.push({ index, operationId: request.executionId, operation: toolName, status: state, ...(data?.affectedParentIds ? { affectedParentIds: data.affectedParentIds } : {}), ...(data?.nodeId ? { nodeId: data.nodeId } : {}), message: outcome.result.message });
    } catch (error) {
      const cancelled = deps.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
      results.push({ index, operation: action?.operation, status: cancelled ? 'cancelled' : 'uncommitted', message: cancelled ? '批量操作已取消，之前已提交项保留' : error instanceof Error ? error.message : '操作失败' });
      if (cancelled) for (let rest = index + 1; rest < input.actions.length; rest += 1) results.push({ index: rest, operation: input.actions[rest]?.operation, status: 'cancelled', message: '未开始执行' });
      if (cancelled) break;
    }
  }
  const counts = Object.fromEntries(states.map(state => [state, results.filter(item => item.status === state).length]));
  const hasCommitted = results.some(item => item.status === 'committed');
  const result = bounded({ ok: true, message: `批量操作完成 ${results.length}/${input.actions.length} 项`, data: {
    mutationCommitState: hasCommitted ? 'committed' : 'uncommitted', operationId: request.executionId,
    revision: request.appContext.libraryId, results, counts,
  } });
  if (hasCommitted) await deps.onCommitted?.(result);
  return { committed: hasCommitted, result };
}

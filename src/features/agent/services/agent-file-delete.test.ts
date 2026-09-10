import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { executeAgentFileDelete, type AgentFileDeleteDependencies } from './agent-file-delete';

const node = { id: 9, libraryId: 3, parentId: 8, name: 'report', type: 'file' as const, path: '/docs/report.txt', updatedAt: 'v1' };
const cleanup = { deletedNodeIds: [9], draftCleanupFailed: false, viewerSessionCleanupFailed: false, subtreeCollectionFailed: false };
function request(): AgentToolExecutionRequest {
  return { toolName: 'file.delete', executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, appContext: { libraryId: 3, platform: 'darwin' },
    input: { ...node, nodeId: 9, recursive: false } } as AgentToolExecutionRequest;
}
function dependencies() {
  return { assertOwner: vi.fn(), beforeCommit: vi.fn(async () => undefined), readLibraryNode: vi.fn(async () => node),
    deleteSubtree: vi.fn(async (input: Parameters<NonNullable<AgentFileDeleteDependencies['deleteSubtree']>>[0]) => {
      await input.beforeDelete?.(); await input.onDeleted?.([9]); return cleanup;
    }), onCommitted: vi.fn(), notifyDeleted: vi.fn(), markTreeDirty: vi.fn(), onRefreshDirectory: vi.fn(),
  };
}
describe('agent internal deletion', () => {
  it('resolves a full library path before applying the same deletion checks', async () => {
    const deps = dependencies(), req = request(); req.input = { libraryId: 3, path: node.path, recursive: false };
    const resolvePath = vi.fn(async () => node);
    expect(await executeAgentFileDelete(req, { ...deps, resolvePath })).toMatchObject({ committed: true });
    expect(resolvePath).toHaveBeenCalledWith(3, node.path);
    expect(deps.readLibraryNode).toHaveBeenCalledTimes(2);
  });
  it('rechecks the target and reports committed trash before refreshing', async () => {
    const deps = dependencies();
    const result = await executeAgentFileDelete(request(), deps);
    expect(result).toMatchObject({ committed: true, result: { ok: true, data: { deleteCommitState: 'committed', recoverable: true } } });
    expect(deps.readLibraryNode).toHaveBeenCalledTimes(2);
    expect(deps.notifyDeleted).toHaveBeenCalledWith({ ...request().ownerScope, libraryId: 3, nodeIds: [9] });
    expect(deps.onRefreshDirectory).toHaveBeenCalledWith(8);
    expect(deps.onCommitted.mock.invocationCallOrder[0]).toBeLessThan(deps.onRefreshDirectory.mock.invocationCallOrder[0]);
  });
  it('rejects moved, modified, cross-library and root targets before deletion', async () => {
    for (const changed of [{ ...node, parentId: 10 }, { ...node, updatedAt: 'v2' }, { ...node, libraryId: 4 }]) {
      const deps = dependencies(); deps.readLibraryNode.mockResolvedValue(changed);
      expect((await executeAgentFileDelete(request(), deps)).result.ok).toBe(false);
      expect(deps.deleteSubtree).not.toHaveBeenCalled();
    }
    const deps = dependencies(); const req = request(); req.input = { ...(req.input as object), parentId: 0 };
    expect((await executeAgentFileDelete(req, deps)).result.ok).toBe(false);
    expect(deps.deleteSubtree).not.toHaveBeenCalled();
  });
  it('retains successful deletion when refresh, receipt or local cleanup fails', async () => {
    const deps = dependencies(); deps.onCommitted.mockRejectedValue(new Error('receipt lost')); deps.onRefreshDirectory.mockRejectedValue(new Error('refresh failed'));
    expect(await executeAgentFileDelete(request(), deps)).toMatchObject({ committed: true, result: { ok: true } });
    const next = dependencies(); next.deleteSubtree.mockImplementation(async input => { await input.beforeDelete?.(); await input.onDeleted?.([9]); throw new Error('cleanup failed'); });
    expect(await executeAgentFileDelete(request(), next)).toMatchObject({ committed: true, result: { ok: true } });
  });
  it('distinguishes unknown network commits from authoritative rejection', async () => {
    for (const [error, state] of [[new Error('connection lost'), 'commit_unknown'], [new IpcRequestError('denied', 403), 'uncommitted']] as const) {
      const deps = dependencies(); deps.deleteSubtree.mockImplementation(async input => { await input.beforeDelete?.(); throw error; });
      expect((await executeAgentFileDelete(request(), deps)).result).toMatchObject({ ok: false, data: { deleteCommitState: state } });
      expect(deps.notifyDeleted).not.toHaveBeenCalled();
    }
  });
  it('cancels before commit but preserves a successful in-flight delete', async () => {
    const controller = new AbortController(); const deps = dependencies();
    deps.beforeCommit.mockImplementation(async () => { controller.abort(); return undefined; });
    expect((await executeAgentFileDelete(request(), { ...deps, signal: controller.signal })).result).toMatchObject({ ok: false, data: { deleteCommitState: 'uncommitted' } });
    expect(deps.onCommitted).not.toHaveBeenCalled();
    const next = dependencies(); const running = new AbortController();
    next.deleteSubtree.mockImplementation(async input => { await input.beforeDelete?.(); running.abort(); await input.onDeleted?.([9]); return cleanup; });
    expect(await executeAgentFileDelete(request(), { ...next, signal: running.signal })).toMatchObject({ committed: true, result: { ok: true } });
  });
  it('blocks an owner change during preparation', async () => {
    const deps = dependencies(); deps.assertOwner.mockImplementationOnce(() => undefined).mockImplementation(() => { throw new Error('owner changed'); });
    expect((await executeAgentFileDelete(request(), deps)).result.ok).toBe(false);
    expect(deps.beforeCommit).not.toHaveBeenCalled();
  });
});

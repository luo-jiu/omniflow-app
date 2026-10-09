import { describe, expect, it, vi } from 'vitest';
import { IpcRequestError } from '@/service/request/ipcRequest';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import { executeAgentNodeConfigure } from './agent-node-configure';
import type { AgentLibraryActionDependencies } from './agent-library-actions';

const folder: AgentLibraryNode = { id: 20, libraryId: 3, parentId: 10, name: '作品', path: '/作品', type: 'dir',
  builtInType: 'ASMR', archiveMode: 1, updatedAt: '2026-10-01T00:00:00.123456Z' };
function request(input: object): AgentToolExecutionRequest {
  return { toolName: 'node.configure', input: { libraryId: 3, ...input }, executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' },
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } } as AgentToolExecutionRequest;
}
function fixture() {
  let node = { ...folder };
  const deps = {
    assertOwner: vi.fn(), beforeCommit: vi.fn(async () => undefined),
    reportProgress: vi.fn(async () => true),
    readLibraryNode: vi.fn(async () => ({ ...node })), resolvePath: vi.fn(async () => ({ ...node })),
    configure: vi.fn<NonNullable<AgentLibraryActionDependencies['configure']>>(async patch => {
      node = { ...node, ...(patch.builtInType !== undefined ? { builtInType: patch.builtInType } : {}),
        ...(patch.archiveMode !== undefined ? { archiveMode: patch.archiveMode } : {}), updatedAt: '2026-10-01T00:00:01.123456Z' };
    }),
    notifyMutation: vi.fn(), onCommitted: vi.fn(async () => undefined),
  };
  return { deps, setNode: (value: AgentLibraryNode) => { node = value; } };
}

describe('Agent node.configure execution', () => {
  it('preserves unspecified fields, keeps the exact CAS timestamp and refreshes the folder and parent', async () => {
    const { deps } = fixture();
    const result = await executeAgentNodeConfigure(request({ path: '/作品', builtInType: 'COMIC' }), deps);
    expect(deps.configure).toHaveBeenCalledWith({ nodeId: 20, libraryId: 3, expectedUpdatedAt: folder.updatedAt, builtInType: 'COMIC' });
    expect(deps.reportProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'committing' }));
    expect(deps.reportProgress.mock.invocationCallOrder[0]).toBeLessThan(deps.configure.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ committed: true, result: { ok: true, data: { configVerification: 'verified',
      mutationCommitState: 'committed', requestedConfig: { builtInType: 'COMIC', archiveMode: 1 }, node: { builtInType: 'COMIC', archiveMode: 1 } } },
      perception: { knownNodes: [{ id: 20, builtInType: 'COMIC', archiveMode: 1 }] } });
    expect(deps.notifyMutation).toHaveBeenCalledWith(expect.objectContaining({ configChanged: true, affectedParentIds: [10, 20], builtInType: 'COMIC', archiveMode: 1 }));
  });

  it('turns archive off for DEF and permits an authorized library root', async () => {
    const { deps, setNode } = fixture(); setNode({ ...folder, id: 1, parentId: 0, path: '/' });
    expect((await executeAgentNodeConfigure(request({ path: '/', builtInType: 'DEF' }), deps)).result.ok).toBe(true);
    expect(deps.configure).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 1, builtInType: 'DEF', archiveMode: 0 }));
    expect(deps.notifyMutation).toHaveBeenCalledWith(expect.objectContaining({ affectedParentIds: [1] }));
  });

  it('rejects files, foreign nodes, changed identities, illegal combinations and an old backend before writing', async () => {
    for (const node of [{ ...folder, type: 'file' as const }, { ...folder, libraryId: 4 }, { ...folder, id: 21 },
      { ...folder, builtInType: undefined }, { ...folder, archiveMode: undefined }, { ...folder, updatedAt: undefined },
      { ...folder, builtInType: 'DEF' as const, archiveMode: 0 as const }]) {
      const { deps, setNode } = fixture(); setNode(node);
      const outcome = await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 1 }), deps);
      expect(outcome.result).toMatchObject({ ok: false, data: { mutationCommitState: 'uncommitted' } });
      expect(deps.configure).not.toHaveBeenCalled();
    }
    const { deps } = fixture();
    expect((await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 0, observedSource: { ...folder, updatedAt: 'old' } }), deps)).result.ok).toBe(false);
    expect(deps.configure).not.toHaveBeenCalled();
  });

  it('rejects configuration drift and abort/owner changes before commit', async () => {
    const drift = fixture(); drift.deps.readLibraryNode.mockResolvedValueOnce({ ...folder, archiveMode: 0 });
    expect((await executeAgentNodeConfigure(request({ path: '/作品', builtInType: 'COMIC' }), drift.deps)).result.ok).toBe(false);
    expect(drift.deps.configure).not.toHaveBeenCalled();
    const cancel = fixture(), controller = new AbortController();
    cancel.deps.beforeCommit.mockImplementation(async () => { controller.abort(); });
    expect((await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 0 }), { ...cancel.deps, signal: controller.signal })).result.ok).toBe(false);
    expect(cancel.deps.configure).not.toHaveBeenCalled();
    const owner = fixture(); owner.deps.beforeCommit.mockImplementation(async () => {
      owner.deps.assertOwner.mockImplementation(() => { throw new Error('owner changed'); });
    });
    expect((await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 0 }), owner.deps)).result.ok).toBe(false);
    expect(owner.deps.configure).not.toHaveBeenCalled();
  });

  it('distinguishes rejection from uncertain submission and preserves an acknowledged write if verification fails', async () => {
    for (const [error, state] of [[new IpcRequestError('目录已变化', 409), 'uncommitted'], [new Error('lost response'), 'commit_unknown']] as const) {
      const { deps } = fixture(); deps.configure.mockRejectedValue(error);
      expect((await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 0 }), deps)).result).toMatchObject({ ok: false, data: { mutationCommitState: state } });
      expect(deps.onCommitted).not.toHaveBeenCalled(); expect(deps.notifyMutation).not.toHaveBeenCalled();
    }
    const { deps } = fixture();
    deps.configure.mockImplementation(async () => { deps.readLibraryNode.mockRejectedValue(new Error('read unavailable')); });
    const result = await executeAgentNodeConfigure(request({ nodeId: 20, archiveMode: 0 }), deps);
    expect(result).toMatchObject({ committed: true, result: { ok: true, data: { mutationCommitState: 'committed', configVerification: 'unavailable' } } });
    expect(deps.notifyMutation).toHaveBeenCalledWith(expect.objectContaining({ configChanged: true }));
    expect(deps.notifyMutation.mock.calls[0][0]).not.toHaveProperty('archiveMode');
  });

  it('reports a subsequent configuration change without reversing the successful commit', async () => {
    const { deps, setNode } = fixture();
    deps.configure.mockImplementation(async () => setNode({ ...folder, builtInType: 'VIDEO' }));
    const result = await executeAgentNodeConfigure(request({ nodeId: 20, builtInType: 'COMIC' }), deps);
    expect(result).toMatchObject({ committed: true, result: { ok: true, data: { configVerification: 'changed', node: { builtInType: 'VIDEO' } } } });
    expect(result.result.message).toContain('当前配置与提交值不同');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { executeAgentLibraryBatch } from './agent-library-batch';
import { executeAgentLibraryAction } from './agent-library-actions';
import { executeAgentNodeConfigure } from './agent-node-configure';

vi.mock('./agent-library-actions', () => ({ executeAgentLibraryAction: vi.fn() }));
vi.mock('./agent-tag-tools', () => ({ executeAgentTagTool: vi.fn() }));
vi.mock('./agent-node-configure', () => ({ executeAgentNodeConfigure: vi.fn() }));

const request = (actions: unknown[]) => ({ executionId: 'batch-1', toolName: 'library.batch', input: { libraryId: 3, actions }, appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, ownerScope: {}, runId: 'r', sessionId: 's' } as never);

describe('executeAgentLibraryBatch', () => {
  it('keeps directory configuration receipts and perception in the same per-item batch model', async () => {
    const node = { id: 20, libraryId: 3, parentId: 10, type: 'dir' as const, name: 'comic', builtInType: 'COMIC' as const, archiveMode: 1 as const };
    vi.mocked(executeAgentNodeConfigure).mockResolvedValueOnce({ committed: true, result: { ok: true, data: { nodeId: 20,
      mutationCommitState: 'committed', affectedParentIds: [10, 20], node, requestedConfig: { builtInType: 'COMIC', archiveMode: 1 }, configVerification: 'verified' } },
      perception: { knownNodes: [node], selectedNodes: [], collectedAt: '' } })
      .mockResolvedValueOnce({ result: { ok: false, data: { mutationCommitState: 'commit_unknown' } } });
    const callback = vi.fn();
    const result = await executeAgentLibraryBatch(request([{ operation: 'node.configure', nodeId: 20, builtInType: 'COMIC' }, { operation: 'node.configure', nodeId: 21, builtInType: 'ASMR' }]), { onCommitted: callback });
    expect(result).toMatchObject({ committed: true, result: { data: { affectedParentIds: [10, 20], counts: { committed: 1, commit_unknown: 1 },
      results: [{ status: 'committed', currentConfig: { builtInType: 'COMIC', archiveMode: 1 }, configVerification: 'verified' }, { status: 'commit_unknown' }] } }, perception: { knownNodes: [node] } });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeAgentNodeConfigure).mock.calls[0][1]?.onCommitted).toBeUndefined();
  });
  it('keeps partial success and classifies conflict and commit_unknown independently', async () => {
    vi.mocked(executeAgentLibraryAction)
      .mockResolvedValueOnce({ result: { ok: true, message: '已复制', data: { mutationCommitState: 'committed', nodeId: 10 } } })
      .mockResolvedValueOnce({ result: { ok: false, message: '目标已存在，产生冲突', data: { mutationCommitState: 'uncommitted' } } })
      .mockResolvedValueOnce({ result: { ok: false, message: '网络中断', data: { mutationCommitState: 'commit_unknown' } } });
    const outcome = await executeAgentLibraryBatch(request([{ operation: 'file.copy', nodeId: 1 }, { operation: 'file.move', nodeId: 2 }, { operation: 'file.rename', nodeId: 3 }]));
    expect(outcome.result.data).toMatchObject({ counts: { committed: 1, conflict: 1, commit_unknown: 1 }, mutationCommitState: 'committed' });
  });

  it('cancels the current and all not-started items', async () => {
    const controller = new AbortController();
    vi.mocked(executeAgentLibraryAction).mockImplementationOnce(async () => { controller.abort(); throw Object.assign(new Error('cancel'), { name: 'AbortError' }); });
    const outcome = await executeAgentLibraryBatch(request([{ operation: 'file.copy', nodeId: 1 }, { operation: 'file.copy', nodeId: 2 }]), { signal: controller.signal });
    expect(outcome.result.data).toMatchObject({ counts: { cancelled: 2 } });
  });
});

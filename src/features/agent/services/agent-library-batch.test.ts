import { describe, expect, it, vi } from 'vitest';
import { executeAgentLibraryBatch } from './agent-library-batch';
import { executeAgentLibraryAction } from './agent-library-actions';

vi.mock('./agent-library-actions', () => ({ executeAgentLibraryAction: vi.fn() }));
vi.mock('./agent-tag-tools', () => ({ executeAgentTagTool: vi.fn() }));

const request = (actions: unknown[]) => ({ executionId: 'batch-1', toolName: 'library.batch', input: { libraryId: 3, actions }, appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, ownerScope: {}, runId: 'r', sessionId: 's' } as never);

describe('executeAgentLibraryBatch', () => {
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

import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import type { TagItem } from '@/features/tag-management/services/tag.api';
import { executeAgentTagTool } from './agent-tag-tools';
import { IpcRequestError } from '@/service/request/ipcRequest';

const node = { id: 9, libraryId: 3, parentId: 8, name: 'report', type: 'file' as const, path: '/report' };
const tag = (id: number, ownerUserId: number | null = 7): TagItem => ({ id, name: `tag${id}`, ownerUserId,
  type: 'FILE', scope: 'resource', enabled: 1, sortOrder: 0, color: '#ffffff', targetKinds: ['file'] });
function request(input: object = {}): AgentToolExecutionRequest {
  return { toolName: 'tag.list', executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' },
    appContext: { libraryId: 3, platform: 'darwin' }, input: { libraryId: 3, ...input } } as AgentToolExecutionRequest;
}
function dependencies() {
  return { assertOwner: vi.fn(), fetchTags: vi.fn(async () => [tag(1), tag(2, null), tag(3, 8),
    { ...tag(4), enabled: 0 }, { ...tag(5), scope: 'ui' }]),
  readLibraryNode: vi.fn(async () => node), readNodeTags: vi.fn(async () => ({ nodeId: 9, libraryId: 3, parentId: 8,
    tagIds: [1, 3, 99], affectedParentIds: [8], dryRun: false })),
  updateNodeTags: vi.fn(async () => ({ nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1, 3, 99], affectedParentIds: [8], dryRun: false })),
  beforeCommit: vi.fn(async () => undefined), onCommitted: vi.fn(), notifyMutated: vi.fn() };
}
describe('agent tags', () => {
  it('only lists enabled owner/public resource tags with explicit continuation', async () => {
    const deps = dependencies();
    const first = await executeAgentTagTool(request({ limit: 1 }), deps);
    expect(first).toMatchObject({ result: { ok: true,
      data: { entries: [{ id: 1 }], hasMore: true, nextOffset: 1, total: 2 } } });
    const revision = (first.result.data as Record<string, unknown>).revision;
    expect(await executeAgentTagTool(request({ offset: 1, revision }), deps)).toMatchObject({ result: { data: {
      entries: [{ id: 2 }], hasMore: false } } });
    expect(deps.readNodeTags).not.toHaveBeenCalled();
  });
  it('preserves unresolved IDs from authoritative relations', async () => {
    expect(await executeAgentTagTool(request({ nodeId: 9, target: node }), dependencies())).toMatchObject({ result: { ok: true,
      data: { entries: [{ id: 1 }], unresolvedTagIds: [3, 99], authoritativeRelations: true, updateAvailable: true } } });
  });
  it('refuses malformed metadata, changed nodes, cross-library and guessed targets', async () => {
    const deps = dependencies(); deps.readNodeTags.mockResolvedValue({ nodeId: 9, libraryId: 4, parentId: 8, tagIds: [], affectedParentIds: [8], dryRun: false });
    expect((await executeAgentTagTool(request({ nodeId: 9, target: node }), deps)).result.ok).toBe(false);
    const next = dependencies(); next.readLibraryNode.mockResolvedValue({ ...node, parentId: 20 });
    expect((await executeAgentTagTool(request({ nodeId: 9, target: node }), next)).result.ok).toBe(false);
    for (const input of [{ libraryId: 4 }, { nodeId: 9 }, { limit: 101 }]) {
      const invalid = dependencies();
      expect((await executeAgentTagTool(request(input), invalid)).result.ok).toBe(false);
      expect(invalid.fetchTags).not.toHaveBeenCalled();
    }
  });
  it('does not return results after owner drift or cancellation', async () => {
    const deps = dependencies(); deps.assertOwner.mockImplementationOnce(() => undefined)
      .mockImplementation(() => { throw new Error('owner changed'); });
    expect((await executeAgentTagTool(request(), deps)).result.ok).toBe(false);
    const controller = new AbortController(); const canceled = dependencies();
    canceled.fetchTags.mockImplementation(async () => { controller.abort(); return [tag(1)]; });
    expect((await executeAgentTagTool(request(), { ...canceled, signal: controller.signal })).result.ok).toBe(false);
  });
  it('sends only deltas and records facts before notifying', async () => {
    const deps = dependencies(); const req = request({ nodeId: 9, target: node, addTagIds: [1], removeTagIds: [2] }); req.toolName = 'tag.update';
    deps.readLibraryNode.mockResolvedValueOnce(node).mockResolvedValueOnce({ ...node, updatedAt: 'v2' } as typeof node);
    expect(await executeAgentTagTool(req, deps)).toMatchObject({ committed: true, result: { ok: true, data: {
      mutationCommitState: 'committed', affectedParentIds: [8] } }, perception: { knownNodes: [{ id: 9, updatedAt: 'v2' }] } });
    expect(deps.updateNodeTags).toHaveBeenCalledWith(9, { libraryId: 3, addTagIds: [1], removeTagIds: [2] });
    expect(deps.onCommitted.mock.invocationCallOrder[0]).toBeLessThan(deps.notifyMutated.mock.invocationCallOrder[0]);
    expect(deps.fetchTags).not.toHaveBeenCalled(); expect(deps.readNodeTags).not.toHaveBeenCalled();
  });
  it('distinguishes rejected and uncertain writes including malformed receipts', async () => {
    for (const [error, state] of [[new IpcRequestError('denied', 403), 'uncommitted'], [new Error('lost'), 'commit_unknown']] as const) {
      const deps = dependencies(); deps.updateNodeTags.mockRejectedValue(error);
      const req = request({ nodeId: 9, target: node, addTagIds: [1] }); req.toolName = 'tag.update';
      expect(await executeAgentTagTool(req, deps)).toMatchObject({ result: { ok: false, data: { mutationCommitState: state } } });
      expect(deps.notifyMutated).not.toHaveBeenCalled();
    }
    const deps = dependencies(); deps.updateNodeTags.mockResolvedValue({ nodeId: 9, libraryId: 3, parentId: 8, tagIds: [], affectedParentIds: [8], dryRun: true });
    const req = request({ nodeId: 9, target: node, addTagIds: [1] }); req.toolName = 'tag.update';
    expect(await executeAgentTagTool(req, deps)).toMatchObject({ result: { ok: false, data: { mutationCommitState: 'commit_unknown' } } });
  });
  it('cancels before dispatch but never reverses a successful in-flight write', async () => {
    const req = request({ nodeId: 9, target: node, addTagIds: [1] }); req.toolName = 'tag.update';
    const deps = dependencies(); const before = new AbortController();
    deps.beforeCommit.mockImplementation(async () => { before.abort(); });
    expect(await executeAgentTagTool(req, { ...deps, signal: before.signal })).toMatchObject({ result: { data: { mutationCommitState: 'uncommitted' } } });
    expect(deps.updateNodeTags).not.toHaveBeenCalled();
    const next = dependencies(); const after = new AbortController();
    next.updateNodeTags.mockImplementation(async () => { after.abort(); return { nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1], affectedParentIds: [8], dryRun: false }; });
    next.onCommitted.mockRejectedValue(new Error('receipt lost')); next.notifyMutated.mockImplementation(() => { throw new Error('refresh'); });
    expect(await executeAgentTagTool(req, { ...next, signal: after.signal })).toMatchObject({ committed: true, result: { ok: true } });
  });
  it('rejects empty, overlapping and invalid deltas before committing', async () => {
    for (const delta of [{}, { addTagIds: [1], removeTagIds: [1] }, { addTagIds: [0] }]) {
      const deps = dependencies(); const req = request({ nodeId: 9, target: node, ...delta }); req.toolName = 'tag.update';
      expect((await executeAgentTagTool(req, deps)).result.ok).toBe(false);
      expect(deps.beforeCommit).not.toHaveBeenCalled();
    }
  });
  it('retains commit facts after owner drift without notifying the new workspace', async () => {
    const deps = dependencies(); const req = request({ nodeId: 9, target: node, addTagIds: [1] }); req.toolName = 'tag.update';
    deps.updateNodeTags.mockImplementation(async () => {
      deps.assertOwner.mockImplementation(() => { throw new Error('owner changed'); });
      return { nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1], affectedParentIds: [8], dryRun: false };
    });
    expect(await executeAgentTagTool(req, deps)).toMatchObject({ committed: true, result: { ok: true } });
    expect(deps.onCommitted).toHaveBeenCalledOnce(); expect(deps.notifyMutated).not.toHaveBeenCalled();
  });
  it('keeps mixed long tags and unresolved IDs under the JSON byte budget without skipping', async () => {
    const deps = dependencies();
    deps.fetchTags.mockResolvedValue(Array.from({ length: 60 }, (_, index) => ({ ...tag(index * 2 + 1), name: '长标签'.repeat(150) })));
    deps.readNodeTags.mockResolvedValue({ nodeId: 9, libraryId: 3, parentId: 8,
      tagIds: Array.from({ length: 120 }, (_, index) => index + 1), affectedParentIds: [8], dryRun: false });
    let offset = 0; let revision: unknown; const received: number[] = [];
    for (;;) {
      const out = await executeAgentTagTool(request({ nodeId: 9, target: node, limit: 100, offset, revision }), deps);
      expect(out.result.ok).toBe(true);
      expect(new TextEncoder().encode(JSON.stringify(out.result)).byteLength).toBeLessThanOrEqual(8000);
      const data = out.result.data as { entries: { id: number }[]; unresolvedTagIds: number[]; revision: string; hasMore: boolean; nextOffset?: number };
      const ids = [...data.entries.map(entry => entry.id), ...data.unresolvedTagIds].sort((a, b) => a - b);
      received.push(...ids);
      if (!data.hasMore) break;
      expect(data.nextOffset).toBe(offset + ids.length);
      expect(ids.length).toBeLessThan(100);
      offset = data.nextOffset!; revision = data.revision;
    }
    expect(received).toEqual(Array.from({ length: 120 }, (_, index) => index + 1));
  });
  it('pages 10000 unresolved IDs instead of injecting them in every page', async () => {
    const deps = dependencies(); deps.fetchTags.mockResolvedValue([]);
    deps.readNodeTags.mockResolvedValue({ nodeId: 9, libraryId: 3, parentId: 8,
      tagIds: Array.from({ length: 10000 }, (_, index) => index + 1), affectedParentIds: [8], dryRun: false });
    const first = await executeAgentTagTool(request({ nodeId: 9, target: node }), deps);
    const data = first.result.data as { unresolvedTagIds: number[]; revision: string; nextOffset: number };
    expect(data.unresolvedTagIds).toHaveLength(100); expect(data.nextOffset).toBe(100);
    const second = await executeAgentTagTool(request({ nodeId: 9, target: node, offset: data.nextOffset, revision: data.revision }), deps);
    expect((second.result.data as { unresolvedTagIds: number[] }).unresolvedTagIds[0]).toBe(101);
    expect(new TextEncoder().encode(JSON.stringify(second.result)).byteLength).toBeLessThanOrEqual(8000);
  });
  it('binds continuation to the query, owner and snapshot and rejects missing revisions', async () => {
    const deps = dependencies(); const first = await executeAgentTagTool(request({ limit: 1 }), deps);
    const revision = (first.result.data as { revision: string }).revision;
    expect((await executeAgentTagTool(request({ offset: 1 }), deps)).result.ok).toBe(false);
    expect((await executeAgentTagTool(request({ offset: 1, revision, keyword: 'tag1' }), deps)).result.ok).toBe(false);
    const ownerChanged = request({ offset: 1, revision }); ownerChanged.ownerScope.accountScope = 'user:8';
    expect((await executeAgentTagTool(ownerChanged, deps)).result.ok).toBe(false);
    deps.fetchTags.mockResolvedValue([tag(1), { ...tag(2), name: 'changed' }]);
    expect((await executeAgentTagTool(request({ offset: 1, revision }), deps)).result.ok).toBe(false);
  });
});

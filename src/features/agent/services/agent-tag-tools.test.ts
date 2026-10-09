import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import type { TagItem } from '@/features/tag-management/services/tag.api';
import { executeAgentTagTool } from './agent-tag-tools';
import { IpcRequestError } from '@/service/request/ipcRequest';

const node = { id: 9, libraryId: 3, parentId: 8, name: 'report', type: 'file' as const, path: '/report' };
const tag = (id: number): TagItem => ({ id, libraryId: 3, name: `tag${id}`,
  type: 'FILE', scope: 'resource', enabled: 1, sortOrder: 0, color: '#ffffff', targetKinds: ['file'] });
function request(input: object = {}): AgentToolExecutionRequest {
  return { toolName: 'tag.list', executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' },
    appContext: { libraryId: 3, platform: 'darwin' }, input: { libraryId: 3, ...input } } as AgentToolExecutionRequest;
}
function dependencies() {
  return { assertOwner: vi.fn(), queryLibraryTags: vi.fn(async () => ({ entries: [tag(1)], hasMore: false, nextCursor: undefined as string | undefined })),
  readLibraryNode: vi.fn(async () => node),
  updateNodeTags: vi.fn(async () => ({ nodeId: 9, libraryId: 3, parentId: 8, tagIds: [1, 3, 99], affectedParentIds: [8], dryRun: false })),
  beforeCommit: vi.fn(async () => undefined), onCommitted: vi.fn(), notifyMutated: vi.fn() };
}
describe('agent tags', () => {
  it('delegates library, keyword, dimension and cursor filtering to the server', async () => {
    const deps = dependencies();
    deps.queryLibraryTags.mockResolvedValueOnce({ entries: [tag(1)], hasMore: true, nextCursor: 'opaque-next' })
      .mockResolvedValueOnce({ entries: [tag(2)], hasMore: false, nextCursor: undefined });
    const first = await executeAgentTagTool(request({ limit: 1, keyword: '日语', dimension: 'language' }), deps);
    expect(first).toMatchObject({ result: { ok: true,
      data: { entries: [{ id: 1 }], hasMore: true, nextCursor: 'opaque-next', source: 'library_resource_catalog' } } });
    expect(deps.queryLibraryTags).toHaveBeenLastCalledWith({ libraryId: 3, keyword: '日语', dimension: 'language',
      limit: 1, enabled: true });
    expect(await executeAgentTagTool(request({ cursor: 'opaque-next' }), deps)).toMatchObject({ result: { data: {
      entries: [{ id: 2 }], hasMore: false } } });
    expect(deps.queryLibraryTags).toHaveBeenLastCalledWith(expect.objectContaining({ libraryId: 3, cursor: 'opaque-next', limit: 10 }));
    expect(deps.readLibraryNode).not.toHaveBeenCalled();
  });
  it('queries authoritative direct bindings without hiding disabled tags', async () => {
    const deps = dependencies();
    deps.queryLibraryTags.mockResolvedValue({ entries: [{ ...tag(2), enabled: 0, deleted: true, legacy: true }], hasMore: false, nextCursor: undefined });
    expect(await executeAgentTagTool(request({ nodeId: 9, target: node }), deps)).toMatchObject({ result: { ok: true,
      data: { entries: [{ id: 2, enabled: 0, deleted: true, legacy: true }], authoritativeRelations: true, source: 'node_tag_rel' } } });
    expect(deps.queryLibraryTags).toHaveBeenCalledWith({ libraryId: 3, nodeId: 9, limit: 10 });
  });
  it('refuses malformed pages, changed nodes, cross-library and guessed targets', async () => {
    const deps = dependencies();
    deps.queryLibraryTags.mockResolvedValue({ entries: [{ ...tag(1), libraryId: 4 }], hasMore: false, nextCursor: undefined });
    expect((await executeAgentTagTool(request(), deps)).result.ok).toBe(false);
    const next = dependencies(); next.readLibraryNode.mockResolvedValue({ ...node, parentId: 20 });
    expect((await executeAgentTagTool(request({ nodeId: 9, target: node }), next)).result.ok).toBe(false);
    expect(next.queryLibraryTags).not.toHaveBeenCalled();
    for (const input of [{ libraryId: 4 }, { nodeId: 9 }, { limit: 11 }, { cursor: '' }]) {
      const invalid = dependencies();
      expect((await executeAgentTagTool(request(input), invalid)).result.ok).toBe(false);
      expect(invalid.queryLibraryTags).not.toHaveBeenCalled();
    }
  });
  it('does not return results after owner drift or cancellation', async () => {
    const deps = dependencies(); deps.assertOwner.mockImplementationOnce(() => undefined)
      .mockImplementation(() => { throw new Error('owner changed'); });
    expect((await executeAgentTagTool(request(), deps)).result.ok).toBe(false);
    const controller = new AbortController(); const canceled = dependencies();
    canceled.queryLibraryTags.mockImplementation(async () => { controller.abort(); return { entries: [tag(1)], hasMore: false, nextCursor: undefined }; });
    expect((await executeAgentTagTool(request(), { ...canceled, signal: controller.signal })).result.ok).toBe(false);
  });
  it('sends only deltas and records facts before notifying', async () => {
    const deps = dependencies(); const req = request({ nodeId: 9, target: node, addTagIds: [1], removeTagIds: [2] }); req.toolName = 'tag.update';
    deps.readLibraryNode.mockResolvedValueOnce(node).mockResolvedValueOnce({ ...node, updatedAt: 'v2' } as typeof node);
    expect(await executeAgentTagTool(req, deps)).toMatchObject({ committed: true, result: { ok: true, data: {
      mutationCommitState: 'committed', affectedParentIds: [8] } }, perception: { knownNodes: [{ id: 9, updatedAt: 'v2' }] } });
    expect(deps.updateNodeTags).toHaveBeenCalledWith(9, { libraryId: 3, addTagIds: [1], removeTagIds: [2] });
    expect(deps.onCommitted.mock.invocationCallOrder[0]).toBeLessThan(deps.notifyMutated.mock.invocationCallOrder[0]);
    expect(deps.queryLibraryTags).not.toHaveBeenCalled();
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
  it('preserves complete server pages and cursors within the byte budget', async () => {
    const deps = dependencies();
    const entries = Array.from({ length: 10 }, (_, index) => ({ ...tag(index + 1), name: '长'.repeat(128), dimension: '类'.repeat(64) }));
    deps.queryLibraryTags.mockResolvedValue({ entries, hasMore: true, nextCursor: 'server-cursor' });
    const out = await executeAgentTagTool(request(), deps);
    expect(out.result.ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(out.result)).byteLength).toBeLessThanOrEqual(8000);
    expect(out.result.data).toMatchObject({ entries: entries.map(({ id, name, dimension, enabled }) => ({ id, name, dimension, enabled })),
      nextCursor: 'server-cursor' });
  });
  it('rejects invalid continuation instead of silently losing a page', async () => {
    for (const nextCursor of [undefined, '', 'same']) {
      const deps = dependencies(); deps.queryLibraryTags.mockResolvedValue({ entries: [tag(1)], hasMore: true, nextCursor });
      expect((await executeAgentTagTool(request({ cursor: 'same' }), deps)).result.ok).toBe(false);
    }
    const deps = dependencies();
    deps.queryLibraryTags.mockResolvedValue({ entries: [{ ...tag(1), name: '长'.repeat(3000) }], hasMore: true, nextCursor: 'next' });
    const out = await executeAgentTagTool(request(), deps);
    expect(out.result).toMatchObject({ ok: false, message: expect.stringContaining('相同 cursor') });
  });
});

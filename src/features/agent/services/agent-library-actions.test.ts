import { describe, expect, it, vi } from 'vitest';
import type { AgentToolExecutionRequest } from '@/shared/agent/agent.types';
import type { AgentLibraryNode } from '@/shared/agent/agent-library-query';
import { IpcRequestError } from '@/service/request/ipcRequest';
import { executeAgentLibraryAction, executeAgentRecycleList } from './agent-library-actions';

const source: AgentLibraryNode = { id: 9, libraryId: 3, parentId: 8, name: 'report', ext: 'txt', type: 'file', path: '/docs/report.txt', updatedAt: 'v1' };
const parent: AgentLibraryNode = { id: 20, libraryId: 3, parentId: 1, name: 'archive', type: 'dir', path: '/archive', updatedAt: 'v1' };
const recycled = { ...source, deletedAt: '2026-09-10T00:00:00Z' };
function request(toolName: string, args: object): AgentToolExecutionRequest {
  return { toolName, input: { libraryId: 3, ...args }, executionId: 'e', sessionId: 's', runId: 'r',
    ownerScope: { accountScope: 'user:7', backendScope: 'https://test.invalid/api' }, appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } } as AgentToolExecutionRequest;
}
function dependencies() {
  const nodes = new Map([[9, { ...source }], [20, { ...parent }]]);
  return { nodes, assertOwner: vi.fn(), beforeCommit: vi.fn(async (): Promise<void> => undefined),
    readLibraryNode: vi.fn(async (_library: number, id: number) => { const node = nodes.get(id); if (!node) throw new Error('missing'); return { ...node }; }),
    resolvePath: vi.fn(async (_library: number, path: string) => { const node = Array.from(nodes.values()).find(item => item.path === path); if (!node) throw new Error('missing'); return { ...node }; }),
    createDirectory: vi.fn(async (args: { name: string }) => { const node: AgentLibraryNode = { ...parent, id: 30, parentId: 20, name: args.name, path: '/archive/' + args.name }; nodes.set(30, node); return node; }) as any,
    rename: vi.fn(async (args: { id: number; name: string; ext?: string }) => { nodes.set(9, { ...source, name: args.name, ext: args.ext, path: '/docs/' + args.name + (args.ext ? '.' + args.ext : '') }); }),
    move: vi.fn(async () => { nodes.set(9, { ...source, parentId: 20, path: '/archive/report.txt' }); return { movedCount: 1, movedNodeIds: [9], affectedParentIds: [8, 20] }; }),
    copy: vi.fn(async () => { const node = { ...source, id: 30, parentId: 20, path: '/archive/report.txt' }; nodes.set(30, node); return { node, copiedCount: 1 }; }),
    recycleItems: vi.fn(async () => [recycled]), restore: vi.fn(async () => true),
    notifyMutation: vi.fn(), onCommitted: vi.fn(async (): Promise<void> => undefined),
  };
}
describe('complete internal file actions', () => {
  it('renames using a full file name without losing or duplicating the extension', async () => {
    const deps = dependencies();
    const result = await executeAgentLibraryAction(request('file.rename', { path: source.path, name: 'report.final.md' }), deps);
    expect(deps.rename).toHaveBeenCalledWith({ id: 9, name: 'report.final', ext: 'md' });
    expect(result).toMatchObject({ committed: true, result: { ok: true, data: { mutationCommitState: 'committed', affectedParentIds: [8] } } });
    expect(deps.notifyMutation).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.final', ext: 'md', nodeId: 9 }));
  });
  it('moves by IDs and refreshes both source and destination', async () => {
    const deps = dependencies();
    expect(await executeAgentLibraryAction(request('file.move', { nodeId: 9, parentId: 20 }), deps)).toMatchObject({ committed: true });
    expect(deps.move).toHaveBeenCalledWith({ libraryId: 3, newParentId: 20, items: [{ nodeId: 9 }] });
    expect(deps.notifyMutation).toHaveBeenCalledWith(expect.objectContaining({ affectedParentIds: [20, 8] }));
  });
  it('creates in an explicit directory and copies with an independent resulting node', async () => {
    const deps = dependencies();
    expect(await executeAgentLibraryAction(request('directory.create', { path: '/archive/new' }), deps)).toMatchObject({ committed: true });
    expect(deps.createDirectory).toHaveBeenCalledWith(expect.objectContaining({ parentId: 20, name: 'new', conflictPolicy: 'error' }));
    const result = await executeAgentLibraryAction(request('file.copy', { nodeId: 9, parentPath: '/archive', conflictPolicy: 'auto_rename' }), deps);
    expect(result.result).toMatchObject({ ok: true, data: { nodeId: 30, copiedCount: 1 } });
    expect(deps.copy).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 9, parentId: 20, conflictPolicy: 'auto_rename' }));
  });
  it('restores a verified recycle entry, using the current restored parent', async () => {
    const deps = dependencies();
    deps.restore.mockImplementation(async () => { deps.nodes.set(9, { ...source, parentId: 20 }); return true; });
    const result = await executeAgentLibraryAction(request('recycle.restore', { nodeId: 9 }), deps);
    expect(result).toMatchObject({ committed: true, result: { data: { destination: { parentId: 20 } } } });
    expect(deps.recycleItems).toHaveBeenCalledTimes(2);
  });
  it('rejects changed, cross-library, self-descendant and implicit recursive sources', async () => {
    const stale = dependencies();
    const req = request('file.rename', { nodeId: 9, name: 'changed.txt', observedSource: { ...source, updatedAt: 'old' } });
    expect((await executeAgentLibraryAction(req, stale)).result.ok).toBe(false); expect(stale.rename).not.toHaveBeenCalled();
    const cross = dependencies(); cross.nodes.set(9, { ...source, libraryId: 4 });
    expect((await executeAgentLibraryAction(request('file.move', { nodeId: 9, parentId: 20 }), cross)).result.ok).toBe(false);
    const folder = dependencies(); folder.nodes.set(9, { ...source, type: 'dir', path: '/archive' });
    expect((await executeAgentLibraryAction(request('file.copy', { nodeId: 9, parentId: 20, recursive: true }), folder)).result.ok).toBe(false);
    folder.nodes.set(9, { ...source, type: 'dir' });
    expect((await executeAgentLibraryAction(request('file.copy', { nodeId: 9, parentId: 20 }), folder)).result.ok).toBe(false);
  });
  it('keeps confirmed writes when notification fails and distinguishes network uncertainty', async () => {
    const deps = dependencies(); deps.notifyMutation.mockImplementation(() => { throw new Error('refresh'); });
    expect(await executeAgentLibraryAction(request('file.rename', { nodeId: 9, name: 'next.txt' }), deps)).toMatchObject({ committed: true, result: { ok: true } });
    for (const [error, state] of [[new IpcRequestError('conflict', 409), 'uncommitted'], [new Error('lost response'), 'commit_unknown']] as const) {
      const test = dependencies(); test.rename.mockRejectedValue(error);
      expect((await executeAgentLibraryAction(request('file.rename', { nodeId: 9, name: 'next.txt' }), test)).result).toMatchObject({ ok: false, data: { mutationCommitState: state } });
      expect(test.onCommitted).not.toHaveBeenCalled();
    }
  });
  it('does not commit on cancellation or owner changes during preparation', async () => {
    const deps = dependencies(), controller = new AbortController();
    deps.beforeCommit.mockImplementation(async () => controller.abort());
    expect((await executeAgentLibraryAction(request('file.move', { nodeId: 9, parentId: 20 }), { ...deps, signal: controller.signal })).result).toMatchObject({ data: { mutationCommitState: 'uncommitted' } });
    expect(deps.move).not.toHaveBeenCalled();
    const changed = dependencies(); changed.beforeCommit.mockImplementation(async () => { changed.assertOwner.mockImplementation(() => { throw new Error('owner changed'); }); });
    expect((await executeAgentLibraryAction(request('file.move', { nodeId: 9, parentId: 20 }), changed)).result.ok).toBe(false);
    expect(changed.move).not.toHaveBeenCalled();
  });
  it('pages recycle results without leaking storage identity, rejecting stale continuations', async () => {
    const deps = dependencies(); deps.recycleItems.mockResolvedValue([recycled, { ...recycled, id: 10 }]);
    const first = await executeAgentRecycleList(request('recycle.list', { limit: 1 }), deps);
    expect(first.result.data).toMatchObject({ hasMore: true, nextOffset: 1, entries: [{ nodeId: 10 }] });
    const revision = (first.result.data as { revision: string }).revision;
    expect((await executeAgentRecycleList(request('recycle.list', { limit: 1, offset: 1, revision }), deps)).result.data).toMatchObject({ hasMore: false, entries: [{ nodeId: 9 }] });
    deps.recycleItems.mockResolvedValue([recycled]);
    expect((await executeAgentRecycleList(request('recycle.list', { offset: 1, revision }), deps)).result.ok).toBe(false);
    expect(JSON.stringify(first)).not.toMatch(/storageKey|storageEndpoint|signedUrl/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AgentLibraryNode, AgentLibraryQuery } from '@/shared/agent/agent-library-query';
import type { AgentLibraryAccessSnapshot } from '@/shared/agent/agent-session-management';
import { createAgentLibraryAccessGuard, type AgentAccessApproval } from './agent-library-access';

function fixture(mode: AgentLibraryAccessSnapshot['mode'] = 'group', access: AgentLibraryAccessSnapshot['access'] = 'read-write') {
  const nodes = new Map<number, AgentLibraryNode>([
    [1, { id: 1, libraryId: 3, parentId: 0, name: 'root', type: 'dir', path: '/' }],
    [10, { id: 10, libraryId: 3, parentId: 1, name: 'docs', type: 'dir', path: '/docs' }],
    [11, { id: 11, libraryId: 3, parentId: 10, name: 'a', ext: 'txt', type: 'file', path: '/docs/a.txt' }],
    [12, { id: 12, libraryId: 3, parentId: 10, name: 'sub', type: 'dir', path: '/docs/sub' }],
    [13, { id: 13, libraryId: 3, parentId: 12, name: 'nested', ext: 'txt', type: 'file', path: '/docs/sub/nested.txt' }],
    [20, { id: 20, libraryId: 3, parentId: 1, name: 'secret', type: 'dir', path: '/secret' }],
    [21, { id: 21, libraryId: 3, parentId: 20, name: 'private', type: 'file', path: '/secret/private' }],
    [30, { id: 30, libraryId: 3, parentId: 1, name: 'docs-other', type: 'dir', path: '/docs-other' }],
    [31, { id: 31, libraryId: 3, parentId: 30, name: 'other', type: 'file', path: '/docs-other/other' }],
  ]);
  const read = vi.fn(async (query: AgentLibraryQuery) => {
    const node = query.path ? [...nodes.values()].find(item => item.path === query.path) : nodes.get(query.nodeId || query.directoryId || 1);
    if (!node) throw new Error('Node missing');
    return query.kind === 'list' ? { libraryId: 3, directory: node, entries: [...nodes.values()].filter(item => item.parentId === node.id) }
      : { libraryId: 3, node: { ...node } };
  });
  const approve = vi.fn<(request: AgentAccessApproval) => Promise<boolean>>().mockResolvedValue(true);
  const controller = new AbortController();
  const assertCurrent = vi.fn(async () => undefined);
  const guard = createAgentLibraryAccessGuard({ policy: { version: 1, groupId: 'g', policyRevision: 1, mode, access,
    directories: [{ nodeId: 10, name: 'docs' }] }, context: { libraryId: 3, platform: 'darwin', selectedNodeIds: [], currentDirectory: { id: 10, name: 'docs' } },
    signal: controller.signal, read, approve, assertCurrent });
  const call = (name: string, input: object) => ({ id: name, name, input });
  return { guard, nodes, read, approve, controller, assertCurrent, call };
}

describe('Client-owned Agent directory authorization', () => {
  it('authorizes the document viewer but does not trust arbitrary document tools', async () => {
    const { guard, call, approve } = fixture();
    expect(await guard.authorizeTool(call('library.document.view', { nodeId: 11 }), 'view')).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    await guard.authorizeTool(call('library.document.unknown', { nodeId: 11 }), 'unknown');
    expect(approve).toHaveBeenCalledOnce();
  });

  it('automatically authorizes descendants and ordinary writes, but does not use path prefixes', async () => {
    const { guard, call, approve } = fixture();
    expect(await guard.authorizeTool(call('file.read', { path: '/docs/sub/nested.txt' }), 'read')).toBe(true);
    expect(await guard.authorizeTool(call('file.write', { path: '/docs/new.txt', content: 'hello' }), 'write')).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    await guard.authorizeTool(call('file.read', { path: '/docs-other/other' }), 'outside');
    expect(approve).toHaveBeenCalledOnce();
    expect(approve.mock.calls[0][0]).toMatchObject({ targets: [{ nodeId: 31, write: false }] });
  });

  it('filters first-turn perception and does not expose ancestors or selected nodes outside the group', async () => {
    const { guard, nodes } = fixture();
    const perception = await guard.initialPerception({ collectedAt: '', selectedNodes: [nodes.get(21)!] });
    expect(perception?.currentDirectory?.id).toBe(10);
    expect(perception?.selectedNodes).toEqual([]);
    expect(JSON.stringify(perception)).not.toContain('secret');
    expect(guard.observedNodes().some(node => node.id === 1 || node.id === 20 || node.id === 21)).toBe(false);
  });

  it('requires approval in ungrouped mode and reuses only the granted read scope', async () => {
    const { guard, call, approve } = fixture('ask');
    expect(await guard.initialPerception({ collectedAt: '', selectedNodes: [] })).toMatchObject({ selectedNodes: [] });
    await guard.authorizeTool(call('file.list', {}), 'list');
    await guard.authorizeTool(call('file.read', { path: '/docs/a.txt' }), 'read');
    expect(approve).toHaveBeenCalledOnce();
    await guard.authorizeTool(call('file.read', { path: '/secret/private' }), 'other');
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('does not grant writes to a read-only group or make a one-off write grant permanent', async () => {
    const { guard, call, approve } = fixture('group', 'read');
    const operation = call('file.write', { path: '/docs/new.txt', content: 'hello' });
    await guard.authorizeTool(operation, 'write');
    await guard.authorizeTool(operation, 'write', undefined, false);
    expect(approve).toHaveBeenCalledOnce();
    await guard.authorizeTool(operation, 'another-write');
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('checks both ends of moves and rejects ancestry drift before committing', async () => {
    const { guard, nodes, call, approve } = fixture();
    const operation = call('file.move', { nodeId: 11, parentId: 20 });
    await guard.authorizeTool(operation, 'move');
    expect(approve.mock.calls[0][0]).toMatchObject({ targets: [{ nodeId: 20, write: true }] });
    nodes.set(11, { ...nodes.get(11)!, parentId: 20, path: '/secret/a.txt' });
    await expect(guard.authorizeTool(operation, 'move', undefined, false)).rejects.toThrow('授权已变化');
  });

  it('requires confirmation for removing the authorized root and rejects a missing root', async () => {
    const { guard, nodes, call, approve } = fixture();
    await guard.authorizeTool(call('file.delete', { nodeId: 10, recursive: true }), 'delete-root');
    expect(approve).toHaveBeenCalledOnce();
    nodes.delete(10);
    await expect(guard.authorizeTool(call('file.read', { nodeId: 11 }), 'read')).rejects.toThrow();
  });

  it('does not auto-approve host Shell and fails closed for unapproved or changed policies', async () => {
    const { guard, call, approve, assertCurrent } = fixture();
    expect(await guard.authorizeTool(call('shell.run', { command: 'pwd' }), 'shell')).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    approve.mockResolvedValue(false);
    await expect(guard.authorizeTool(call('file.read', { path: '/secret/private' }), 'read')).rejects.toThrow('未批准');
    assertCurrent.mockRejectedValue(new Error('Group revoked'));
    await expect(guard.authorizeTool(call('file.read', { path: '/docs/a.txt' }), 'inside')).rejects.toThrow('revoked');
  });

  it('preserves explicit full access and rejects unsolicited out-of-scope metadata', async () => {
    const full = fixture('full-access');
    await full.guard.authorizeTool(full.call('file.read', { path: '/secret/private' }), 'full');
    expect(full.approve).not.toHaveBeenCalled();
    const grouped = fixture();
    await expect(grouped.guard.checkMetadata({ libraryId: 3, node: grouped.nodes.get(21)! })).rejects.toThrow('未经授权');
  });
});

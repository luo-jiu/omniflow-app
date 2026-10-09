import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { AgentPluginToolSource } from '@/shared/agent/agent.types';
import type { AgentLibraryNode, AgentLibraryQuery } from '@/shared/agent/agent-library-query';
import type { AgentLibraryAccessSnapshot } from '@/shared/agent/agent-session-management';
import { createAgentLibraryAccessGuard, type AgentAccessApproval } from './agent-library-access';

function fixture(mode: AgentLibraryAccessSnapshot['mode'] = 'group', access: AgentLibraryAccessSnapshot['access'] = 'read-write',
  pluginTools?: ReadonlyMap<string, AgentPluginToolSource>, pluginRenameTools?: ReadonlyMap<string, AgentPluginToolSource>,
  pluginOutputTools?: ReadonlyMap<string, AgentPluginToolSource>) {
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
    signal: controller.signal, read, approve, assertCurrent, pluginTools, pluginRenameTools, pluginOutputTools });
  const call = (name: string, input: object) => ({ id: name, name, input });
  return { guard, nodes, read, approve, controller, assertCurrent, call };
}

describe('Client-owned Agent directory authorization', () => {
  it('authorizes directory configuration and batches with existing write grants, without expanding read-only access', async () => {
    const writable = fixture();
    expect(await writable.guard.authorizeTool(writable.call('node.configure', { nodeId: 10, builtInType: 'COMIC' }), 'config')).toBe(true);
    expect(await writable.guard.authorizeTool(writable.call('library.batch', { actions: [{ operation: 'node.configure', path: '/docs/sub', archiveMode: 1 }] }), 'batch')).toBe(true);
    expect(writable.approve).not.toHaveBeenCalled();
    await expect(writable.guard.authorizeTool(writable.call('node.configure', { nodeId: 11, builtInType: 'COMIC' }), 'file')).rejects.toThrow('必须为普通目录');
    const readOnly = fixture('group', 'read');
    await readOnly.guard.authorizeTool(readOnly.call('node.configure', { nodeId: 10, builtInType: 'COMIC', archiveMode: 1 }), 'config');
    expect(readOnly.approve).toHaveBeenCalledWith(expect.objectContaining({ write: true, description: expect.stringContaining('COMIC'), targets: [{ nodeId: 10, name: '/docs', write: true, descendants: false }] }));
    readOnly.nodes.set(10, { ...readOnly.nodes.get(10)!, parentId: 20 });
    await expect(readOnly.guard.authorizeTool(readOnly.call('node.configure', { nodeId: 10, builtInType: 'COMIC' }), 'config', undefined, false)).rejects.toThrow('授权已变化');
  });
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

function pluginCatalog(pluginId = 'test.csv', toolId = `${pluginId}.query`) {
  const pluginVersion = '1.0.0'; const packageFingerprint = 'a'.repeat(64);
  const registrationId = `plugin-tool:${createHash('sha256').update(JSON.stringify([
    'omniflow-agent-tool-v1', pluginId, pluginVersion, packageFingerprint, toolId,
  ])).digest('hex')}`;
  return new Map<string, AgentPluginToolSource>([[toolId, { pluginId, pluginVersion, packageFingerprint, toolId, registrationId }]]);
}

describe('Agent plugin Tool single-file directory authorization', () => {
  it('uses the frozen catalog to automatically authorize a group file and ask only for an outside file', async () => {
    const catalog = pluginCatalog();
    const { guard, call, approve } = fixture('group', 'read', catalog);
    catalog.clear();
    expect(await guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 11 } }), 'inside')).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    await guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 21 } }), 'outside');
    expect(approve).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ write: false,
      targets: [{ nodeId: 21, name: '/secret/private', write: false, descendants: false }] }));
    await guard.authorizeResource(21, false, 'outside', false);
  });

  it('does not accept a prefix, selected-node fallback, forged resource identity or a directory target', async () => {
    const { guard, call, approve, read, nodes } = fixture('group', 'read', pluginCatalog());
    await guard.authorizeTool(call('test.csv.unknown', { resource: { nodeId: 11 } }), 'unknown');
    expect(approve).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ targets: [], write: true }));
    approve.mockClear();
    for (const input of [{}, { nodeId: 11 }, { resource: { nodeId: '11' } }, { resource: { nodeId: 0 } },
      { resource: { nodeId: 11, path: '/secret' } }]) {
      await expect(guard.authorizeTool(call('test.csv.query', input), 'bad-input')).rejects.toThrow('resource.nodeId');
    }
    await expect(guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 10 } }), 'directory')).rejects.toThrow('普通文件');
    nodes.set(11, { ...nodes.get(11)!, libraryId: 4 });
    await expect(guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 11 } }), 'wrong-library')).rejects.toThrow('当前资料库');
    read.mockResolvedValueOnce({ libraryId: 3, node: nodes.get(21)! });
    await expect(guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 13 } }), 'wrong-node')).rejects.toThrow('身份或目录位置');
    expect(approve).not.toHaveBeenCalled();
  });

  it('never converts a plugin approval into opaque, writable, other-file or directory access', async () => {
    const { guard, call, approve } = fixture('group', 'read', pluginCatalog());
    guard.grantApprovedTool('plugin-run');
    await guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 21 } }), 'plugin-run');
    expect(approve).toHaveBeenCalledOnce();
    guard.grantApprovedTool('plugin-run');
    await expect(guard.authorizeResource(11, false, 'plugin-run', false)).rejects.toThrow('不匹配');
    await expect(guard.authorizeResource(21, true, 'plugin-run', false)).rejects.toThrow('不匹配');
    await expect(guard.authorizeDirectory('/secret', false, 'plugin-run', false)).rejects.toThrow('不允许目录访问');
    await expect(guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 11 } }), 'plugin-run')).rejects.toThrow('身份已变化');
  });

  it('rechecks live ancestry and policy for reads after the first authorization', async () => {
    const { guard, call, nodes, assertCurrent } = fixture('group', 'read', pluginCatalog());
    await guard.authorizeTool(call('test.csv.query', { resource: { nodeId: 11 } }), 'plugin-run');
    nodes.set(11, { ...nodes.get(11)!, parentId: 20, path: '/secret/a.txt' });
    await expect(guard.authorizeResource(11, false, 'plugin-run', false)).rejects.toThrow('授权已变化');
    assertCurrent.mockRejectedValue(new Error('Policy revoked'));
    await expect(guard.authorizeResource(11, false, 'plugin-run', false)).rejects.toThrow('revoked');
  });

  it('requires ungrouped confirmation and still checks file identity under explicit full access', async () => {
    const asked = fixture('ask', 'read', pluginCatalog());
    asked.approve.mockResolvedValue(false);
    await expect(asked.guard.authorizeTool(asked.call('test.csv.query', { resource: { nodeId: 11 } }), 'plugin-run')).rejects.toThrow('未批准');
    const full = fixture('full-access', 'read-write', pluginCatalog());
    await full.guard.authorizeTool(full.call('test.csv.query', { resource: { nodeId: 21 } }), 'plugin-run');
    expect(full.approve).not.toHaveBeenCalled();
    full.nodes.set(21, { ...full.nodes.get(21)!, type: 'dir' });
    await expect(full.guard.authorizeResource(21, false, 'plugin-run', false)).rejects.toThrow('普通文件');
  });
});

const RENAME_TOOL = 'test.rename.propose';
function renameFixture(mode: AgentLibraryAccessSnapshot['mode'] = 'group', access: AgentLibraryAccessSnapshot['access'] = 'read-write') {
  return fixture(mode, access, undefined, pluginCatalog('test.rename', RENAME_TOOL));
}

describe('Agent plugin rename scope and sealed file set', () => {
  it('requires a write scope grant for a read-only group without auto-approving the final proposal', async () => {
    const { guard, call, approve } = renameFixture('group', 'read');
    const invocation = call(RENAME_TOOL, { resources: [11, 13], prefix: 'new-' });
    expect(await guard.authorizeTool(invocation, 'rename')).toBe(false);
    expect(approve).toHaveBeenCalledOnce();
    expect(approve.mock.calls[0][0]).toMatchObject({ write: true, targets: [
      { nodeId: 11, write: true, descendants: false }, { nodeId: 13, write: true, descendants: false },
    ] });
    expect(approve.mock.calls[0][0].description).toContain('改名提案另行确认');
    await guard.authorizeRename([13], 'rename');
    expect(await guard.canAutoApproveTool(invocation, 'rename')).toBe(false);
    expect(approve).toHaveBeenCalledOnce();
    await guard.authorizeTool(invocation, 'next-rename'); expect(approve).toHaveBeenCalledTimes(2);
  });

  it.each(['group', 'full-access'] as const)('keeps final proposal approval separate in %s access', async mode => {
    const { guard, call, approve } = renameFixture(mode);
    const invocation = call(RENAME_TOOL, { resources: [11, 13] });
    expect(await guard.authorizeTool(invocation, 'rename')).toBe(false);
    expect(await guard.canAutoApproveTool(invocation, 'rename')).toBe(false);
    expect(approve).not.toHaveBeenCalled(); await guard.authorizeRename([11, 13], 'rename');
  });

  it('freezes the exact rename catalog separately from read declarations', async () => {
    const catalog = pluginCatalog('test.rename', RENAME_TOOL);
    const { guard, call } = fixture('group', 'read-write', undefined, catalog); catalog.clear();
    await guard.authorizeTool(call(RENAME_TOOL, { resources: [11] }), 'rename');
    await guard.authorizeRename([11], 'rename');
    expect(() => fixture('group', 'read-write', pluginCatalog('test.rename', RENAME_TOOL), pluginCatalog('test.rename', RENAME_TOOL))).toThrow('不能混用');
  });

  it('checks every file in the current library and rejects directory targets even when ancestors are cached', async () => {
    const { guard, nodes, call, approve } = renameFixture('full-access');
    await expect(guard.authorizeTool(call(RENAME_TOOL, { resources: [13, 12] }), 'directory')).rejects.toThrow('普通文件');
    nodes.set(13, { ...nodes.get(13)!, libraryId: 4 });
    await expect(guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 13] }), 'cross-library')).rejects.toThrow('当前资料库');
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([undefined, [], [11, 11], [0], ['11'], [1.5], [Number.MAX_SAFE_INTEGER + 1], new Array(2), Array.from({ length: 51 }, (_, index) => index + 1)])('rejects malformed or unbounded resource IDs %#', async resources => {
    const { guard, call, read } = renameFixture();
    await expect(guard.authorizeTool(call(RENAME_TOOL, { resources }), 'invalid')).rejects.toThrow('resources');
    expect(read).not.toHaveBeenCalled();
  });

  it('never expands a prepared file set through opaque grants, another Tool name, paths or generic resource access', async () => {
    const { guard, call, approve } = renameFixture('ask');
    guard.grantApprovedTool('rename');
    await guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 13] }), 'rename');
    expect(approve).toHaveBeenCalledOnce(); guard.grantApprovedTool('rename');
    await guard.authorizeRename([11], 'rename');
    await expect(guard.authorizeRename([21], 'rename', true)).rejects.toThrow('不匹配');
    await expect(guard.authorizeRename([11, 11], 'rename')).rejects.toThrow('不重复');
    await expect(guard.authorizeRename([11], 'unbound')).rejects.toThrow('不匹配');
    await expect(guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 21] }), 'rename')).rejects.toThrow('身份已变化');
    await expect(guard.authorizeTool(call('file.read', { nodeId: 11 }), 'rename')).rejects.toThrow('身份已变化');
    await expect(guard.authorizeDirectory('/docs', true, 'rename')).rejects.toThrow('不允许目录');
    await expect(guard.authorizeResource(11, false, 'rename')).rejects.toThrow('正文读取');
    await expect(guard.authorizeResource(11, true, 'rename')).rejects.toThrow('通用文件写入');
    await expect(guard.authorizeQuery({ kind: 'list', directoryId: 10 }, false, 'rename')).rejects.toThrow('元数据查询');
    await expect(guard.authorizeQuery({ kind: 'stat', path: '/docs/a.txt' }, false, 'rename')).rejects.toThrow('元数据查询');
    await expect(guard.authorizeQuery({ kind: 'resolve', nodeId: 21 }, false, 'rename')).rejects.toThrow('不匹配');
    await guard.authorizeQuery({ kind: 'stat', nodeId: 11 }, false, 'rename');
    expect(approve).toHaveBeenCalledOnce();
  });

  it('rechecks ancestry and policy before later metadata or mutation access', async () => {
    const { guard, call, nodes, assertCurrent } = renameFixture('group', 'read');
    await guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 13] }), 'rename');
    nodes.set(13, { ...nodes.get(13)!, parentId: 20, path: '/secret/nested.txt' });
    await expect(guard.authorizeRename([11, 13], 'rename')).rejects.toThrow('授权已变化');
    assertCurrent.mockRejectedValueOnce(new Error('revoked'));
    await expect(guard.authorizeRename([11], 'rename')).rejects.toThrow('revoked');
  });

  it('validates every returned metadata node against the exact write scope, even in full-access mode', async () => {
    for (const mode of ['group', 'full-access'] as const) {
      const { guard, call, nodes } = renameFixture(mode, 'read');
      await guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 13] }), 'rename');
      await guard.checkMetadata({ libraryId: 3, entries: [nodes.get(11)!, nodes.get(13)!] }, 'rename');
      for (const data of [
        { libraryId: 3, entries: [nodes.get(11)!, nodes.get(21)!] },
        { libraryId: 4, node: nodes.get(11)! },
        { libraryId: 3, node: { ...nodes.get(11)!, libraryId: 4 } },
        { libraryId: 3, node: { ...nodes.get(11)!, type: 'dir' as const } },
        { libraryId: 3, entries: [nodes.get(11)!, nodes.get(11)!] },
      ]) await expect(guard.checkMetadata(data, 'rename')).rejects.toThrow();
    }
  });

  it('shares ancestor lookup within a multi-file authorization and does not cache it across calls', async () => {
    const { guard, call, read } = renameFixture();
    await guard.authorizeTool(call(RENAME_TOOL, { resources: [11, 13] }), 'rename');
    expect(read.mock.calls.map(([query]) => query.nodeId).filter(nodeId => nodeId === 10)).toHaveLength(1);
    expect(read.mock.calls.map(([query]) => query.nodeId).filter(nodeId => nodeId === 1)).toHaveLength(1);
    read.mockClear(); await guard.authorizeRename([11, 13], 'rename');
    expect(read.mock.calls.map(([query]) => query.nodeId).filter(nodeId => nodeId === 10)).toHaveLength(1);
  });
});

describe('Agent file-output plugin authorization', () => {
  const name = 'example.csv-export.export';
  const input = { resource: { nodeId: 11 }, destination: { parentId: 20, fileName: 'filtered.csv' } };
  const setup = (mode: AgentLibraryAccessSnapshot['mode'] = 'ask') => fixture(mode, 'read-write', undefined, undefined, pluginCatalog('example.csv-export', name));
  it('approves exactly one readable source and one writable directory without replacing proposal approval', async () => {
    const f = setup();
    expect(await f.guard.authorizeTool(f.call(name, input), 'output')).toBe(false);
    expect(f.approve).toHaveBeenCalledOnce();
    expect(f.approve.mock.calls[0][0].targets).toEqual([
      { nodeId: 11, name: '/docs/a.txt', write: false, descendants: false },
      { nodeId: 20, name: '/secret', write: true, descendants: false },
    ]);
    await f.guard.authorizeResource(11, false, 'output', false);
    await f.guard.authorizeResource(20, true, 'output', false);
    expect(await f.guard.canAutoApproveTool(f.call(name, input), 'output')).toBe(false);
  });
  it('does not expand source or destination access even in full-access mode or after an opaque grant', async () => {
    const f = setup('full-access');
    await f.guard.authorizeTool(f.call(name, input), 'output'); f.guard.grantApprovedTool('output');
    for (const [nodeId, write] of [[11, true], [20, false], [21, false], [10, true]] as const) {
      await expect(f.guard.authorizeResource(nodeId, write, 'output', false)).rejects.toThrow('冻结范围');
    }
    await expect(f.guard.authorizeDirectory('/secret', true, 'output', false)).rejects.toThrow('目录访问');
    expect(await f.guard.canAutoApproveTool(f.call(name, input), 'output')).toBe(false);
    expect(f.approve).not.toHaveBeenCalled();
  });
  it('rejects a source directory, target file, cross-library node and later target substitution', async () => {
    const f = setup();
    await expect(f.guard.authorizeTool(f.call(name, { ...input, resource: { nodeId: 10 } }), 'dir-source')).rejects.toThrow('普通文件');
    await expect(f.guard.authorizeTool(f.call(name, { ...input, destination: { parentId: 21 } }), 'file-target')).rejects.toThrow('普通目录');
    await f.guard.authorizeTool(f.call(name, input), 'output');
    await expect(f.guard.authorizeTool(f.call(name, { ...input, destination: { parentId: 10 } }), 'output')).rejects.toThrow('已变化');
    f.nodes.set(20, { ...f.nodes.get(20)!, libraryId: 4 });
    await expect(f.guard.authorizeOutput(11, 20, 'output', false)).rejects.toThrow('当前资料库');
  });
  it('rechecks ancestry and does not permit directory enumeration through metadata', async () => {
    const f = setup(); await f.guard.authorizeTool(f.call(name, input), 'output');
    await expect(f.guard.authorizeQuery({ kind: 'list', directoryId: 20 }, false, 'output')).rejects.toThrow('已冻结');
    await expect(f.guard.checkMetadata({ libraryId: 3, node: f.nodes.get(21)! }, 'output')).rejects.toThrow('超出范围');
    f.nodes.set(20, { ...f.nodes.get(20)!, parentId: 30 });
    await expect(f.guard.authorizeOutput(11, 20, 'output', false)).rejects.toThrow('授权已变化');
  });
});

import { describe, expect, it } from 'vitest';
import { fileDeleteTool } from './file-delete-tool';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { assessAgentToolPermission, resolveAgentRunPermissionDecision } from '../agent-permission-gate';

const node = { id: 9, libraryId: 3, parentId: 8, name: 'report', ext: 'txt', type: 'file' as const, path: '/docs/report.txt' };
const context = () => ({ appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
  perception: { knownNodes: [node], selectedNodes: [], collectedAt: '2026-09-10' }, signal: new AbortController().signal, onProgress: () => undefined });

describe('file.delete tool', () => {
  it('binds an observed node to the execution and uses the frozen permission mode', async () => {
    const ctx = context();
    const decision = await assessAgentToolPermission(fileDeleteTool, { nodeId: 9 }, ctx);
    expect(decision).toMatchObject({ behavior: 'ask', preview: { title: '移入回收站' } });
    expect(fileDeleteTool.createRendererRequest?.({ nodeId: 9 }, ctx)).toMatchObject({ nodeId: 9, libraryId: 3, parentId: 8, path: node.path, recursive: false });
    expect(resolveAgentRunPermissionDecision('file.delete', decision, 'full-access')).toEqual({ behavior: 'allow', risk: 'write' });
    expect(resolveAgentRunPermissionDecision('file.delete', decision, 'auto')).toBe(decision);
  });
  it('rejects guessed IDs, roots, cross-library nodes and implicit recursive deletion', async () => {
    expect(await assessAgentToolPermission(fileDeleteTool, { nodeId: 99 }, context())).toMatchObject({ behavior: 'deny' });
    for (const changed of [{ ...node, libraryId: 4 }, { ...node, parentId: 0 }, { ...node, type: 'dir' as const }]) {
      const ctx = { ...context(), perception: { ...context().perception, knownNodes: [changed] } };
      expect(await assessAgentToolPermission(fileDeleteTool, { nodeId: 9 }, ctx)).toMatchObject({ behavior: 'deny' });
    }
    const ctx = { ...context(), perception: { ...context().perception, knownNodes: [{ ...node, type: 'dir' as const }] } };
    expect(await assessAgentToolPermission(fileDeleteTool, { nodeId: 9, recursive: true }, ctx)).toMatchObject({ behavior: 'ask' });
    const registry = createAgentToolRegistry([fileDeleteTool]);
    expect(registry.validateInput('file.delete', { nodeId: 9, permanent: true }).ok).toBe(false);
  });
});

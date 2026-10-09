import { describe, expect, it } from 'vitest';
import { updatePerceptionAfterLibraryMutation } from './agent-orchestrator';
import { nodeConfigureTool } from './tools/node-configure-tool';
import type { AgentToolExecutionContext } from './agent-tool-registry';

const perception = {
  selectedNodes: [{ id: 1, libraryId: 3, parentId: 9, name: 'one', type: 'file' as const }],
  currentDirectory: { id: 9, name: 'docs', entries: [], entryCount: 0 },
  knownNodes: [
    { id: 1, libraryId: 3, parentId: 9, name: 'one', type: 'file' as const },
    { id: 2, libraryId: 3, parentId: 9, name: 'two', type: 'file' as const },
  ],
  collectedAt: '2026-09-12T00:00:00.000Z',
};

describe('updatePerceptionAfterLibraryMutation', () => {
  it('keeps other confirmed nodes after deleting one node', () => {
    const next = updatePerceptionAfterLibraryMutation(perception, 'file.delete', 1);
    expect(next.knownNodes?.map(node => node.id)).toEqual([2]);
    expect(next.selectedNodes).toEqual([]);
    expect(next.currentDirectory).toBeUndefined();
  });

  it('keeps the existing mutation behavior for non-delete operations', () => {
    const next = updatePerceptionAfterLibraryMutation(perception, 'file.rename', 1);
    expect(next.knownNodes?.map(node => node.id)).toEqual([1]);
    expect(next.selectedNodes).toEqual([]);
    expect(next.currentDirectory).toBeUndefined();
  });

  it('does not bind a second directory configuration to the pre-commit version', () => {
    const stale = { id: 9, libraryId: 3, parentId: 8, path: '/works', name: 'works', type: 'dir' as const,
      builtInType: 'COMIC' as const, archiveMode: 0 as const, updatedAt: '2026-10-01T00:00:00.123456Z' };
    const context: AgentToolExecutionContext = {
      appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
      perception: { ...perception, knownNodes: [stale, perception.knownNodes[1]] },
    };
    expect(nodeConfigureTool.createRendererRequest?.({ nodeId: 9, archiveMode: 1 }, context)).toHaveProperty('observedSource', stale);
    context.perception = updatePerceptionAfterLibraryMutation(context.perception!, 'node.configure', 9);
    expect(context.perception.knownNodes?.map(node => node.id)).toEqual([2]);
    expect(nodeConfigureTool.createRendererRequest?.({ nodeId: 9, builtInType: 'GALLERY' }, context)).not.toHaveProperty('observedSource');
  });
});

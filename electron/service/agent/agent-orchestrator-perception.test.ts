import { describe, expect, it } from 'vitest';
import { updatePerceptionAfterLibraryMutation } from './agent-orchestrator';

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
});

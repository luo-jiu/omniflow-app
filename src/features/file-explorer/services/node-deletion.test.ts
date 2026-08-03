import { describe, expect, it, vi } from 'vitest';
import { createNodeDeletionService } from './node-deletion';

function createDependencies() {
  return {
    clearRecycleBin: vi.fn(async () => 2),
    deleteNodeAndChildren: vi.fn(async () => true),
    discardDrafts: vi.fn(async () => undefined),
    getAllDescendantsByNodeId: vi.fn(async (nodeId: number) => [
      { id: nodeId },
      { id: nodeId + 1 },
    ]),
    hardDeleteNodeAndChildren: vi.fn(async () => true),
    reportCollectionFailure: vi.fn(),
    reportDraftCleanupFailure: vi.fn(),
  };
}

describe('Node deletion service', () => {
  it('deletes the backend subtree before invalidating every matching draft writer', async () => {
    const dependencies = createDependencies();
    const service = createNodeDeletionService(dependencies);

    const result = await service.softDeleteNodeSubtree({
      accountScope: 'user:1',
      ancestorId: 8,
      libraryId: 3,
    });

    expect(result).toEqual({
      deletedNodeIds: [8, 9],
      draftCleanupFailed: false,
      subtreeCollectionFailed: false,
    });
    expect(dependencies.deleteNodeAndChildren).toHaveBeenCalledWith(8, 3);
    expect(dependencies.discardDrafts).toHaveBeenCalledWith([
      expect.objectContaining({ resourceIdentity: 'node:8' }),
      expect.objectContaining({ resourceIdentity: 'node:9' }),
    ]);
    expect(dependencies.deleteNodeAndChildren.mock.invocationCallOrder[0])
      .toBeLessThan(dependencies.discardDrafts.mock.invocationCallOrder[0]);
  });

  it('does not discard drafts when the backend deletion fails', async () => {
    const dependencies = createDependencies();
    dependencies.deleteNodeAndChildren.mockRejectedValueOnce(new Error('delete failed'));
    const service = createNodeDeletionService(dependencies);

    await expect(service.softDeleteNodeSubtree({
      accountScope: 'user:1',
      ancestorId: 8,
      libraryId: 3,
    })).rejects.toThrow('delete failed');
    expect(dependencies.discardDrafts).not.toHaveBeenCalled();
  });

  it('keeps a successful deletion result while surfacing local cleanup failure', async () => {
    const dependencies = createDependencies();
    dependencies.discardDrafts.mockRejectedValueOnce(new Error('storage failed'));
    const service = createNodeDeletionService(dependencies);

    const result = await service.softDeleteNodeSubtree({
      accountScope: 'user:1',
      ancestorId: 8,
      libraryId: 3,
    });

    expect(result.draftCleanupFailed).toBe(true);
    expect(dependencies.reportDraftCleanupFailure).toHaveBeenCalledOnce();
  });

  it('still deletes a live subtree when descendant collection fails', async () => {
    const dependencies = createDependencies();
    dependencies.getAllDescendantsByNodeId.mockRejectedValueOnce(new Error('not visible'));
    const service = createNodeDeletionService(dependencies);

    const result = await service.softDeleteNodeSubtree({
      accountScope: 'user:1',
      ancestorId: 8,
      libraryId: 3,
    });

    expect(result).toMatchObject({
      deletedNodeIds: [8],
      draftCleanupFailed: false,
      subtreeCollectionFailed: true,
    });
    expect(dependencies.deleteNodeAndChildren).toHaveBeenCalledWith(8, 3);
    expect(dependencies.discardDrafts).toHaveBeenCalledWith([
      expect.objectContaining({ resourceIdentity: 'node:8' }),
    ]);
  });

  it('marks recycle-bin cleanup incomplete when known descendants are missing', async () => {
    const dependencies = createDependencies();
    dependencies.getAllDescendantsByNodeId.mockResolvedValueOnce([]);
    const service = createNodeDeletionService(dependencies);

    const result = await service.hardDeleteNodeSubtree({
      accountScope: 'user:1',
      ancestorId: 8,
      expectedDescendantCount: 2,
      libraryId: 3,
    });

    expect(result).toMatchObject({
      deletedNodeIds: [8],
      draftCleanupFailed: false,
      subtreeCollectionFailed: true,
    });
    expect(dependencies.hardDeleteNodeAndChildren).toHaveBeenCalledWith(8, 3);
  });

  it('falls back to known recycle-bin roots when deleted descendants cannot be listed', async () => {
    const dependencies = createDependencies();
    dependencies.getAllDescendantsByNodeId.mockRejectedValue(new Error('not visible'));
    const service = createNodeDeletionService(dependencies);

    const result = await service.clearRecycleBinWithViewerCleanup({
      accountScope: 'user:1',
      items: [
        { id: 8, deletedDescendantCount: 1 },
        { id: 12, deletedDescendantCount: 2 },
      ],
      libraryId: 3,
    });

    expect(result).toMatchObject({
      clearedCount: 2,
      deletedNodeIds: [8, 12],
      draftCleanupFailed: false,
      subtreeCollectionFailed: true,
    });
    expect(dependencies.clearRecycleBin).toHaveBeenCalledWith(3);
    expect(dependencies.discardDrafts).toHaveBeenCalledWith([
      expect.objectContaining({ resourceIdentity: 'node:8' }),
      expect.objectContaining({ resourceIdentity: 'node:12' }),
    ]);
  });
});

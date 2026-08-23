import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchNodeDetailById: vi.fn(),
  getChildrenByNodeId: vi.fn(),
}));

vi.mock('@/features/file-explorer/services/file.api', () => mocks);

import { readAgentPerception } from './agent-context.api';

describe('readAgentPerception', () => {
  beforeEach(() => {
    mocks.fetchNodeDetailById.mockReset();
    mocks.getChildrenByNodeId.mockReset();
  });

  it('reads and normalizes the current directory and selected nodes', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue([
      { id: 3, name: 'zeta.txt', type: 'file', file_size: 20 },
      { id: 2, name: '媒体', type: 'dir' },
      { id: 'invalid', name: '忽略', type: 'file' },
    ]);
    mocks.fetchNodeDetailById
      .mockResolvedValueOnce({ id: 8, name: 'movie.mp4', type: 'file', mimeType: 'video/mp4' })
      .mockRejectedValueOnce(new Error('not found'));

    const result = await readAgentPerception({
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin',
      selectedNodeIds: [8, 9],
    });

    expect(mocks.getChildrenByNodeId).toHaveBeenCalledWith(10, 3);
    expect(mocks.fetchNodeDetailById).toHaveBeenCalledTimes(2);
    expect(result.currentDirectory?.entries).toEqual([
      { id: 2, name: '媒体', type: 'dir' },
      { fileSize: 20, id: 3, name: 'zeta.txt', type: 'file' },
    ]);
    expect(result.currentDirectory?.entryCount).toBe(2);
    expect(result.selectedNodes).toEqual([
      { id: 8, mimeType: 'video/mp4', name: 'movie.mp4', type: 'file' },
    ]);
    expect(result.collectedAt).toEqual(expect.any(String));
  });

  it('does not call the directory endpoint without a complete directory context', async () => {
    mocks.fetchNodeDetailById.mockResolvedValue({ id: 8, name: 'note.txt', type: 'file' });

    const result = await readAgentPerception({
      libraryId: 3,
      platform: 'darwin',
      selectedNodeIds: [8],
    });

    expect(mocks.getChildrenByNodeId).not.toHaveBeenCalled();
    expect(result.currentDirectory).toBeUndefined();
    expect(result.selectedNodes).toEqual([
      { id: 8, name: 'note.txt', type: 'file' },
    ]);
  });
});

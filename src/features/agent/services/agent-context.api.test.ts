import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchNodeDetailById: vi.fn(),
  getChildrenByNodeId: vi.fn(),
}));

vi.mock('@/features/file-explorer/services/file.api', () => mocks);

import { readAgentPerception } from './agent-context.api';

describe('readAgentPerception', () => {
  it('includes only safe storage identity and availability, deduplicating node probes', async () => {
    const node = { id: 8, name: 'video.mp4', type: 'file', storageProvider: 'win', storageProviderLabel: 'Win', secretKey: 'private' };
    mocks.getChildrenByNodeId.mockResolvedValue([node]);
    mocks.fetchNodeDetailById.mockResolvedValue(node);
    const checkStorage = vi.fn(async () => ({ available: false, status: 'error' as const, message: 'private endpoint' }));
    const result = await readAgentPerception({ currentDirectory: { id: 10, name: 'fixture' }, libraryId: 3, platform: 'darwin', selectedNodeIds: [8] }, { checkStorage });
    expect(result.selectedNodes[0].storage).toMatchObject({ providerAlias: 'win', providerLabel: 'Win', availability: 'unavailable' });
    expect(checkStorage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('preserves the directory total and marks a bounded snapshot incomplete', async () => {
    mocks.getChildrenByNodeId.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({
      id: index + 1000, name: `file-${index}`, type: 'file',
    })));
    const result = await readAgentPerception({ currentDirectory: { id: 99, name: 'fixture' }, libraryId: 3, platform: 'darwin', selectedNodeIds: [] });
    expect(result.currentDirectory).toMatchObject({ entryCount: 201, truncated: true });
    expect(result.currentDirectory?.entries).toHaveLength(200);
  });
  beforeEach(() => {
    mocks.fetchNodeDetailById.mockReset().mockResolvedValue(null);
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
    expect(mocks.fetchNodeDetailById).toHaveBeenCalledTimes(3);
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

  it('exposes actual resource configuration in directory, entries and selection without inferring old-server defaults', async () => {
    const folder = { id: 8, name: '漫画', type: 'dir', builtInType: 'COMIC', archiveMode: 1 };
    mocks.getChildrenByNodeId.mockResolvedValue([folder, { id: 9, name: 'unknown', type: 'dir' }]);
    mocks.fetchNodeDetailById.mockImplementation(async id => id === 8 ? folder : { id: 10, libraryId: 3, name: 'ASMR', type: 'dir', builtInType: 'ASMR', archiveMode: 1 });
    const result = await readAgentPerception({ libraryId: 3, currentDirectory: { id: 10, name: 'ASMR' }, platform: 'darwin', selectedNodeIds: [8] });
    expect(result.currentDirectory).toMatchObject({ builtInType: 'ASMR', archiveMode: 1 });
    expect(result.selectedNodes[0]).toMatchObject({ builtInType: 'COMIC', archiveMode: 1 });
    expect(result.currentDirectory?.entries.find(item => item.id === 8)).toMatchObject({ builtInType: 'COMIC', archiveMode: 1 });
    expect(result.currentDirectory?.entries.find(item => item.id === 9)).not.toHaveProperty('builtInType');
  });
});

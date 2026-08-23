import { describe, expect, it, vi } from 'vitest';

import { fileListTool, fileStatTool } from './file-read-tools';

function context() {
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [8],
    },
    onProgress: vi.fn(),
    perception: {
      collectedAt: new Date().toISOString(),
      currentDirectory: {
        entries: [
          { id: 2, name: '片段', type: 'dir' as const },
          { fileSize: 20, id: 8, name: 'movie.mp4', type: 'file' as const },
        ],
        entryCount: 2,
        id: 10,
        name: '视频',
      },
      selectedNodes: [
        { fileSize: 20, id: 8, mimeType: 'video/mp4', name: 'movie.mp4', type: 'file' as const },
      ],
    },
    signal: new AbortController().signal,
  };
}

describe('Agent read tools', () => {
  it('lists only the perceived current directory', async () => {
    const executionContext = context();
    const result = await fileListTool.execute!({}, executionContext);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ entryCount: 2 });
    expect(executionContext.onProgress).toHaveBeenCalledWith({ message: '正在读取 视频' });

    await expect(fileListTool.execute!({ directoryId: 11 }, executionContext))
      .resolves.toMatchObject({ ok: false });
  });

  it('stats selected or visible nodes and rejects unknown nodes', async () => {
    const executionContext = context();
    await expect(fileStatTool.execute!({}, executionContext)).resolves.toMatchObject({
      data: { id: 8, mimeType: 'video/mp4' },
      ok: true,
    });
    await expect(fileStatTool.execute!({ nodeId: 2 }, executionContext)).resolves.toMatchObject({
      data: { id: 2, type: 'dir' },
      ok: true,
    });
    await expect(fileStatTool.execute!({ nodeId: 999 }, executionContext)).resolves.toMatchObject({
      ok: false,
    });
  });
});

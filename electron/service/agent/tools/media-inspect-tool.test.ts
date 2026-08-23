import { describe, expect, it } from 'vitest';

import { assessAgentToolPermission } from '../agent-permission-gate';
import { mediaInspectTool } from './media-inspect-tool';

function context(selectedNodeIds: number[] = [8]) {
  const entries = [
    { ext: 'mp4', id: 8, mimeType: 'video/mp4', name: 'movie', type: 'file' as const },
    { id: 9, name: '归档', type: 'dir' as const },
  ];
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds,
    },
    onProgress: () => undefined,
    perception: {
      collectedAt: '2026-08-23T00:00:00.000Z',
      currentDirectory: { entries, entryCount: entries.length, id: 10, name: '视频' },
      selectedNodes: entries.filter(node => selectedNodeIds.includes(node.id)),
    },
    signal: new AbortController().signal,
  };
}

describe('media.inspect tool', () => {
  it('automatically allows one visible file and creates a URL-free renderer request', async () => {
    await expect(assessAgentToolPermission(mediaInspectTool, {}, context())).resolves.toEqual({
      behavior: 'allow',
      risk: 'read',
    });

    expect(mediaInspectTool.createRendererRequest?.({}, context())).toEqual({
      fileName: 'movie.mp4',
      libraryId: 3,
      mimeType: 'video/mp4',
      nodeId: 8,
    });
  });

  it('rejects directories and nodes outside the current perception', async () => {
    await expect(assessAgentToolPermission(mediaInspectTool, { nodeId: 9 }, context([])))
      .resolves.toMatchObject({ behavior: 'deny', message: expect.stringContaining('单个文件') });
    await expect(assessAgentToolPermission(mediaInspectTool, { nodeId: 99 }, context([])))
      .resolves.toMatchObject({ behavior: 'deny', message: expect.stringContaining('感知范围') });
  });
});

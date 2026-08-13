import { describe, expect, it } from 'vitest';
import type { FileViewerTab } from './file-viewer.context';
import { updateExistingFileViewerTabResource } from './file-viewer-tab-resource';

function createTab(id: string, nodeId: number): FileViewerTab {
  return {
    id,
    libraryId: 3,
    nodeId,
    fileUrl: `old://${nodeId}`,
    fileName: `${nodeId}.txt`,
    fileType: 'text',
    loading: false,
    contentRevision: 'sha256:old',
  };
}

describe('File viewer tab resource updates', () => {
  it('updates only the requested existing tab', () => {
    const first = createTab('node:8', 8);
    const second = createTab('node:9', 9);
    const result = updateExistingFileViewerTabResource([first, second], first.id, {
      contentRevision: 'sha256:new',
      expectedNodeId: 8,
      fileUrl: 'new://8',
    });

    expect(result?.tabs).toEqual([
      { ...first, fileUrl: 'new://8', contentRevision: 'sha256:new' },
      second,
    ]);
    expect(result?.updatedTab.id).toBe(first.id);
  });

  it('does not recreate a closed tab or update a replaced resource', () => {
    const tab = createTab('node:9', 9);
    expect(updateExistingFileViewerTabResource([tab], 'node:8', {
      contentRevision: 'sha256:new',
      expectedNodeId: 8,
      fileUrl: 'new://8',
    })).toBeNull();
    expect(updateExistingFileViewerTabResource([tab], tab.id, {
      contentRevision: 'sha256:new',
      expectedNodeId: 8,
      fileUrl: 'new://8',
    })).toBeNull();
  });
});

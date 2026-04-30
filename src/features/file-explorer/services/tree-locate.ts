export const TREE_LOCATE_NODE_EVENT = 'omniflow:tree-locate-node';
export const TREE_REFRESH_DIRECTORY_EVENT = 'omniflow:tree-refresh-directory';

export interface TreeLocateNodeDetail {
  libraryId: number;
  nodeId: number;
}

export interface TreeRefreshDirectoryDetail {
  directoryNodeId: number;
}

export function locateNodeInDirectoryTree(detail: TreeLocateNodeDetail) {
  if (!Number.isFinite(detail.libraryId) || !Number.isFinite(detail.nodeId)) {
    return;
  }
  window.dispatchEvent(new CustomEvent<TreeLocateNodeDetail>(TREE_LOCATE_NODE_EVENT, {
    detail: {
      libraryId: Number(detail.libraryId),
      nodeId: Number(detail.nodeId),
    },
  }));
}

export function refreshDirectoryInTree(directoryNodeId: number) {
  if (!Number.isFinite(directoryNodeId) || directoryNodeId <= 0) {
    return;
  }
  window.dispatchEvent(new CustomEvent<TreeRefreshDirectoryDetail>(TREE_REFRESH_DIRECTORY_EVENT, {
    detail: { directoryNodeId },
  }));
}


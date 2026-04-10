export const TREE_LOCATE_NODE_EVENT = 'omniflow:tree-locate-node';

export interface TreeLocateNodeDetail {
  libraryId: number;
  nodeId: number;
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


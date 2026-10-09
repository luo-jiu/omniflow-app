import { findNodeById } from './tree-node';

export type ExternalUploadResolution = {
  blockedReason: 'archive' | null;
  targetKey: string | null;
  targetNode: any | null;
};

export function resolveExternalUpload(node: any | null, treeData: any[]): ExternalUploadResolution {
  const finalize = (targetNode: any | null, blockedReason: 'archive' | null): ExternalUploadResolution => ({
    blockedReason,
    targetKey: targetNode?.key ? String(targetNode.key) : null,
    targetNode,
  });

  if (!node) {
    return finalize(null, null);
  }

  if (String(node.type) === 'dir') {
    if (Number(node.archiveMode ?? 0) === 1) {
      return finalize(null, 'archive');
    }
    return finalize(node, null);
  }

  let parentId = Number(node.parentId || 0);
  const visited = new Set<number>();
  while (Number.isFinite(parentId) && parentId > 0 && !visited.has(parentId)) {
    visited.add(parentId);
    const parentNode = findNodeById(treeData, parentId);
    if (!parentNode) {
      break;
    }
    if (String(parentNode.type) === 'dir') {
      if (Number(parentNode.archiveMode ?? 0) === 1) {
        return finalize(null, 'archive');
      }
      return finalize(parentNode, null);
    }
    parentId = Number(parentNode.parentId || 0);
  }

  return finalize(null, null);
}

export function resolveVisibleTreeNodeAtPoint(
  clientX: number,
  clientY: number,
  container: HTMLElement | null,
  visibleNodesByKey: ReadonlyMap<string, any>,
): any | null {
  if (!container || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const bounds = container.getBoundingClientRect();
  if (clientX < bounds.left || clientX >= bounds.right || clientY < bounds.top || clientY >= bounds.bottom) {
    return null;
  }

  // Semi Tree can finish expanding after its parent's layout effect. Hit the
  // currently painted row instead of caching bounds before that child update.
  const hit = container.ownerDocument.elementFromPoint(clientX, clientY);
  if (!hit || !container.contains(hit)) return null;
  const option = hit.closest('.semi-tree-option');
  if (!option || !container.contains(option)) return null;
  const label = option.querySelector<HTMLElement>('.tree-node-label[data-node-key]');
  const nodeKey = label?.dataset.nodeKey;
  return nodeKey ? visibleNodesByKey.get(nodeKey) ?? null : null;
}

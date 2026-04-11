import { findNodeById } from './tree-node';

export type ExternalUploadResolution = {
  blockedReason: 'archive' | null;
  targetKey: string | null;
  targetNode: any | null;
};

export type VisibleRowBounds = {
  bottom: number;
  node: any;
  top: number;
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

export function computeVisibleRowBounds(
  visibleNodes: any[],
  rowRefs: Map<string, { option: HTMLElement | null }>,
  container: HTMLElement | null,
): VisibleRowBounds[] {
  if (!container) {
    return [];
  }

  const containerRect = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;

  return visibleNodes.flatMap((node) => {
    const nodeKey = String(node?.key || '');
    const option = nodeKey ? rowRefs.get(nodeKey)?.option : null;
    if (!option) {
      return [];
    }
    const rect = option.getBoundingClientRect();
    return [{
      node,
      top: rect.top - containerRect.top + scrollTop,
      bottom: rect.bottom - containerRect.top + scrollTop,
    }];
  });
}

export function resolveVisibleTreeNodeByClientY(
  clientY: number,
  container: HTMLElement | null,
  visibleRows: VisibleRowBounds[],
): any | null {
  if (!container || visibleRows.length === 0) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const localY = clientY - containerRect.top + container.scrollTop;

  for (const row of visibleRows) {
    if (localY >= row.top && localY <= row.bottom) {
      return row.node;
    }
  }

  for (let index = 0; index < visibleRows.length - 1; index += 1) {
    const current = visibleRows[index];
    const next = visibleRows[index + 1];
    if (localY > current.bottom && localY < next.top) {
      return current.node;
    }
  }

  const first = visibleRows[0];
  if (localY < first.top) {
    return first.node;
  }

  return visibleRows[visibleRows.length - 1]?.node ?? null;
}

export interface TreeSelectionNode {
  id: number;
  key: string;
}

export interface ResolveTreeSelectionOptions {
  visibleNodes: TreeSelectionNode[];
  targetKey: string;
  anchorKey: string | null;
  selectedNodeIds: number[];
  withRange: boolean;
  withToggle: boolean;
}

export interface ResolvedTreeSelection {
  selectedNodeIds: number[];
  anchorKey: string | null;
}

/**
 * Resolve a file-tree click without depending on the component event source.
 * The caller can use the same result for label, icon, and row clicks.
 */
export function resolveTreeSelection({
  visibleNodes,
  targetKey,
  anchorKey,
  selectedNodeIds,
  withRange,
  withToggle,
}: ResolveTreeSelectionOptions): ResolvedTreeSelection | null {
  const targetIndex = visibleNodes.findIndex(node => String(node.key) === targetKey);
  if (targetIndex < 0) {
    return null;
  }

  const targetNodeId = Number(visibleNodes[targetIndex]?.id);
  if (!Number.isFinite(targetNodeId) || targetNodeId <= 0) {
    return null;
  }

  const anchorIndex = anchorKey
    ? visibleNodes.findIndex(node => String(node.key) === anchorKey)
    : -1;

  if (withRange && anchorIndex >= 0) {
    const [start, end] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const rangeIds = visibleNodes
      .slice(start, end + 1)
      .map(node => Number(node.id))
      .filter(id => Number.isFinite(id) && id > 0);

    return {
      selectedNodeIds: withToggle
        ? Array.from(new Set([...selectedNodeIds, ...rangeIds]))
        : rangeIds,
      anchorKey,
    };
  }

  if (withRange) {
    return {
      selectedNodeIds: [targetNodeId],
      anchorKey: targetKey || null,
    };
  }

  if (withToggle) {
    return {
      selectedNodeIds: selectedNodeIds.includes(targetNodeId)
        ? selectedNodeIds.filter(id => id !== targetNodeId)
        : [...selectedNodeIds, targetNodeId],
      anchorKey: anchorKey || targetKey || null,
    };
  }

  return {
    selectedNodeIds: [targetNodeId],
    anchorKey: targetKey || null,
  };
}

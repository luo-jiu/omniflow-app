import { describe, expect, it } from 'vitest';
import { resolveTreeSelection, type TreeSelectionNode } from './tree-selection';

const visibleNodes: TreeSelectionNode[] = [
  { id: 1, key: 'root:1' },
  { id: 2, key: 'root:2' },
  { id: 3, key: 'root:3' },
  { id: 4, key: 'root:4' },
];

describe('resolveTreeSelection', () => {
  it('selects a range in either direction and includes both endpoints', () => {
    expect(resolveTreeSelection({
      visibleNodes,
      targetKey: 'root:4',
      anchorKey: 'root:2',
      selectedNodeIds: [2],
      withRange: true,
      withToggle: false,
    })).toEqual({ selectedNodeIds: [2, 3, 4], anchorKey: 'root:2' });

    expect(resolveTreeSelection({
      visibleNodes,
      targetKey: 'root:1',
      anchorKey: 'root:3',
      selectedNodeIds: [3],
      withRange: true,
      withToggle: false,
    })).toEqual({ selectedNodeIds: [1, 2, 3], anchorKey: 'root:3' });
  });

  it('clears an existing range on a plain click and moves the anchor', () => {
    expect(resolveTreeSelection({
      visibleNodes,
      targetKey: 'root:4',
      anchorKey: 'root:1',
      selectedNodeIds: [1, 2, 3],
      withRange: false,
      withToggle: false,
    })).toEqual({ selectedNodeIds: [4], anchorKey: 'root:4' });
  });

  it('toggles a node while preserving the first anchor', () => {
    expect(resolveTreeSelection({
      visibleNodes,
      targetKey: 'root:3',
      anchorKey: 'root:1',
      selectedNodeIds: [1, 3],
      withRange: false,
      withToggle: true,
    })).toEqual({ selectedNodeIds: [1], anchorKey: 'root:1' });
  });

  it('falls back to a single selection when Shift has no visible anchor', () => {
    expect(resolveTreeSelection({
      visibleNodes,
      targetKey: 'root:2',
      anchorKey: 'root:hidden',
      selectedNodeIds: [1, 3],
      withRange: true,
      withToggle: false,
    })).toEqual({ selectedNodeIds: [2], anchorKey: 'root:2' });
  });
});

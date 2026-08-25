import { describe, expect, it } from 'vitest';
import { buildNodeLogicalPath } from './tree-node';

const nestedTree = [
  {
    id: 11,
    parentId: 1,
    data: { rawName: '文档' },
    children: [
      {
        id: 12,
        parentId: 11,
        data: { rawName: '提示词' },
        children: [],
      },
    ],
  },
];

describe('buildNodeLogicalPath', () => {
  it('uses a slash for the repository root', () => {
    expect(buildNodeLogicalPath(nestedTree, { id: 1, data: { rawName: 'root' } }, 1)).toBe('/');
  });

  it('builds a slash-prefixed path from the loaded ancestor chain', () => {
    expect(buildNodeLogicalPath(nestedTree, nestedTree[0].children[0], 1)).toBe('/文档/提示词');
  });

  it('keeps the known target name when an ancestor is not loaded', () => {
    expect(buildNodeLogicalPath([], { id: 12, parentId: 11, label: '提示词' }, 1)).toBe('/提示词');
  });
});

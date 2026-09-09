import { describe, expect, it } from 'vitest';
import { mergeNodesPreservingLoadedState } from './tree-utils';
import type { Node } from './types';

const file: Node = { id: 3, parentId: 2, libraryId: 3, name: 'old', type: 'file', key: '2:3', label: 'old', isLeaf: true };
const inner: Node = { id: 2, parentId: 1, libraryId: 3, name: 'inner', type: 'dir', key: '1:2', label: 'inner', isLeaf: false, loaded: true, children: [file] };
const outer: Node = { ...inner, id: 1, parentId: 0, key: '0:1', name: 'outer', children: [inner] };

describe('refreshed tree child caches', () => {
  it('invalidates a collapsed loaded branch so its next expansion fetches new files', () => {
    const result = mergeNodesPreservingLoadedState([inner], [{ ...inner, loaded: false, children: undefined }], new Set());
    expect(result[0].loaded).toBe(false);
    expect(result[0].children).toBeUndefined();
    expect(inner.children).toEqual([file]);
  });
  it('keeps expanded branches but invalidates their collapsed descendants', () => {
    const result = mergeNodesPreservingLoadedState([outer], [{ ...outer, children: undefined }], new Set(['0:1']));
    expect(result[0].loaded).toBe(true);
    expect(result[0].children?.[0]).toMatchObject({ loaded: false, children: undefined });
  });
  it('preserves normal snapshot restoration when no refresh visibility policy is supplied', () => {
    expect(mergeNodesPreservingLoadedState([outer], [{ ...outer, children: undefined }])[0].children).toBe(outer.children);
  });
});

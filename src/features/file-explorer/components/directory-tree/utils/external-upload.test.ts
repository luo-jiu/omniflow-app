import { describe, expect, it, vi } from 'vitest';
import { resolveExternalUpload, resolveVisibleTreeNodeAtPoint } from './external-upload';

function scene() {
  const song = { id: 41, key: 'song', type: 'dir', parentId: 4 };
  const other = { id: 7, key: 'other', type: 'dir' };
  const visibleNodes = new Map<string, any>([['song', song], ['other', other]]);
  const owned = new Set<object>();
  const makeRow = (key: string) => {
    const label = { dataset: { nodeKey: key } };
    const option = { querySelector: () => label };
    const text = { closest: () => option };
    owned.add(option);
    owned.add(text);
    return { option, text };
  };
  const songRow = makeRow('song');
  const otherRow = makeRow('other');
  let hit: object | null = songRow.text;
  const elementFromPoint = vi.fn(() => hit);
  const container = {
    getBoundingClientRect: () => ({ left: 10, right: 350, top: 72, bottom: 600 }),
    ownerDocument: { elementFromPoint },
    contains: (element: object) => owned.has(element),
  } as unknown as HTMLElement;
  const resolve = (x = 100, y = 258) => resolveVisibleTreeNodeAtPoint(x, y, container, visibleNodes);
  return { song, other, songRow, otherRow, visibleNodes, owned, container, elementFromPoint, resolve, setHit: (next: object | null) => { hit = next; } };
}

describe('external upload uses the currently painted tree row', () => {
  it('follows a late child render after expansion instead of selecting the former row at that position', () => {
    const view = scene();
    view.setHit(view.otherRow.text);
    expect(view.resolve()).toBe(view.other);
    // Semi Tree renders the newly expanded child after its parent's layout effect.
    view.setHit(view.songRow.text);
    expect(view.resolve()).toBe(view.song);
  });

  it('remeasures the actual hit when rows move during scroll or resize', () => {
    const view = scene();
    expect(view.resolve(100, 300)).toBe(view.song);
    view.setHit(view.otherRow.text);
    expect(view.resolve(100, 300)).toBe(view.other);
    expect(view.elementFromPoint).toHaveBeenLastCalledWith(100, 300);
  });

  it.each([[9, 258], [350, 258], [100, 71], [100, 600], [NaN, 258], [100, Infinity]])(
    'rejects points outside the viewport or invalid coordinates (%s, %s)', (x, y) => {
      const view = scene();
      expect(view.resolve(x, y)).toBeNull();
      expect(view.elementFromPoint).not.toHaveBeenCalled();
    },
  );

  it('clears the target for gaps, empty space, overlays and the area outside the tree', () => {
    const view = scene();
    const gap = { closest: () => null };
    view.owned.add(gap);
    view.setHit(gap);
    expect(view.resolve()).toBeNull();
    view.setHit(null);
    expect(view.resolve()).toBeNull();
    view.setHit({ closest: () => view.songRow.option });
    expect(view.resolve()).toBeNull();
  });

  it('rejects stale nodes that remain in the DOM while collapsing', () => {
    const view = scene();
    view.visibleNodes.delete('song');
    expect(view.resolve()).toBeNull();
  });

  it('uses the same current hit for hover and a later drop after the tree changed', () => {
    const view = scene();
    const tree = [view.song, view.other];
    const hover = resolveExternalUpload(view.resolve(), tree);
    expect(hover.targetKey).toBe('song');
    view.setHit(view.otherRow.text);
    const drop = resolveExternalUpload(view.resolve(), tree);
    expect(drop.targetNode).toBe(view.other);
  });

  it('preserves file-to-parent resolution and the archive upload restriction', () => {
    const view = scene();
    const file = { id: 42, key: 'file', type: 'file', parentId: view.song.id };
    expect(resolveExternalUpload(file, [{ ...view.song, children: [file] }]).targetNode?.id).toBe(view.song.id);
    expect(resolveExternalUpload({ ...view.song, archiveMode: 1 }, [view.song])).toEqual({
      blockedReason: 'archive', targetKey: null, targetNode: null,
    });
  });
});

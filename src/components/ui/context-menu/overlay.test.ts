import { describe, expect, it } from 'vitest';

import { resolveOverlayPlacement, type OverlayBoundaryRect } from './overlay';

const VIEWPORT: OverlayBoundaryRect = {
  bottom: 800,
  left: 0,
  right: 1200,
  top: 0,
};

function createRect({
  bottom,
  left,
  right,
  top,
}: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    toJSON: () => ({}),
    top,
    width: right - left,
    x: left,
    y: top,
  };
}

describe('resolveOverlayPlacement', () => {
  it('顶部对齐的侧边菜单在下方空间充足时向下展开', () => {
    expect(resolveOverlayPlacement(createRect({
      bottom: 140,
      left: 500,
      right: 700,
      top: 100,
    }), {
      boundaryRect: VIEWPORT,
      popupHeight: 240,
      popupWidth: 280,
      preferredHorizontal: 'left',
      preferredVertical: 'top',
    })).toBe('leftTop');
  });

  it('靠近底部时改为底部对齐并向上展开', () => {
    expect(resolveOverlayPlacement(createRect({
      bottom: 740,
      left: 500,
      right: 700,
      top: 700,
    }), {
      boundaryRect: VIEWPORT,
      popupHeight: 240,
      popupWidth: 280,
      preferredHorizontal: 'left',
      preferredVertical: 'top',
    })).toBe('leftBottom');
  });

  it('首选侧空间不足时切换到另一侧', () => {
    expect(resolveOverlayPlacement(createRect({
      bottom: 140,
      left: 120,
      right: 320,
      top: 100,
    }), {
      boundaryRect: VIEWPORT,
      popupHeight: 240,
      popupWidth: 280,
      preferredHorizontal: 'left',
      preferredVertical: 'top',
    })).toBe('rightTop');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveModelPickerPlacement } from './model-picker-placement';

const viewport = { width: 1200, height: 800 };

function bounds(anchor: { left: number; right: number; top: number; bottom: number }, view = viewport, overlay?: typeof anchor) {
  const placement = resolveModelPickerPlacement(anchor, view, overlay);
  const left = (anchor.left + anchor.right - placement.width) / 2 + placement.spacingX;
  return { ...placement, left, right: left + placement.width };
}

describe('model picker overlay placement', () => {
  it('aligns the popup center with the trigger center when there is room', () => {
    expect(bounds({ left: 500, right: 620, top: 600, bottom: 630 })).toMatchObject({ position: 'top', spacingX: 0, left: 432, right: 688 });
    expect(bounds({ left: 850, right: 1000, top: 600, bottom: 630 })).toMatchObject({ position: 'top', spacingX: 0, left: 797, right: 1053 });
  });

  it('shifts only enough to keep either edge inside the 12px inset', () => {
    expect(bounds({ left: 40, right: 160, top: 600, bottom: 630 })).toMatchObject({ position: 'top', spacingX: 40, left: 12, right: 268 });
    expect(bounds({ left: 1, right: 121, top: 600, bottom: 630 })).toMatchObject({ spacingX: 79, left: 12 });
    expect(bounds({ left: 1080, right: 1198, top: 600, bottom: 630 })).toMatchObject({ spacingX: -79, right: 1188 });
  });

  it('shrinks and clamps in a narrow viewport even when neither alignment fits', () => {
    expect(bounds({ left: 90, right: 210, top: 400, bottom: 430 }, { width: 240, height: 600 })).toMatchObject({ width: 216, spacingX: -30, left: 12, right: 228 });
  });

  it('uses the real portal clipping boundary while allowing overlays across a wide sidebar', () => {
    const anchor = { left: 560, right: 680, top: 600, bottom: 630 };
    expect(bounds(anchor)).toMatchObject({ spacingX: 0, left: 492, right: 748 });
    expect(bounds(anchor, viewport, { left: 600, right: 1100, top: 100, bottom: 750 })).toMatchObject({ spacingX: 120, left: 612, right: 868, maxHeight: 480 });
  });

  it('chooses the larger vertical side and limits list growth to the available height', () => {
    expect(bounds({ left: 40, right: 160, top: 20, bottom: 50 })).toMatchObject({ position: 'bottom', maxHeight: 730 });
    expect(bounds({ left: 40, right: 160, top: 400, bottom: 430 })).toMatchObject({ position: 'top', maxHeight: 380 });
  });
});

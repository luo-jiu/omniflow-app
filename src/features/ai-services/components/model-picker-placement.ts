type Rect = { left: number; right: number; top: number; bottom: number };

export interface ModelPickerPlacement {
  position: 'top' | 'bottom';
  spacingX: number;
  width: number;
  maxHeight: number;
}

/** The popup lives in the app overlay, so its boundary is the overlay/viewport intersection. */
export function resolveModelPickerPlacement(anchor: Rect, viewport: { width: number; height: number }, overlay?: Rect): ModelPickerPlacement {
  const left = Math.max(0, overlay?.left ?? 0) + 12;
  const right = Math.min(viewport.width, overlay?.right ?? viewport.width) - 12;
  const top = Math.max(0, overlay?.top ?? 0) + 12;
  const bottom = Math.min(viewport.height, overlay?.bottom ?? viewport.height) - 12;
  const width = Math.max(1, Math.min(256, right - left));
  const preferredLeft = (anchor.left + anchor.right - width) / 2;
  const clampedLeft = Math.max(left, Math.min(right - width, preferredLeft));
  const above = Math.max(0, anchor.top - top - 8);
  const below = Math.max(0, bottom - anchor.bottom - 8);
  // Choosing the larger side independently of the active view prevents settings/list flips.
  const openAbove = above >= below;
  return {
    position: openAbove ? 'top' : 'bottom',
    spacingX: clampedLeft - preferredLeft,
    width,
    maxHeight: openAbove ? above : below,
  };
}

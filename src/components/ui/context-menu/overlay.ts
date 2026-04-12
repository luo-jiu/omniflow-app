export type ContextMenuPosition =
  | 'leftTop'
  | 'leftBottom'
  | 'rightTop'
  | 'rightBottom'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export type OverlayBoundaryRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type OverlayPlacementOptions = {
  popupHeight?: number;
  popupWidth?: number;
  preferredHorizontal?: 'left' | 'right';
  preferredVertical?: 'bottom' | 'top';
  boundaryRect?: OverlayBoundaryRect | null;
};

const DEFAULT_POPUP_WIDTH = 280;
const DEFAULT_POPUP_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

export function resolveOverlayPlacement(
  triggerRect: DOMRect,
  options?: OverlayPlacementOptions,
): ContextMenuPosition {
  const popupWidth = options?.popupWidth ?? DEFAULT_POPUP_WIDTH;
  const popupHeight = options?.popupHeight ?? DEFAULT_POPUP_HEIGHT;
  const preferredHorizontal = options?.preferredHorizontal ?? 'right';
  const preferredVertical = options?.preferredVertical ?? 'top';
  const boundaryRect = options?.boundaryRect;

  const boundaryLeft = boundaryRect?.left ?? 0;
  const boundaryRight = boundaryRect?.right ?? window.innerWidth;
  const boundaryTop = boundaryRect?.top ?? 0;
  const boundaryBottom = boundaryRect?.bottom ?? window.innerHeight;

  const spaceLeft = triggerRect.left - boundaryLeft - VIEWPORT_MARGIN;
  const spaceRight = boundaryRight - triggerRect.right - VIEWPORT_MARGIN;
  const spaceTop = triggerRect.top - boundaryTop - VIEWPORT_MARGIN;
  const spaceBottom = boundaryBottom - triggerRect.bottom - VIEWPORT_MARGIN;

  const horizontal = preferredHorizontal === 'right'
    ? (spaceRight >= popupWidth ? 'right' : 'left')
    : (spaceLeft >= popupWidth ? 'left' : 'right');

  const vertical = preferredVertical === 'bottom'
    ? (spaceBottom >= popupHeight ? 'Bottom' : 'Top')
    : (spaceTop >= popupHeight ? 'Top' : 'Bottom');

  return `${horizontal}${vertical}` as ContextMenuPosition;
}

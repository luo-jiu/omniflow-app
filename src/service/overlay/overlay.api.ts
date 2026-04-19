import type { OverlayPropsMap, OverlayResultMap, OverlayType } from './types';

function assertDesktopSupport() {
  if (!window.electronOverlay) {
    throw new Error('当前环境不支持 overlay 弹框');
  }
}

export async function openOverlay<T extends OverlayType>(
  type: T,
  props: OverlayPropsMap[T],
): Promise<OverlayResultMap[T]> {
  assertDesktopSupport();
  return window.electronOverlay.open<OverlayResultMap[T]>(type, props);
}

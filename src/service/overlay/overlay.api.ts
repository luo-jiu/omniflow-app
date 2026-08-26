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

export type OverlaySession<T extends OverlayType> = {
  result: Promise<OverlayResultMap[T]>;
  updateProps: (props: OverlayPropsMap[T]) => Promise<boolean>;
};

export function openOverlaySession<T extends OverlayType>(
  type: T,
  props: OverlayPropsMap[T],
): OverlaySession<T> {
  assertDesktopSupport();
  const requestId = globalThis.crypto.randomUUID();
  return {
    result: window.electronOverlay.open<OverlayResultMap[T]>(type, props, requestId),
    updateProps: (nextProps) => window.electronOverlay.update(requestId, nextProps),
  };
}

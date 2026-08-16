export interface MirroredSpectrumBar {
  bandRatio: number;
  primaryIndex: number;
  mirroredIndex: number;
}

export function clearUnusedSpectrumHeights(
  heights: Float32Array,
  activeCount: number,
): void {
  const start = Math.min(Math.max(Math.floor(activeCount), 0), heights.length);
  heights.fill(0, start);
}

function smoothstep(start: number, end: number, value: number): number {
  const progress = Math.min(Math.max((value - start) / (end - start), 0), 1);
  return progress * progress * (3 - 2 * progress);
}

export function resolveSpectrumOpacity(position: number): number {
  const ratio = Math.min(Math.max(position, 0), 1);
  return 0.4 + Math.sin(Math.PI * ratio) * 0.6;
}

export function resolveSpectrumWaveHeight(position: number): number {
  const ratio = Math.min(Math.max(position, 0), 1);
  const left = smoothstep(0, 0.25, ratio);
  const right = 1 - smoothstep(0.75, 1, ratio);
  return left * right;
}

export function resolveMirroredSpectrumBar(
  sourceIndex: number,
  sourceBarCount: number,
  totalBarCount: number,
): MirroredSpectrumBar {
  const safeSourceBarCount = Math.max(Math.floor(sourceBarCount), 1);
  const safeTotalBarCount = Math.max(Math.floor(totalBarCount), safeSourceBarCount);
  const safeSourceIndex = Math.min(
    Math.max(Math.floor(sourceIndex), 0),
    safeSourceBarCount - 1,
  );

  return {
    bandRatio: safeSourceBarCount === 1
      ? 0
      : safeSourceIndex / (safeSourceBarCount - 1),
    primaryIndex: safeSourceIndex,
    mirroredIndex: safeTotalBarCount - 1 - safeSourceIndex,
  };
}

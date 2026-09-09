const MAXIMUM_BAR_HEIGHT_RATIO = 0.26;
const BAR_HEIGHT_CURVE_EXPONENT = 1.35;

export function resolveSpectrumBarHeightRatio(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const normalizedLevel = Math.min(level, 1);
  return Math.pow(normalizedLevel, BAR_HEIGHT_CURVE_EXPONENT) * MAXIMUM_BAR_HEIGHT_RATIO;
}

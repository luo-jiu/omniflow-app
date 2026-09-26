export const INDEX_TICK_HEIGHT = 10;
export const INDEX_BASE_WIDTH = 6;
export const INDEX_PEAK_WIDTH = 20;
export const INDEX_WAVE_RADIUS = 4;

export function indexWaveStrength(index: number, center: number | null): number {
  return center === null ? 0 : Math.max(0, 1 - Math.abs(index - center) / INDEX_WAVE_RADIUS);
}

export function indexWaveCenter(activeIndex: number, elapsed: number): number | null {
  if (activeIndex < 0) return null;
  const travelMs = (activeIndex + INDEX_WAVE_RADIUS * 2) * 140;
  const phase = elapsed % (travelMs + 800);
  return phase >= travelMs ? null : activeIndex + INDEX_WAVE_RADIUS - phase / 140;
}

export function indexWaveSpread(strength: number, distance: number): number {
  if (strength <= 0 || distance <= 0) return 0;
  const reach = 1 + strength * 3;
  return Math.max(0, 1 - distance / reach) * strength * 0.7;
}

export function indexWaveColors(baseColors: Array<string | null>, center: number | null): Array<string> {
  const colors = baseColors.map(color => color || 'var(--dial-muted, var(--app-text-muted))');
  if (center === null) return colors;
  const influence = new Array<number>(colors.length).fill(0);
  // Only sources touched by the traveling wave can radiate to their neighbors.
  for (let source = Math.max(0, Math.floor(center - INDEX_WAVE_RADIUS)); source <= Math.min(colors.length - 1, Math.ceil(center + INDEX_WAVE_RADIUS)); source += 1) {
    const color = baseColors[source];
    if (!color) continue;
    const strength = indexWaveStrength(source, center);
    for (let target = Math.max(0, source - 3); target <= Math.min(colors.length - 1, source + 3); target += 1) {
      if (baseColors[target]) continue;
      const amount = indexWaveSpread(strength, Math.abs(target - source));
      if (amount <= influence[target]) continue;
      influence[target] = amount;
      colors[target] = `color-mix(in srgb, ${color} ${(amount * 100).toFixed(2)}%, var(--dial-muted, var(--app-text-muted)))`;
    }
  }
  return colors;
}

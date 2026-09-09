import { describe, expect, it } from 'vitest';
import { resolveSpectrumBarHeightRatio } from './audio-spectrum-level';

describe('resolveSpectrumBarHeightRatio', () => {
  it('keeps decoded full-scale FFT values within the compact visual range', () => {
    expect(resolveSpectrumBarHeightRatio(1)).toBeCloseTo(0.26);
    expect(resolveSpectrumBarHeightRatio(2)).toBeCloseTo(0.26);
  });

  it('compresses ordinary decoded levels without flattening their movement', () => {
    const quiet = resolveSpectrumBarHeightRatio(0.25);
    const medium = resolveSpectrumBarHeightRatio(0.5);
    const loud = resolveSpectrumBarHeightRatio(0.75);

    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(medium);
    expect(medium).toBeGreaterThan(0.09);
    expect(medium).toBeLessThan(0.11);
    expect(medium).toBeLessThan(loud);
    expect(loud).toBeLessThan(0.18);
  });

  it('drops invalid and silent inputs to zero', () => {
    expect(resolveSpectrumBarHeightRatio(0)).toBe(0);
    expect(resolveSpectrumBarHeightRatio(-1)).toBe(0);
    expect(resolveSpectrumBarHeightRatio(Number.NaN)).toBe(0);
  });
});

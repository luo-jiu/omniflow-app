import { describe, expect, it } from 'vitest';
import {
  clearUnusedSpectrumHeights,
  resolveMirroredSpectrumBar,
  resolveSpectrumOpacity,
  resolveSpectrumWaveHeight,
} from './audio-spectrum-mirror';

describe('resolveMirroredSpectrumBar', () => {
  it('clears heights outside the active responsive bar range', () => {
    const heights = new Float32Array([1, 0.8, 0.6, 0.4]);

    clearUnusedSpectrumHeights(heights, 2);

    expect(heights[0]).toBe(1);
    expect(heights[1]).toBeCloseTo(0.8);
    expect(heights[2]).toBe(0);
    expect(heights[3]).toBe(0);
  });

  it('maps an eighty-percent spectrum to mirrored overlapping positions', () => {
    expect(resolveMirroredSpectrumBar(0, 8, 10)).toEqual({
      bandRatio: 0,
      primaryIndex: 0,
      mirroredIndex: 9,
    });
    expect(resolveMirroredSpectrumBar(2, 8, 10)).toEqual({
      bandRatio: 2 / 7,
      primaryIndex: 2,
      mirroredIndex: 7,
    });
    expect(resolveMirroredSpectrumBar(7, 8, 10)).toEqual({
      bandRatio: 1,
      primaryIndex: 7,
      mirroredIndex: 2,
    });
  });

  it('uses one smooth forty-to-hundred-to-forty opacity curve for both layers', () => {
    expect(resolveSpectrumOpacity(0)).toBeCloseTo(0.4);
    expect(resolveSpectrumOpacity(0.25)).toBeGreaterThan(0.8);
    expect(resolveSpectrumOpacity(0.5)).toBeCloseTo(1);
    expect(resolveSpectrumOpacity(0.75)).toBeCloseTo(resolveSpectrumOpacity(0.25));
    expect(resolveSpectrumOpacity(1)).toBeCloseTo(0.4);
  });

  it('tapers each individual waveform to zero at both of its own endpoints', () => {
    expect(resolveSpectrumWaveHeight(0)).toBe(0);
    expect(resolveSpectrumWaveHeight(0.125)).toBeGreaterThan(0);
    expect(resolveSpectrumWaveHeight(0.125)).toBeLessThan(1);
    expect(resolveSpectrumWaveHeight(0.25)).toBe(1);
    expect(resolveSpectrumWaveHeight(0.5)).toBe(1);
    expect(resolveSpectrumWaveHeight(0.75)).toBe(1);
    expect(resolveSpectrumWaveHeight(0.875)).toBeCloseTo(resolveSpectrumWaveHeight(0.125));
    expect(resolveSpectrumWaveHeight(1)).toBe(0);
  });
});

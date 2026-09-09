import { describe, expect, it } from 'vitest';
import { indexWaveCenter, indexWaveColors, indexWaveSpread, indexWaveStrength } from './agent-index-wave';

describe('Index traveling wave', () => {
  it('uses a fixed peak and neighbor profile, even at a clipped edge', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => indexWaveStrength(i, 4)))
      .toEqual([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]);
    expect([0, 1, 2].map(i => indexWaveStrength(i, 0))).toEqual([1, 0.75, 0.5]);
    expect(indexWaveStrength(0, null)).toBe(0);
  });
  it('travels upwards from the active node, then rests before the next wave', () => {
    expect(indexWaveCenter(9, 0)).toBe(13);
    expect(indexWaveCenter(9, 560)).toBe(9);
    expect(indexWaveCenter(9, 700)).toBe(8);
    expect(indexWaveCenter(9, 2400)).toBeNull();
    expect(indexWaveCenter(-1, 500)).toBeNull();
  });
  it('tints only neighboring strokes, preserves source colors, and restores them after passage', () => {
    const source = [null, null, null, 'green', null, null, null];
    const early = indexWaveColors(source, 6);
    expect(early[3]).toBe('green');
    expect(early[2]).toContain('green');
    expect(early[1]).toBe('var(--app-text-muted)');
    const peak = indexWaveColors(source, 3);
    expect(peak[0]).toContain('green');
    expect(peak[3]).toBe('green');
    expect(peak[6]).toContain('green');
    expect(indexWaveSpread(1, 1)).toBeGreaterThan(indexWaveSpread(1, 2));
    expect(indexWaveSpread(1, 2)).toBeGreaterThan(indexWaveSpread(1, 3));
    expect(indexWaveColors(source, -5)).toEqual(source.map(color => color || 'var(--app-text-muted)'));
    expect(indexWaveColors([null, 'red', 'green'], 2)[1]).toBe('red');
  });
});

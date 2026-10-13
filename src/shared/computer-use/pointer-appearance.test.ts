import { describe, expect, it } from 'vitest';
import { COMPUTER_POINTER_FALLBACK_ACCENT, resolveComputerPointerAccent } from './pointer-appearance';

describe('pointer theme color projection', () => {
  it.each([
    ['#1Af', '#11aaff'], ['#1Af8', '#11aaff'], ['#A1B2C3', '#a1b2c3'], ['#A1B2C344', '#a1b2c3'],
    ['rgb(0, 25, 255)', '#0019ff'], ['rgba(0, 25, 255, 0.08)', '#0019ff'],
  ])('keeps the hue of the supported theme color %s', (input, expected) => {
    expect(resolveComputerPointerAccent(input)).toBe(expected);
  });
  it.each([undefined, 'transparent', '#1230', '#12345600', 'rgba(0,0,0,0)', 'rgb(256,0,0)',
    'rgba(0,0,0,1.2)', 'var(--color)', 'url(https://invalid.test)', '#fff;display:none'])('uses a visible fallback for %s', input => {
    expect(resolveComputerPointerAccent(input)).toBe(COMPUTER_POINTER_FALLBACK_ACCENT);
  });
});

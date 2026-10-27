import { describe, expect, it } from 'vitest';
import { createReasoningStars, reasoningParticleLayers, writeFastReasoningStars, writeReasoningStars } from './reasoning-starfield-model';

describe('ordinary maximum reasoning stars', () => {
  it('keeps all fourteen slow stars near their anchors instead of traversing the track', () => {
    const stars = createReasoningStars();
    const values = new Float32Array(56);
    expect(stars).toHaveLength(14);
    for (let time = 0; time < 60; time += 0.1) {
      writeReasoningStars(stars, time, 230, 24, values);
      stars.forEach((star, index) => {
        expect(Math.abs(values[index * 4] - star.anchor * 230)).toBeLessThanOrEqual(4.0001);
        expect(values[index * 4 + 1]).toBeGreaterThanOrEqual(5);
        expect(values[index * 4 + 1]).toBeLessThanOrEqual(19);
        expect(values[index * 4 + 2]).toBeGreaterThanOrEqual(0.75);
        expect(values[index * 4 + 2]).toBeLessThanOrEqual(1.425);
        expect(star.duration).toBeGreaterThanOrEqual(1.28);
        expect(star.duration).toBeLessThanOrEqual(3.2);
      });
    }
  });

  it('moves continuously across target changes and scales vertical positions with the track', () => {
    const stars = createReasoningStars();
    const before = new Float32Array(56);
    const after = new Float32Array(56);
    const transition = stars[0].duration;
    writeReasoningStars(stars, transition - .001, 230, 24, before);
    writeReasoningStars(stars, transition + .001, 230, 24, after);
    expect(Math.abs(before[0] - after[0])).toBeLessThan(.01);
    expect(Math.abs(before[1] - after[1])).toBeLessThan(.01);
    writeReasoningStars(stars, transition + .001, 230, 48, before);
    expect(before[1]).toBeCloseTo(after[1] * 2);
    writeReasoningStars(stars, transition + .6, 230, 24, before);
    expect([...before]).not.toEqual([...after]);
  });
});

describe('Fast particle motion is separate from ordinary stars', () => {
  it('moves fourteen round dots right to left at constant speed, with 1.58–2.375 second traversals', () => {
    const before = new Float32Array(56);
    const middle = new Float32Array(56);
    const after = new Float32Array(56);
    writeFastReasoningStars(2.1, 230, 24, 100, before);
    writeFastReasoningStars(2.11, 230, 24, 100, middle);
    writeFastReasoningStars(2.12, 230, 24, 100, after);
    for (let index = 0; index < 14; index++) {
      const step = before[index * 4] - middle[index * 4];
      expect(step).toBeGreaterThan(230 / 2.375 * .01 - .001);
      expect(step).toBeLessThan(230 / (1.9 / 1.2) * .01 + .001);
      expect(middle[index * 4] - after[index * 4]).toBeCloseTo(step, 3);
      expect(before[index * 4 + 1]).toBeGreaterThanOrEqual(24 * .12);
      expect(before[index * 4 + 1]).toBeLessThanOrEqual(24 * .88);
    }
  });

  it('keeps upstream phase timing distinct from particle exit and return durations', () => {
    const entering = { enabled: true, changedAt: 0 };
    expect(reasoningParticleLayers(entering, .1, true)).toMatchObject({ phase: 'entering', ordinaryOpacity: 1 });
    expect(reasoningParticleLayers(entering, .1, true).ordinaryOffset).toBeCloseTo(0);
    expect(reasoningParticleLayers(entering, 1.2, true).phase).toBe('active');
    expect(reasoningParticleLayers(entering, 1.6, true)).toMatchObject({ ordinaryOffset: -110, ordinaryOpacity: 0, fastOpacity: 1 });
    const exiting = { enabled: false, changedAt: 2 };
    expect(reasoningParticleLayers(exiting, 2, true)).toMatchObject({ phase: 'exiting', ordinaryOffset: 28, ordinaryOpacity: 0 });
    expect(reasoningParticleLayers(exiting, 2.36, true).phase).toBe('inactive');
    expect(reasoningParticleLayers(exiting, 2.56, true)).toMatchObject({ ordinaryOffset: 0, ordinaryOpacity: 1, fastOpacity: 0 });
    expect(reasoningParticleLayers(exiting, 2.3, false)).toMatchObject({ ordinaryOpacity: 0, fastOpacity: 0 });
    const partial = reasoningParticleLayers(entering, .12, true).fastOpacity;
    expect(reasoningParticleLayers({ enabled: false, changedAt: .12, fastOpacityFrom: partial }, .12, true).fastOpacity).toBe(partial);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createAudioDockProgressGeometry,
  getAudioDockProgressPoint,
  getAudioDockProgressRatio,
} from './audio-dock-progress-geometry';

describe('audio dock upper border geometry', () => {
  it('includes both complete upper quarter circles in its progress length', () => {
    const geometry = createAudioDockProgressGeometry(600, 76)!;
    expect(geometry.length).toBeCloseTo(552 + Math.PI * 22.5);
    expect(getAudioDockProgressPoint(geometry, 0)).toEqual({ x: 1.5, y: 24 });
    expect(getAudioDockProgressPoint(geometry, 0.5)).toEqual({ x: 300, y: 1.5 });
    const end = getAudioDockProgressPoint(geometry, 1);
    expect(end.x).toBe(598.5);
    expect(end.y).toBeCloseTo(24);
    const leftArcEnd = getAudioDockProgressPoint(geometry, geometry.arcLength / geometry.length);
    expect(leftArcEnd).toEqual({ x: 24, y: 1.5 });
  });

  it.each([96, 280, 600, 900])('maps border clicks by traveled distance at width %d', width => {
    const geometry = createAudioDockProgressGeometry(width, 76)!;
    const halfArcRatio = geometry.arcLength / geometry.length / 2;
    for (const ratio of [0, halfArcRatio, 0.25, 0.5, 0.75, 1 - halfArcRatio, 1]) {
      const point = getAudioDockProgressPoint(geometry, ratio);
      expect(getAudioDockProgressRatio(geometry, point.x, point.y)).toBeCloseTo(ratio, 10);
    }
    const leftArcMid = getAudioDockProgressPoint(geometry, halfArcRatio);
    expect(leftArcMid.y).toBeGreaterThan(geometry.inset);
    expect(getAudioDockProgressRatio(geometry, leftArcMid.x, leftArcMid.y)).not.toBeCloseTo(leftArcMid.x / width, 3);
  });

  it('clamps dragging beyond the upper border and projects slightly off-path pointers', () => {
    const geometry = createAudioDockProgressGeometry(600, 76)!;
    expect(getAudioDockProgressRatio(geometry, -50, 100)).toBe(0);
    expect(getAudioDockProgressRatio(geometry, 650, 100)).toBe(1);
    expect(getAudioDockProgressRatio(geometry, 300, -50)).toBeCloseTo(0.5);
    expect(getAudioDockProgressRatio(geometry, 300, 50)).toBeCloseTo(0.5);
    const ratio = geometry.arcLength / geometry.length / 2;
    const point = getAudioDockProgressPoint(geometry, ratio);
    expect(getAudioDockProgressRatio(geometry, point.x - 3, point.y - 3)).toBeCloseTo(ratio);
  });

  it('keeps responsive corner radii circular and rejects unmeasured sizes', () => {
    expect(createAudioDockProgressGeometry(0, 76)).toBeNull();
    expect(createAudioDockProgressGeometry(500, Infinity)).toBeNull();
    const small = createAudioDockProgressGeometry(30, 20)!;
    expect(small.corner).toBe(10);
    expect(small.radius).toBe(8.5);
    expect(small.straightLength).toBe(10);
    expect(getAudioDockProgressRatio(small, 15, 1.5)).toBeCloseTo(0.5);
  });
});

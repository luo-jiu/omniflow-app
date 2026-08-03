import { describe, expect, it } from 'vitest';
import { parseImageViewerSessionSnapshot } from './image-viewer-session';

describe('Image viewer session snapshot', () => {
  it('parses zoom, pan ratios, absolute fallback and rotation', () => {
    expect(parseImageViewerSessionSnapshot({
      zoom: 2.4,
      offsetX: 120,
      offsetY: -48,
      offsetRatioX: 0.25,
      offsetRatioY: -0.1,
      rotateSteps: 5,
    })).toEqual({
      zoom: 2.4,
      offsetX: 120,
      offsetY: -48,
      offsetRatioX: 0.25,
      offsetRatioY: -0.1,
      rotateSteps: 1,
    });
  });

  it('allows absolute offsets when the capture container was not measurable', () => {
    expect(parseImageViewerSessionSnapshot({
      zoom: 1,
      offsetX: 30,
      offsetY: 40,
      offsetRatioX: null,
      offsetRatioY: null,
      rotateSteps: 0,
    })).toMatchObject({
      offsetX: 30,
      offsetY: 40,
      offsetRatioX: null,
      offsetRatioY: null,
    });
  });

  it('rejects incomplete or non-finite payloads', () => {
    expect(parseImageViewerSessionSnapshot({ zoom: 1 })).toBeNull();
    expect(parseImageViewerSessionSnapshot({
      zoom: Number.NaN,
      offsetX: 0,
      offsetY: 0,
      offsetRatioX: 0,
      offsetRatioY: 0,
      rotateSteps: 0,
    })).toBeNull();
  });
});

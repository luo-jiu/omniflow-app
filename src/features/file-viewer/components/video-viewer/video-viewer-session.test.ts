import { describe, expect, it } from 'vitest';
import { parseVideoViewerSessionSnapshot } from './video-viewer-session';

const validSnapshot = {
  currentTime: 120,
  duration: 900,
  updatedAt: '2026-08-04T00:00:00.000Z',
  playbackRate: 1.25,
  subtitleEnabled: false,
  subtitleSourceId: 'library:12',
  subtitleFontSize: 48,
  subtitleBottomOffset: 80,
  consoleOpen: true,
};

describe('Video viewer session snapshot', () => {
  it('parses playback projection and non-media UI preferences', () => {
    expect(parseVideoViewerSessionSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects incomplete or non-finite payloads', () => {
    expect(parseVideoViewerSessionSnapshot({ currentTime: 3 })).toBeNull();
    expect(parseVideoViewerSessionSnapshot({ ...validSnapshot, playbackRate: Number.NaN })).toBeNull();
  });

  it('does not return media URLs, cues, menus or DOM state', () => {
    expect(parseVideoViewerSessionSnapshot({
      ...validSnapshot,
      url: 'signed-video-url',
      subtitleCues: [{ text: 'temporary' }],
      isRatePanelOpen: true,
    })).toEqual(validSnapshot);
  });
});

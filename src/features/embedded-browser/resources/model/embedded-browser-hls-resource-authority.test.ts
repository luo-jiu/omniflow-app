import { describe, expect, it } from 'vitest';

import type { EmbeddedBrowserResourceStateSnapshot } from '../types';
import {
  resolveCapturedHlsManifestResourceId,
  resolveCapturedHlsTrackResourceIds,
} from './embedded-browser-hls-resource-authority';

const activeSnapshot: EmbeddedBrowserResourceStateSnapshot = {
  captureMode: 'network',
  incarnation: 1,
  resources: [
    {
      capturedAt: 2,
      id: 'audio-resource',
      kind: 'manifest',
      source: 'network',
      tabId: 'tab-1',
      url: 'https://media.example/audio.m3u8?token=audio',
    },
    {
      capturedAt: 1,
      id: 'video-resource',
      kind: 'manifest',
      source: 'network',
      tabId: 'tab-1',
      url: 'https://media.example/video.m3u8?token=video',
    },
  ],
  revision: 3,
  status: 'active',
  tabId: 'tab-1',
};

describe('HLS renderer resource authority resolution', () => {
  it('hls.renderer-exact-manifest-authority', () => {
    expect(resolveCapturedHlsManifestResourceId(
      activeSnapshot,
      'tab-1',
      'https://media.example/video.m3u8?token=video',
    )).toBe('video-resource');
    expect(resolveCapturedHlsManifestResourceId(
      activeSnapshot,
      'tab-1',
      'https://media.example/video.m3u8?token=other',
    )).toBeNull();
    expect(resolveCapturedHlsManifestResourceId(
      activeSnapshot,
      'other-tab',
      'https://media.example/video.m3u8?token=video',
    )).toBeNull();
    expect(resolveCapturedHlsManifestResourceId({
      incarnation: 1,
      revision: 4,
      status: 'disposed',
      tabId: 'tab-1',
    }, 'tab-1', 'https://media.example/video.m3u8?token=video')).toBeNull();
  });

  it('hls.renderer-requires-both-track-authorities', () => {
    expect(resolveCapturedHlsTrackResourceIds(activeSnapshot, {
      audioManifestUrl: 'https://media.example/audio.m3u8?token=audio',
      tabId: 'tab-1',
      videoManifestUrl: 'https://media.example/video.m3u8?token=video',
    })).toEqual({
      audioResourceId: 'audio-resource',
      videoResourceId: 'video-resource',
    });
    expect(resolveCapturedHlsTrackResourceIds(activeSnapshot, {
      audioManifestUrl: 'https://media.example/missing.m3u8',
      tabId: 'tab-1',
      videoManifestUrl: 'https://media.example/video.m3u8?token=video',
    })).toBeNull();
  });
});

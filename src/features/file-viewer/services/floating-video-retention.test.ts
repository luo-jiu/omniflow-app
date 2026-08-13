import { describe, expect, it } from 'vitest';
import type { FloatingVideoState } from './floating-video.service';
import {
  FLOATING_VIDEO_RETENTION_PIP_MASK,
  FLOATING_VIDEO_RETENTION_PLAYING_MASK,
  readOwnedFloatingVideoRetentionPinMask,
} from './floating-video-retention';

function state(overrides: Partial<FloatingVideoState> = {}): FloatingVideoState {
  return {
    visible: false,
    hostMode: 'inline',
    key: 'video:tab-1',
    libraryId: 1,
    tabId: 'tab-1',
    nodeId: 10,
    fileName: 'video.mp4',
    isPlaying: false,
    currentTime: 0,
    duration: 120,
    ...overrides,
  };
}

describe('floating video retention projection', () => {
  it('does not pin a viewer that does not own the floating video', () => {
    expect(readOwnedFloatingVideoRetentionPinMask(state({ isPlaying: true }), 'tab-2', 1)).toBe(0);
    expect(readOwnedFloatingVideoRetentionPinMask(state({ isPlaying: true }), 'tab-1', 2)).toBe(0);
  });

  it('projects playing only for the owning viewer', () => {
    expect(readOwnedFloatingVideoRetentionPinMask(state({ isPlaying: true }), 'tab-1', 1))
      .toBe(FLOATING_VIDEO_RETENTION_PLAYING_MASK);
  });

  it.each(['document-pip', 'system-window'] as const)(
    'projects %s as PiP retention',
    (hostMode) => {
      expect(readOwnedFloatingVideoRetentionPinMask(state({ hostMode }), 'tab-1', 1))
        .toBe(FLOATING_VIDEO_RETENTION_PIP_MASK);
    },
  );

  it('combines playing and PiP while ignoring the ordinary app floating host', () => {
    expect(readOwnedFloatingVideoRetentionPinMask(state({
      hostMode: 'document-pip',
      isPlaying: true,
    }), 'tab-1', 1)).toBe(
      FLOATING_VIDEO_RETENTION_PLAYING_MASK | FLOATING_VIDEO_RETENTION_PIP_MASK,
    );
    expect(readOwnedFloatingVideoRetentionPinMask(state({
      hostMode: 'app-floating',
    }), 'tab-1', 1)).toBe(0);
  });
});

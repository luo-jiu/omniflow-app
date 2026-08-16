import { describe, expect, it } from 'vitest';
import type { GlobalAudioPlayerState } from './global-audio-player';
import { isGlobalAudioOwnedBy } from './global-audio-owner';

const state: GlobalAudioPlayerState = {
  currentTime: 12,
  duration: 180,
  endedSerial: 0,
  hasStarted: true,
  isMuted: false,
  isPlaying: true,
  libraryId: 7,
  ownerKey: 'audio:node:42',
  ownerType: 'default',
  sourceNodeId: 42,
  src: 'https://storage.test/song.mp3',
  tabId: 'node:42',
  thumbnailUrl: null,
  trackName: 'song.mp3',
  volume: 0.7,
};

describe('isGlobalAudioOwnedBy', () => {
  it('requires owner key, tab, and library identity even when the URL is shared', () => {
    expect(isGlobalAudioOwnedBy(state, {
      libraryId: 7,
      ownerKey: 'audio:node:42',
      ownerType: 'default',
      tabId: 'node:42',
    })).toBe(true);
    expect(isGlobalAudioOwnedBy(state, {
      libraryId: 7,
      ownerKey: 'audio:node:42',
      ownerType: 'default',
      tabId: 'node:other',
    })).toBe(false);
    expect(isGlobalAudioOwnedBy(state, {
      libraryId: 8,
      ownerKey: 'audio:node:42',
      ownerType: 'default',
      tabId: 'node:42',
    })).toBe(false);
    expect(isGlobalAudioOwnedBy(state, {
      libraryId: null,
      ownerKey: 'audio:node:42',
      ownerType: 'default',
      tabId: 'node:42',
    })).toBe(false);
    expect(isGlobalAudioOwnedBy(state, {
      libraryId: 7,
      ownerKey: 'audio:node:42',
      ownerType: 'default',
      tabId: null,
    })).toBe(false);
  });
});

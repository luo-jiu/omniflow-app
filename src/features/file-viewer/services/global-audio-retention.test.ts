import { describe, expect, it } from 'vitest';
import { isOwnedGlobalAudioPlaying } from './global-audio-retention';

describe('global audio retention projection', () => {
  it('pins the owning tab while audio is playing', () => {
    expect(isOwnedGlobalAudioPlaying({
      tabId: 'tab-1',
      libraryId: 1,
      isPlaying: true,
    }, 'tab-1', 1)).toBe(true);
  });

  it('does not pin paused audio', () => {
    expect(isOwnedGlobalAudioPlaying({
      tabId: 'tab-1',
      libraryId: 1,
      isPlaying: false,
    }, 'tab-1', 1)).toBe(false);
  });

  it('does not pin a different tab or library', () => {
    const state = { tabId: 'tab-1', libraryId: 1, isPlaying: true };
    expect(isOwnedGlobalAudioPlaying(state, 'tab-2', 1)).toBe(false);
    expect(isOwnedGlobalAudioPlaying(state, 'tab-1', 2)).toBe(false);
  });
});

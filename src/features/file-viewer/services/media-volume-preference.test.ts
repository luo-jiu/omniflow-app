import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_VOLUME_PREFERENCE_STORAGE_KEY,
  MediaVolumePreferenceStore,
  parseMediaVolumePreference,
} from './media-volume-preference';

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe('media volume preference', () => {
  it('falls back to the stable default for missing or invalid data', () => {
    expect(parseMediaVolumePreference(null)).toEqual({
      volume: 0.7,
      muted: false,
      lastAudibleVolume: 0.7,
    });
    expect(parseMediaVolumePreference('{invalid')).toEqual({
      volume: 0.7,
      muted: false,
      lastAudibleVolume: 0.7,
    });
  });

  it('loads and clamps a persisted preference', () => {
    expect(parseMediaVolumePreference(JSON.stringify({
      volume: 2,
      muted: false,
      lastAudibleVolume: 0.45,
    }))).toEqual({
      volume: 1,
      muted: false,
      lastAudibleVolume: 0.45,
    });
  });

  it('persists volume changes and unmutes a non-zero value', () => {
    const storage = createStorage(JSON.stringify({
      volume: 0.6,
      muted: true,
      lastAudibleVolume: 0.6,
    }));
    const store = new MediaVolumePreferenceStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setVolume(0.35);

    expect(store.getState()).toEqual({
      volume: 0.35,
      muted: false,
      lastAudibleVolume: 0.35,
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      MEDIA_VOLUME_PREFERENCE_STORAGE_KEY,
      JSON.stringify(store.getState()),
    );
    expect(listener).toHaveBeenCalledWith(store.getState());
  });

  it('restores the last audible value after the slider reaches zero', () => {
    const store = new MediaVolumePreferenceStore(createStorage());
    store.setVolume(0.42);
    store.setVolume(0);

    expect(store.getState()).toEqual({
      volume: 0,
      muted: true,
      lastAudibleVolume: 0.42,
    });

    store.setMuted(false);

    expect(store.getState()).toEqual({
      volume: 0.42,
      muted: false,
      lastAudibleVolume: 0.42,
    });
  });
});

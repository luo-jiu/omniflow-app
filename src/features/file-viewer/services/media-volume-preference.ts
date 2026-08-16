export const MEDIA_VOLUME_PREFERENCE_STORAGE_KEY = 'omniflow:media-volume-preference:v1';

const DEFAULT_VOLUME = 0.7;

export interface MediaVolumePreference {
  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
}

interface MediaVolumePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type MediaVolumePreferenceListener = (preference: MediaVolumePreference) => void;

const DEFAULT_PREFERENCE: MediaVolumePreference = {
  volume: DEFAULT_VOLUME,
  muted: false,
  lastAudibleVolume: DEFAULT_VOLUME,
};

function clampVolume(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function resolveBrowserStorage(): MediaVolumePreferenceStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseMediaVolumePreference(raw: string | null): MediaVolumePreference {
  if (!raw) return { ...DEFAULT_PREFERENCE };
  try {
    const parsed = JSON.parse(raw) as Partial<MediaVolumePreference>;
    const parsedVolume = Number(parsed.volume);
    const volume = Number.isFinite(parsedVolume) ? clampVolume(parsedVolume) : DEFAULT_VOLUME;
    const parsedLastAudibleVolume = Number(parsed.lastAudibleVolume);
    const lastAudibleVolume = Number.isFinite(parsedLastAudibleVolume) && parsedLastAudibleVolume > 0
      ? clampVolume(parsedLastAudibleVolume)
      : volume > 0 ? volume : DEFAULT_VOLUME;
    return {
      volume,
      muted: Boolean(parsed.muted) || volume === 0,
      lastAudibleVolume,
    };
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export class MediaVolumePreferenceStore {
  private readonly listeners = new Set<MediaVolumePreferenceListener>();
  private preference: MediaVolumePreference;

  constructor(private readonly storage: MediaVolumePreferenceStorage | null = resolveBrowserStorage()) {
    let storedValue: string | null = null;
    try {
      storedValue = this.storage?.getItem(MEDIA_VOLUME_PREFERENCE_STORAGE_KEY) ?? null;
    } catch {
      storedValue = null;
    }
    this.preference = parseMediaVolumePreference(storedValue);
  }

  getState(): MediaVolumePreference {
    return { ...this.preference };
  }

  subscribe(listener: MediaVolumePreferenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    const volume = clampVolume(value);
    this.commit({
      volume,
      muted: volume === 0,
      lastAudibleVolume: volume > 0 ? volume : this.preference.lastAudibleVolume,
    });
  }

  setMuted(muted: boolean): void {
    if (muted) {
      this.commit({ ...this.preference, muted: true });
      return;
    }
    const volume = this.preference.volume > 0
      ? this.preference.volume
      : this.preference.lastAudibleVolume;
    this.commit({
      ...this.preference,
      volume,
      muted: false,
    });
  }

  private commit(next: MediaVolumePreference): void {
    if (
      next.volume === this.preference.volume
      && next.muted === this.preference.muted
      && next.lastAudibleVolume === this.preference.lastAudibleVolume
    ) {
      return;
    }
    this.preference = next;
    try {
      this.storage?.setItem(MEDIA_VOLUME_PREFERENCE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Playback remains functional when local storage is unavailable.
    }
    const snapshot = this.getState();
    this.listeners.forEach(listener => listener(snapshot));
  }
}

export const mediaVolumePreference = new MediaVolumePreferenceStore();

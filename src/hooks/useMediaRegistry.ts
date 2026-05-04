import { useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  MediaRegistryContext,
  type MediaEntry,
  type MediaKind,
  type MediaRegistryAPI,
  type MediaRegistryRegistration,
} from '@/contexts/media-registry.context';

export function useMediaRegistry(): MediaRegistryAPI {
  const ctx = useContext(MediaRegistryContext);
  if (!ctx) {
    throw new Error('useMediaRegistry must be used within MediaRegistryProvider');
  }
  return ctx;
}

export function useMediaEntries(): MediaEntry[] {
  const registry = useMediaRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getEntries, registry.getEntries);
}

export interface RegisterMediaEntryOptions {
  enabled: boolean;
  entryId: string;
  kind: MediaKind;
  tabId: string;
  title: string;
  isPlaying: boolean;
  currentTime?: number;
  duration?: number;
  play: () => void | Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  dismiss: () => void;
}

function normalizeMediaProgressValue(value: number | undefined) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function useRegisterMediaEntry(options: RegisterMediaEntryOptions) {
  const registry = useMediaRegistry();
  const { enabled, entryId, kind, tabId, title, isPlaying, currentTime, duration, play, pause, seek, dismiss } = options;

  const playRef = useRef(play);
  const pauseRef = useRef(pause);
  const seekRef = useRef(seek);
  const dismissRef = useRef(dismiss);
  playRef.current = play;
  pauseRef.current = pause;
  seekRef.current = seek;
  dismissRef.current = dismiss;

  const registrationRef = useRef<MediaRegistryRegistration | null>(null);
  const lastTitleRef = useRef(title);
  const lastIsPlayingRef = useRef(isPlaying);
  const lastCurrentTimeRef = useRef(normalizeMediaProgressValue(currentTime));
  const lastDurationRef = useRef(normalizeMediaProgressValue(duration));

  useEffect(() => {
    if (!enabled) {
      if (registrationRef.current) {
        registrationRef.current.unregister();
        registrationRef.current = null;
      }
      return;
    }
    registrationRef.current = registry.register({
      entryId,
      kind,
      tabId,
      title: lastTitleRef.current,
      isPlaying: lastIsPlayingRef.current,
      currentTime: lastCurrentTimeRef.current,
      duration: lastDurationRef.current,
      play: () => playRef.current(),
      pause: () => pauseRef.current(),
      seek: (time) => seekRef.current(time),
      dismiss: () => dismissRef.current(),
    });
    return () => {
      registrationRef.current?.unregister();
      registrationRef.current = null;
    };
  }, [enabled, entryId, kind, tabId, registry]);

  useEffect(() => {
    const nextCurrentTime = normalizeMediaProgressValue(currentTime);
    const nextDuration = normalizeMediaProgressValue(duration);
    lastTitleRef.current = title;
    lastIsPlayingRef.current = isPlaying;
    lastCurrentTimeRef.current = nextCurrentTime;
    lastDurationRef.current = nextDuration;
    registrationRef.current?.update({
      title,
      isPlaying,
      currentTime: nextCurrentTime,
      duration: nextDuration,
    });
  }, [title, isPlaying, currentTime, duration]);
}

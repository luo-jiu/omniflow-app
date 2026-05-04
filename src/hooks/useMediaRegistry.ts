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
  play: () => void | Promise<void>;
  pause: () => void;
}

export function useRegisterMediaEntry(options: RegisterMediaEntryOptions) {
  const registry = useMediaRegistry();
  const { enabled, entryId, kind, tabId, title, isPlaying, play, pause } = options;

  const playRef = useRef(play);
  const pauseRef = useRef(pause);
  playRef.current = play;
  pauseRef.current = pause;

  const registrationRef = useRef<MediaRegistryRegistration | null>(null);
  const lastTitleRef = useRef(title);
  const lastIsPlayingRef = useRef(isPlaying);

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
      play: () => playRef.current(),
      pause: () => pauseRef.current(),
    });
    return () => {
      registrationRef.current?.unregister();
      registrationRef.current = null;
    };
  }, [enabled, entryId, kind, tabId, registry]);

  useEffect(() => {
    lastTitleRef.current = title;
    lastIsPlayingRef.current = isPlaying;
    registrationRef.current?.update({ title, isPlaying });
  }, [title, isPlaying]);
}

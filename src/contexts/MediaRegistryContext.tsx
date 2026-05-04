import React, { ReactNode, useMemo } from 'react';
import {
  MediaRegistryContext,
  type MediaEntry,
  type MediaRegistryAPI,
  type MediaRegistryRegisterInput,
  type MediaRegistryRegistration,
} from './media-registry.context';

interface MediaRegistryEntryRecord extends MediaEntry {
  play: () => void | Promise<void>;
  pause: () => void;
}

function createMediaRegistry(): MediaRegistryAPI {
  const entries = new Map<string, MediaRegistryEntryRecord>();
  const listeners = new Set<(entries: MediaEntry[]) => void>();
  let cached: MediaEntry[] = [];

  function rebuild() {
    cached = Array.from(entries.values()).map((record) => ({
      entryId: record.entryId,
      kind: record.kind,
      tabId: record.tabId,
      title: record.title,
      isPlaying: record.isPlaying,
    }));
  }

  function emit() {
    rebuild();
    listeners.forEach((listener) => listener(cached));
  }

  return {
    register(input: MediaRegistryRegisterInput): MediaRegistryRegistration {
      const record: MediaRegistryEntryRecord = {
        entryId: input.entryId,
        kind: input.kind,
        tabId: input.tabId,
        title: input.title,
        isPlaying: input.isPlaying,
        play: input.play,
        pause: input.pause,
      };
      entries.set(input.entryId, record);
      emit();
      return {
        update(patch) {
          const current = entries.get(input.entryId);
          if (!current) return;
          let changed = false;
          if (patch.title !== undefined && patch.title !== current.title) {
            current.title = patch.title;
            changed = true;
          }
          if (patch.isPlaying !== undefined && patch.isPlaying !== current.isPlaying) {
            current.isPlaying = patch.isPlaying;
            changed = true;
          }
          if (changed) emit();
        },
        unregister() {
          if (entries.delete(input.entryId)) {
            emit();
          }
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getEntries() {
      return cached;
    },
    play(entryId) {
      const record = entries.get(entryId);
      if (!record) return;
      return record.play();
    },
    pause(entryId) {
      const record = entries.get(entryId);
      if (!record) return;
      record.pause();
    },
  };
}

export const MediaRegistryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const registry = useMemo(() => createMediaRegistry(), []);
  return (
    <MediaRegistryContext.Provider value={registry}>
      {children}
    </MediaRegistryContext.Provider>
  );
};

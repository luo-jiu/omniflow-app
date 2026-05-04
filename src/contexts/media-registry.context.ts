import { createContext } from 'react';

export type MediaKind = 'audio' | 'video';

export interface MediaEntry {
  entryId: string;
  kind: MediaKind;
  tabId: string;
  title: string;
  isPlaying: boolean;
}

export interface MediaRegistryRegisterInput {
  entryId: string;
  kind: MediaKind;
  tabId: string;
  title: string;
  isPlaying: boolean;
  play: () => void | Promise<void>;
  pause: () => void;
}

export interface MediaRegistryRegistration {
  update(patch: { title?: string; isPlaying?: boolean }): void;
  unregister(): void;
}

export interface MediaRegistryAPI {
  register(input: MediaRegistryRegisterInput): MediaRegistryRegistration;
  subscribe(listener: (entries: MediaEntry[]) => void): () => void;
  getEntries(): MediaEntry[];
  play(entryId: string): void | Promise<void>;
  pause(entryId: string): void;
}

export const MediaRegistryContext = createContext<MediaRegistryAPI | undefined>(undefined);

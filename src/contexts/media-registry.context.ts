import { createContext } from 'react';

export type MediaKind = 'audio' | 'video';

export interface MediaEntry {
  entryId: string;
  kind: MediaKind;
  tabId: string;
  title: string;
  isPlaying: boolean;
  currentTime?: number;
  duration?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
}

export interface MediaRegistryRegisterInput {
  entryId: string;
  kind: MediaKind;
  tabId: string;
  title: string;
  isPlaying: boolean;
  currentTime?: number;
  duration?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  play: () => void | Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  dismiss: () => void;
}

export interface MediaRegistryRegistration {
  update(patch: {
    title?: string;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
    thumbnailUrl?: string;
    previewUrl?: string;
  }): void;
  unregister(): void;
}

export interface MediaRegistryAPI {
  register(input: MediaRegistryRegisterInput): MediaRegistryRegistration;
  subscribe(listener: (entries: MediaEntry[]) => void): () => void;
  getEntries(): MediaEntry[];
  play(entryId: string): void | Promise<void>;
  pause(entryId: string): void;
  seek(entryId: string, time: number): void;
  dismiss(entryId: string): void;
}

export const MediaRegistryContext = createContext<MediaRegistryAPI | undefined>(undefined);

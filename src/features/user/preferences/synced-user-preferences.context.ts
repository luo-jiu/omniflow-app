import { createContext } from 'react';

import type {
  SyncedUserPreference,
  UserPreferenceData,
} from './synced-user-preferences.api';

export type SaveSyncedUserPreference = <T extends UserPreferenceData>(input: {
  namespace: string;
  preferences: T;
  schemaVersion: number;
}) => Promise<SyncedUserPreference<T>>;

export type SyncedUserPreferencesContextValue = {
  entries: Readonly<Record<string, SyncedUserPreference>>;
  loading: boolean;
  savePreference: SaveSyncedUserPreference;
};

export const SyncedUserPreferencesContext = createContext<
  SyncedUserPreferencesContextValue | undefined
>(undefined);

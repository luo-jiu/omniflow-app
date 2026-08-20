import { useContext } from 'react';

import { SyncedUserPreferencesContext } from '@/features/user/preferences/synced-user-preferences.context';

export function useSyncedUserPreferences() {
  const context = useContext(SyncedUserPreferencesContext);
  if (context === undefined) {
    throw new Error('useSyncedUserPreferences must be used within SyncedUserPreferencesProvider');
  }
  return context;
}

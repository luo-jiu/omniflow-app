import React from 'react';

import { useAuth } from '@/hooks/useAuth';
import { runtimeLogger } from '@/utils/runtimeLogger';

import {
  fetchCurrentUserPreference,
  listCurrentUserPreferences,
  saveCurrentUserPreference,
  type SyncedUserPreference,
  type UserPreferenceData,
} from './synced-user-preferences.api';
import {
  SyncedUserPreferencesContext,
  type SaveSyncedUserPreference,
} from './synced-user-preferences.context';

type InternalPreference = SyncedUserPreference & {
  pendingMutation?: number;
};

function isPreferenceData(value: unknown): value is UserPreferenceData {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEntry(value: unknown): SyncedUserPreference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SyncedUserPreference>;
  if (
    typeof raw.namespace !== 'string'
    || !isPreferenceData(raw.preferences)
    || !Number.isInteger(raw.revision)
    || Number(raw.revision) <= 0
    || !Number.isInteger(raw.schemaVersion)
    || Number(raw.schemaVersion) <= 0
  ) {
    return null;
  }
  return {
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    namespace: raw.namespace,
    preferences: raw.preferences,
    revision: Number(raw.revision),
    schemaVersion: Number(raw.schemaVersion),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

function entriesFromList(rows: unknown[]): Record<string, InternalPreference> {
  const next: Record<string, InternalPreference> = {};
  rows.forEach((row) => {
    const entry = normalizeEntry(row);
    if (entry) next[entry.namespace] = entry;
  });
  return next;
}

const SyncedUserPreferencesProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user } = useAuth();
  const [entries, setEntries] = React.useState<Record<string, InternalPreference>>({});
  const [loading, setLoading] = React.useState(false);
  const entriesRef = React.useRef<Record<string, InternalPreference>>({});
  const serverEntriesRef = React.useRef<Record<string, SyncedUserPreference>>({});
  const saveQueuesRef = React.useRef(new Map<string, Promise<unknown>>());
  const loadPromiseRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const mutationSequenceRef = React.useRef(0);
  const userScopeRef = React.useRef('');
  const userScope = String(user?.id ?? user?.username ?? '').trim();

  const publishEntries = React.useCallback((next: Record<string, InternalPreference>) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  React.useEffect(() => {
    userScopeRef.current = userScope;
    saveQueuesRef.current.clear();
    serverEntriesRef.current = {};
    publishEntries({});

    if (!userScope) {
      loadPromiseRef.current = Promise.resolve();
      setLoading(false);
      return undefined;
    }

    let disposed = false;
    setLoading(true);
    const loadPromise = listCurrentUserPreferences()
      .then((rows) => {
        if (disposed || userScopeRef.current !== userScope) return;
        const next = entriesFromList(rows);
        serverEntriesRef.current = next;
        const current = entriesRef.current;
        const merged = { ...next };
        Object.values(current).forEach((entry) => {
          if (!entry.pendingMutation) return;
          merged[entry.namespace] = {
            ...entry,
            revision: next[entry.namespace]?.revision ?? 0,
          };
        });
        publishEntries(merged);
      })
      .catch((error) => {
        runtimeLogger.warn('load synced user preferences failed', error);
      })
      .finally(() => {
        if (!disposed && userScopeRef.current === userScope) setLoading(false);
      });
    loadPromiseRef.current = loadPromise;

    return () => {
      disposed = true;
    };
  }, [publishEntries, userScope]);

  const savePreference = React.useCallback<SaveSyncedUserPreference>(async (input) => {
    const scopeAtStart = userScopeRef.current;
    if (!scopeAtStart) throw new Error('当前用户未登录，无法同步偏好');

    const mutationId = mutationSequenceRef.current + 1;
    mutationSequenceRef.current = mutationId;
    const previous = entriesRef.current[input.namespace];
    const optimistic: InternalPreference = {
      createdAt: previous?.createdAt ?? '',
      namespace: input.namespace,
      pendingMutation: mutationId,
      preferences: input.preferences,
      revision: previous?.revision ?? 0,
      schemaVersion: input.schemaVersion,
      updatedAt: previous?.updatedAt ?? '',
    };
    publishEntries({
      ...entriesRef.current,
      [input.namespace]: optimistic,
    });

    const previousQueue = saveQueuesRef.current.get(input.namespace) ?? Promise.resolve();
    const saveTask = previousQueue
      .catch(() => undefined)
      .then(async () => {
        await loadPromiseRef.current.catch(() => undefined);
        if (userScopeRef.current !== scopeAtStart) {
          throw new Error('用户已切换，偏好保存已取消');
        }
        const expectedRevision = serverEntriesRef.current[input.namespace]?.revision ?? 0;
        try {
          const saved = await saveCurrentUserPreference({
            expectedRevision,
            namespace: input.namespace,
            preferences: input.preferences,
            schemaVersion: input.schemaVersion,
          });
          if (userScopeRef.current !== scopeAtStart) {
            throw new Error('用户已切换，忽略旧偏好响应');
          }
          serverEntriesRef.current = {
            ...serverEntriesRef.current,
            [input.namespace]: saved,
          };
          const latest = entriesRef.current[input.namespace];
          const nextEntry: InternalPreference = latest?.pendingMutation
            && latest.pendingMutation > mutationId
            ? {
              ...latest,
              revision: saved.revision,
              updatedAt: saved.updatedAt,
            }
            : saved;
          publishEntries({
            ...entriesRef.current,
            [input.namespace]: nextEntry,
          });
          return saved;
        } catch (error) {
          if (userScopeRef.current !== scopeAtStart) throw error;
          try {
            const current = await fetchCurrentUserPreference(input.namespace);
            if (userScopeRef.current === scopeAtStart) {
              serverEntriesRef.current = {
                ...serverEntriesRef.current,
                [input.namespace]: current,
              };
            }
          } catch (refreshError) {
            runtimeLogger.warn('refresh user preference after save failure failed', refreshError);
          }
          throw error;
        }
      });

    saveQueuesRef.current.set(input.namespace, saveTask);
    return saveTask;
  }, [publishEntries]);

  const value = React.useMemo(() => ({
    entries,
    loading,
    savePreference,
  }), [entries, loading, savePreference]);

  return (
    <SyncedUserPreferencesContext.Provider value={value}>
      {children}
    </SyncedUserPreferencesContext.Provider>
  );
};

export default SyncedUserPreferencesProvider;

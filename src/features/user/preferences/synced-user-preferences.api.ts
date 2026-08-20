import { ipcRequest as request } from '@/service/request/ipcRequest';

export type UserPreferenceData = Record<string, unknown>;

export type SyncedUserPreference<T extends UserPreferenceData = UserPreferenceData> = {
  namespace: string;
  preferences: T;
  revision: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

function unwrapData<T>(body: any): T {
  return (body?.data ?? body) as T;
}

export async function listCurrentUserPreferences(): Promise<SyncedUserPreference[]> {
  const body = await request('/v1/user/me/preferences', { method: 'GET' });
  const data = unwrapData<unknown>(body);
  return Array.isArray(data) ? data as SyncedUserPreference[] : [];
}

export async function fetchCurrentUserPreference(
  namespace: string,
): Promise<SyncedUserPreference> {
  const body = await request(`/v1/user/me/preferences/${encodeURIComponent(namespace)}`, {
    method: 'GET',
  });
  return unwrapData<SyncedUserPreference>(body);
}

export async function saveCurrentUserPreference<T extends UserPreferenceData>(input: {
  expectedRevision: number;
  namespace: string;
  preferences: T;
  schemaVersion: number;
}): Promise<SyncedUserPreference<T>> {
  const body = await request(`/v1/user/me/preferences/${encodeURIComponent(input.namespace)}`, {
    method: 'PUT',
    body: JSON.stringify({
      expectedRevision: input.expectedRevision,
      preferences: input.preferences,
      schemaVersion: input.schemaVersion,
    }),
  });
  return unwrapData<SyncedUserPreference<T>>(body);
}

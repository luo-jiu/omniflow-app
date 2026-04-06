import { ipcRequest as request } from '@/service/request/ipcRequest';

export type TagType = 'ASMR' | 'FILE_TAB' | 'COMIC' | 'GENERAL' | string;

export interface TagItem {
  id: number;
  name: string;
  type: TagType;
  targetKey?: string | null;
  ownerUserId: number | null;
  color: string;
  textColor?: string | null;
  sortOrder: number;
  enabled: number;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TagUpsertPayload {
  name: string;
  type: TagType;
  targetKey?: string | null;
  color: string;
  textColor?: string | null;
  sortOrder?: number;
  enabled?: number;
  description?: string | null;
}

export async function fetchTags(type?: TagType): Promise<TagItem[]> {
  const query = new URLSearchParams();
  if (type && String(type).trim()) {
    query.set('type', String(type).trim().toUpperCase());
  }
  const suffix = query.toString() ? `?${query}` : '';
  const body = await request(`/v1/tags${suffix}`, { method: 'GET' });
  const list = (body?.data || []) as TagItem[];
  return Array.isArray(list) ? list : [];
}

export async function createTag(payload: TagUpsertPayload): Promise<TagItem> {
  const body = await request('/v1/tags', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      type: String(payload.type || '').trim().toUpperCase(),
    }),
  });
  return body?.data as TagItem;
}

export async function updateTag(id: number, payload: TagUpsertPayload): Promise<TagItem> {
  const body = await request(`/v1/tags/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...payload,
      type: String(payload.type || '').trim().toUpperCase(),
    }),
  });
  return body?.data as TagItem;
}

export async function deleteTag(id: number): Promise<void> {
  await request(`/v1/tags/${id}`, {
    method: 'DELETE',
  });
}

import { ipcRequest as request } from '@/service/request/ipcRequest';

export type TagType = 'ASMR' | 'FILE_TAB' | 'COMIC' | 'AUDIO' | 'VIDEO' | 'FILE' | 'FOLDER' | 'GENERAL' | string;
export type TagScope = 'resource' | 'ui' | string;
export type TagDimension =
  | 'genre'
  | 'creator'
  | 'character'
  | 'series'
  | 'source'
  | 'language'
  | 'region'
  | 'technical'
  | 'status'
  | 'custom'
  | string;

export interface FetchTagsFilter {
  type?: TagType;
  scope?: TagScope;
  dimension?: TagDimension;
  resourceKind?: string;
}

export interface TagItem {
  id: number;
  name: string;
  type: TagType;
  scope?: TagScope;
  dimension?: TagDimension;
  resourceKind?: string | null;
  targetKinds?: string[];
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
  scope?: TagScope;
  dimension?: TagDimension;
  resourceKind?: string | null;
  targetKinds?: string[];
  targetKey?: string | null;
  color: string;
  textColor?: string | null;
  sortOrder?: number;
  enabled?: number;
  description?: string | null;
}

export async function fetchTags(typeOrFilter?: TagType | FetchTagsFilter): Promise<TagItem[]> {
  const filter = typeof typeOrFilter === 'object' && typeOrFilter !== null
    ? typeOrFilter
    : { type: typeOrFilter };
  const query = new URLSearchParams();
  if (filter.type && String(filter.type).trim()) {
    query.set('type', String(filter.type).trim().toUpperCase());
  }
  if (filter.scope && String(filter.scope).trim()) {
    query.set('scope', String(filter.scope).trim().toLowerCase());
  }
  if (filter.dimension && String(filter.dimension).trim()) {
    query.set('dimension', String(filter.dimension).trim().toLowerCase());
  }
  if (filter.resourceKind && String(filter.resourceKind).trim()) {
    query.set('resourceKind', String(filter.resourceKind).trim().toLowerCase());
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
      scope: payload.scope ? String(payload.scope).trim().toLowerCase() : undefined,
      dimension: payload.dimension ? String(payload.dimension).trim().toLowerCase() : undefined,
      resourceKind: payload.resourceKind ? String(payload.resourceKind).trim().toLowerCase() : null,
      targetKinds: Array.isArray(payload.targetKinds)
        ? payload.targetKinds.map(item => String(item).trim().toLowerCase()).filter(Boolean)
        : undefined,
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
      scope: payload.scope ? String(payload.scope).trim().toLowerCase() : undefined,
      dimension: payload.dimension ? String(payload.dimension).trim().toLowerCase() : undefined,
      resourceKind: payload.resourceKind ? String(payload.resourceKind).trim().toLowerCase() : null,
      targetKinds: Array.isArray(payload.targetKinds)
        ? payload.targetKinds.map(item => String(item).trim().toLowerCase()).filter(Boolean)
        : undefined,
    }),
  });
  return body?.data as TagItem;
}

export async function deleteTag(id: number): Promise<void> {
  await request(`/v1/tags/${id}`, {
    method: 'DELETE',
  });
}

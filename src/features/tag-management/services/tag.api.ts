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
  libraryId?: number | null;
  deleted?: boolean;
  legacy?: boolean;
  name: string;
  type?: TagType;
  scope?: TagScope;
  dimension?: TagDimension;
  resourceKind?: string | null;
  targetKinds?: string[];
  targetKey?: string | null;
  ownerUserId?: number | null;
  color: string;
  textColor?: string | null;
  sortOrder: number;
  enabled: number;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LibraryTagQuery {
  libraryId: number;
  keyword?: string;
  dimension?: string;
  limit?: number;
  cursor?: string;
  ids?: number[];
  nodeId?: number;
  enabled?: boolean | number;
}

export interface LibraryTagPage {
  entries: TagItem[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface LibraryTagPayload {
  name: string;
  dimension?: string;
  color: string;
  textColor?: string | null;
  description?: string | null;
  sortOrder?: number;
  enabled?: number;
}

export interface NodeTagState {
  nodeId: number;
  libraryId: number;
  parentId: number;
  tagIds: number[];
  affectedParentIds: number[];
  dryRun: boolean;
}

function assertPositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}无效`);
}

/** Each call reads one server page. Consumers must never exhaust the catalog automatically. */
export async function queryLibraryTags(input: LibraryTagQuery): Promise<LibraryTagPage> {
  assertPositiveId(input.libraryId, '资料库');
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('标签分页大小应为 1～100');
  const query = new URLSearchParams({ libraryId: String(input.libraryId), limit: String(limit) });
  if (input.keyword?.trim()) query.set('keyword', input.keyword.trim());
  if (input.dimension?.trim()) query.set('dimension', input.dimension.trim().toLowerCase());
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.enabled !== undefined) query.set('enabled', input.enabled ? '1' : '0');
  if (input.nodeId !== undefined) {
    assertPositiveId(input.nodeId, '节点');
    query.set('nodeId', String(input.nodeId));
  }
  if (input.ids !== undefined) {
    if (input.ids.length === 0) return { entries: [], hasMore: false };
    if (input.ids.length > 100) throw new Error('每次最多读取 100 个指定标签');
    input.ids.forEach(id => assertPositiveId(id, '标签 ID'));
    query.set('ids', [...new Set(input.ids)].join(','));
  }
  const body = await request(`/v1/tags?${query}`, { method: 'GET' });
  const page = body?.data as LibraryTagPage | undefined;
  if (!page || !Array.isArray(page.entries) || typeof page.hasMore !== 'boolean'
    || page.entries.length > limit || (page.hasMore && !page.nextCursor)) {
    throw new Error('后端未返回有效标签分页');
  }
  if (page.entries.some(tag => tag.libraryId !== input.libraryId)) {
    throw new Error('标签不属于当前资料库');
  }
  return page;
}

function libraryPayload(libraryId: number, payload: Partial<LibraryTagPayload>) {
  assertPositiveId(libraryId, '资料库');
  return {
    libraryId,
    name: payload.name?.trim(),
    dimension: payload.dimension === undefined ? undefined : payload.dimension.trim().toLowerCase() || 'custom',
    color: payload.color,
    textColor: payload.textColor === null ? '' : payload.textColor,
    description: payload.description === null ? '' : payload.description,
    sortOrder: payload.sortOrder,
    enabled: payload.enabled,
  };
}

export async function createLibraryTag(libraryId: number, payload: LibraryTagPayload): Promise<TagItem> {
  const body = await request('/v1/tags', { method: 'POST', body: JSON.stringify(libraryPayload(libraryId, payload)) });
  return body?.data as TagItem;
}

export async function updateLibraryTag(libraryId: number, id: number, payload: Partial<LibraryTagPayload>): Promise<TagItem> {
  assertPositiveId(id, '标签 ID');
  const body = await request(`/v1/tags/${id}`, { method: 'PUT', body: JSON.stringify(libraryPayload(libraryId, payload)) });
  return body?.data as TagItem;
}

export async function deleteLibraryTag(libraryId: number, id: number): Promise<void> {
  assertPositiveId(libraryId, '资料库');
  assertPositiveId(id, '标签 ID');
  await request(`/v1/tags/${id}?libraryId=${libraryId}`, { method: 'DELETE' });
}

function validateNodeTagState(state: NodeTagState | undefined, nodeId: number, libraryId: number): NodeTagState {
  if (!state || state.nodeId !== nodeId || state.libraryId !== libraryId || !Array.isArray(state.tagIds)
    || !state.tagIds.every(id => Number.isSafeInteger(id) && id > 0)
    || !Number.isSafeInteger(state.parentId) || state.parentId < 0
    || !Array.isArray(state.affectedParentIds) || !state.affectedParentIds.every(id => Number.isSafeInteger(id) && id > 0)
    || typeof state.dryRun !== 'boolean') {
    throw new Error('后端未返回有效节点标签回执');
  }
  return state;
}

export async function readNodeTags(nodeId: number, libraryId: number): Promise<NodeTagState> {
  assertPositiveId(libraryId, '资料库');
  assertPositiveId(nodeId, '节点');
  const body = await request(`/v1/nodes/${nodeId}/tags?libraryId=${libraryId}`, { method: 'GET' });
  const state = validateNodeTagState(body?.data, nodeId, libraryId);
  if (state.dryRun) throw new Error('后端未返回真实节点标签状态');
  return state;
}

export async function updateNodeTags(nodeId: number, input: {
  libraryId: number; addTagIds: number[]; removeTagIds: number[]; dryRun?: boolean;
}): Promise<NodeTagState> {
  assertPositiveId(input.libraryId, '资料库');
  assertPositiveId(nodeId, '节点');
  const { dryRun, ...delta } = input;
  const body = await request(`/v1/nodes/${nodeId}/tags${dryRun ? '?dryRun=true' : ''}`, {
    method: 'PATCH', body: JSON.stringify(delta),
  });
  const payload = dryRun && body?.data?.dryRun === true ? body.data.result : body?.data;
  const state = validateNodeTagState(payload, nodeId, input.libraryId);
  if (state.dryRun !== Boolean(input.dryRun)) throw new Error('后端节点标签回执的预演状态不符');
  return state;
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

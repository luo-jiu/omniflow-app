import { ipcRequest as request } from '@/service/request/ipcRequest';

export type BrowserBookmarkKind = 'url' | 'folder';

export interface BrowserBookmarkItem {
  id: number;
  ownerUserId: number;
  parentId?: number | null;
  kind: BrowserBookmarkKind;
  title: string;
  url?: string | null;
  urlMatchKey?: string | null;
  iconUrl?: string | null;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  children?: BrowserBookmarkItem[];
}

export interface BrowserBookmarkMatchResult {
  matched: boolean;
  bookmark?: BrowserBookmarkItem | null;
}

export interface CreateBrowserBookmarkPayload {
  parentId?: number | null;
  kind: BrowserBookmarkKind;
  title: string;
  url?: string | null;
  iconUrl?: string | null;
}

export interface UpdateBrowserBookmarkPayload {
  title?: string;
  url?: string;
  iconUrl?: string | null;
}

export interface MoveBrowserBookmarkPayload {
  parentId?: number | null;
  beforeId?: number | null;
  afterId?: number | null;
}

export interface BrowserBookmarkImportItem {
  kind: BrowserBookmarkKind;
  title: string;
  url?: string | null;
  iconUrl?: string | null;
  children?: BrowserBookmarkImportItem[];
}

export interface ImportBrowserBookmarksPayload {
  source?: string;
  items: BrowserBookmarkImportItem[];
}

export interface ImportBrowserBookmarksResult {
  importedCount: number;
}

export async function fetchBrowserBookmarkTree(): Promise<BrowserBookmarkItem[]> {
  const body = await request('/v1/browser-bookmarks/tree', { method: 'GET' });
  const list = body?.data;
  return Array.isArray(list) ? list as BrowserBookmarkItem[] : [];
}

export async function matchBrowserBookmark(url: string): Promise<BrowserBookmarkMatchResult> {
  const query = new URLSearchParams({ url: String(url || '').trim() });
  const body = await request(`/v1/browser-bookmarks/match?${query.toString()}`, { method: 'GET' });
  const result = body?.data as BrowserBookmarkMatchResult | undefined;
  return {
    matched: Boolean(result?.matched),
    bookmark: result?.bookmark ?? null,
  };
}

export async function createBrowserBookmark(
  payload: CreateBrowserBookmarkPayload,
): Promise<BrowserBookmarkItem> {
  const body = await request('/v1/browser-bookmarks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return body?.data as BrowserBookmarkItem;
}

export async function updateBrowserBookmark(
  id: number,
  payload: UpdateBrowserBookmarkPayload,
): Promise<BrowserBookmarkItem> {
  const body = await request(`/v1/browser-bookmarks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return body?.data as BrowserBookmarkItem;
}

export async function moveBrowserBookmark(
  id: number,
  payload: MoveBrowserBookmarkPayload,
): Promise<BrowserBookmarkItem> {
  const body = await request(`/v1/browser-bookmarks/${id}/move`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return body?.data as BrowserBookmarkItem;
}

export async function deleteBrowserBookmark(id: number): Promise<void> {
  await request(`/v1/browser-bookmarks/${id}`, { method: 'DELETE' });
}

export async function importBrowserBookmarks(
  payload: ImportBrowserBookmarksPayload,
): Promise<ImportBrowserBookmarksResult> {
  const body = await request('/v1/browser-bookmarks/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return (body?.data ?? { importedCount: 0 }) as ImportBrowserBookmarksResult;
}

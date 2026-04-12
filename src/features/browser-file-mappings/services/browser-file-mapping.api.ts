import { ipcRequest as request } from '@/service/request/ipcRequest';

export interface BrowserFileMappingItem {
  id: number;
  fileExt: string;
  siteUrl: string;
  ownerUserId: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BrowserFileMappingUpsertPayload {
  fileExt: string;
  siteUrl: string;
}

export async function fetchBrowserFileMappings(): Promise<BrowserFileMappingItem[]> {
  const body = await request('/v1/browser-file-mappings', { method: 'GET' });
  const list = body?.data;
  return Array.isArray(list) ? list as BrowserFileMappingItem[] : [];
}

export async function resolveBrowserFileMapping(fileExt: string): Promise<BrowserFileMappingItem> {
  const query = new URLSearchParams({
    fileExt: String(fileExt || '').trim(),
  });
  const body = await request(`/v1/browser-file-mappings/resolve?${query.toString()}`, {
    method: 'GET',
  });
  return body?.data as BrowserFileMappingItem;
}

export async function createBrowserFileMapping(
  payload: BrowserFileMappingUpsertPayload,
): Promise<BrowserFileMappingItem> {
  const body = await request('/v1/browser-file-mappings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return body?.data as BrowserFileMappingItem;
}

export async function updateBrowserFileMapping(
  id: number,
  payload: BrowserFileMappingUpsertPayload,
): Promise<BrowserFileMappingItem> {
  const body = await request(`/v1/browser-file-mappings/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return body?.data as BrowserFileMappingItem;
}

export async function deleteBrowserFileMapping(id: number): Promise<void> {
  await request(`/v1/browser-file-mappings/${id}`, {
    method: 'DELETE',
  });
}

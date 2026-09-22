import { PluginFault } from './resource-broker';
import type { LibraryResourceOptions } from './library-resource';
const fail = (code: string): never => { throw new PluginFault(code, 'Resource access failed'); };
export async function collect(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (size <= maximum) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maximum) fail('LIMIT'); chunks.push(value);
    }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function libraryResourceApi(options: LibraryResourceOptions) {
  const request = options.fetch ?? globalThis.fetch;
  const base = new URL(options.apiBaseUrl.replace(/\/$/, '') + '/');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) fail('BAD_REQUEST');
  if (!Number.isSafeInteger(options.nodeId) || options.nodeId < 1 || !Number.isSafeInteger(options.libraryId) || options.libraryId < 1
    || !options.token || options.token.length > 32768 || /[\r\n]/.test(options.token + options.username)) fail('BAD_REQUEST');
  const signalFor = (signal: AbortSignal) => AbortSignal.any([signal, options.signal, AbortSignal.timeout(10000)]);
  async function api(route: string, signal: AbortSignal, maximum = 262144): Promise<any> {
    options.onStage?.(route.split('?')[0].replace(/\d+/g, ':id'));
    const response = await request(new URL(route, base), { signal: signalFor(signal), redirect: 'error', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${options.token}`, username: options.username } });
    if (!response.ok) { await response.body?.cancel(); fail(response.status === 401 || response.status === 403 ? 'FORBIDDEN' : response.status === 404 ? 'UNAVAILABLE' : 'INTERNAL'); }
    const bytes = await collect(response, maximum, signal);
    let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('INTERNAL'); }
    if (String(body?.code) !== '0') fail('FORBIDDEN');
    return body.data;
  }
  return { api, request, base, signalFor };
}

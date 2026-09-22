import { createHash } from 'node:crypto';
import { PluginFault, type OpenedResourceAuthority } from './resource-broker';
import { libraryResourceApi, collect } from './library-resource-api';
import { LIMITS } from '../../../packages/plugin-sdk/index.js';

type NodeFact = { id: number; libraryId: number; name: string; type: string; fileSize?: number; storageKey: string; storageBucket: string; storageProvider: string; updatedAt: string };
export interface LibraryResourceOptions {
  expectedParentId?: number;
  apiBaseUrl: string; storageOrigins: readonly string[]; token: string; username: string;
  libraryId: number; nodeId: number; signal: AbortSignal; fetch?: typeof fetch; onStage?: (stage: string) => void;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string): never => { throw new PluginFault(code, 'Resource access failed'); };
/** 仅由可信主窗口发起；正文 URL 和用户凭据不进入插件。 */
export async function openLibraryResource(options: LibraryResourceOptions): Promise<OpenedResourceAuthority> {
  const { api, request, base, signalFor } = libraryResourceApi(options);
  async function node(signal: AbortSignal): Promise<NodeFact> {
    const fact = await api(`v1/nodes/${options.nodeId}`, signal);
    if (!fact || fact.id !== options.nodeId || fact.libraryId !== options.libraryId || fact.type !== 'file' || (options.expectedParentId !== undefined && fact.parentId !== options.expectedParentId)) fail('FORBIDDEN');
    const size = fact.fileSize ?? 0;
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.readTotalBytes) fail('LIMIT');
    if (typeof fact.name !== 'string' || fact.name.length > 512 || typeof fact.storageKey !== 'string' || !fact.storageKey
      || typeof fact.storageBucket !== 'string' || !fact.storageBucket || typeof fact.updatedAt !== 'string' || !fact.updatedAt) fail('UNAVAILABLE');
    const extension = typeof fact.ext === 'string' ? fact.ext.replace(/^\./, '') : '';
    const name = extension && !fact.name.toLowerCase().endsWith('.' + extension.toLowerCase()) ? `${fact.name}.${extension}` : fact.name;
    return { id: fact.id, libraryId: fact.libraryId, name, type: fact.type, fileSize: size,
      storageKey: fact.storageKey, storageBucket: fact.storageBucket, storageProvider: fact.storageProvider, updatedAt: fact.updatedAt };
  }
  const user = await api('v1/user/me', options.signal);
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1) fail('FORBIDDEN');
  const initial = await node(options.signal);
  const metadataRevision = hash(initial);
  async function link(signal: AbortSignal) {
    const result = await api(`v1/directory/link?libraryId=${options.libraryId}&nodeId=${options.nodeId}&expiry=1`, signal);
    if (typeof result !== 'string' || result.length > 32768) fail('UNAVAILABLE');
    const url = new URL(result);
    if (!options.storageOrigins.includes(url.origin) || url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) fail('FORBIDDEN');
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { fail('FORBIDDEN'); }
    if (pathname !== `/${initial.storageBucket}/${initial.storageKey}`) fail('FORBIDDEN');
    return url;
  }
  let etag = '';
  async function read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array();
    const url = await link(signal); options.onStage?.('storage.range');
    const response = await request(url, { signal: signalFor(signal), redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Range: `bytes=${offset}-${offset + length - 1}`, ...(etag ? { 'If-Match': etag } : {}) } });
    const currentEtag = response.headers.get('etag');
    if (response.status === 412 || (etag && currentEtag !== etag)) { await response.body?.cancel(); fail('CONTENT_CHANGED'); }
    if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${initial.fileSize}`
      || !currentEtag || !/^"[^"\r\n]{1,254}"$/.test(currentEtag)) { await response.body?.cancel(); fail('UNAVAILABLE'); }
    const bytes = await collect(response, length, signal);
    if (bytes.byteLength !== length) fail('CONTENT_CHANGED');
    etag = currentEtag!;
    return bytes;
  }
  // 仅在宿主明确授权打开后固定对象 ETag，避免跨分块拼接不同版本。
  if (initial.fileSize) await read(0, 1, options.signal);
  if (hash(await node(options.signal)) !== metadataRevision) fail('CONTENT_CHANGED');
  const revision = hash([metadataRevision, etag]);
  return Object.freeze({ accountScope: hash([base.href, user.id]), libraryId: options.libraryId, nodeId: options.nodeId,
    name: initial.name, size: initial.fileSize ?? 0, revision,
    authorize: async (signal: AbortSignal) => { await node(signal); return true; },
    currentRevision: async (signal: AbortSignal) => hash(await node(signal)) === metadataRevision ? revision : 'changed',
    readRange: read,
  });
}

import { createHash } from 'node:crypto';
import { LIMITS } from '../../../packages/plugin-sdk/index.js';
import { openLibraryResource, type LibraryResourceOptions } from './library-resource';
import { libraryResourceApi } from './library-resource-api';
import { PluginFault, type OpenedResourceAuthority } from './resource-broker';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code: string): never => { throw new PluginFault(code, 'Directory access failed'); };
const imageTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };

/** 固定直属图片快照；插件不接收节点 ID、存储路径、签名链接或凭据。 */
export async function openLibraryDirectory(options: LibraryResourceOptions): Promise<OpenedResourceAuthority> {
  const { api, base } = libraryResourceApi(options);
  const user = await api('v1/user/me', options.signal);
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1) fail('FORBIDDEN');
  async function directory(signal: AbortSignal) {
    const fact = await api(`v1/nodes/${options.nodeId}`, signal);
    if (!fact || fact.id !== options.nodeId || fact.libraryId !== options.libraryId || fact.type !== 'dir'
      || fact.builtInType !== 'COMIC' || (fact.archiveMode ?? 0) !== 0) fail('FORBIDDEN');
    if (typeof fact.name !== 'string' || fact.name.length > 512) fail('UNAVAILABLE');
    // viewMeta 是独立的内置阅读状态，不因它变化废弃插件快照。
    return { id: fact.id, libraryId: fact.libraryId, name: fact.name, type: fact.type, builtInType: fact.builtInType, archiveMode: fact.archiveMode ?? 0 };
  }
  const initial = await directory(options.signal);
  const rows = await api(`v1/nodes/${options.nodeId}/children?libraryId=${options.libraryId}`, options.signal, 2 * 1024 * 1024);
  if (!Array.isArray(rows)) fail('UNAVAILABLE');
  if (rows.length > LIMITS.directoryEntries) fail('LIMIT');
  const ids = new Set<number>();
  const entries = (rows as Record<string, any>[]).flatMap((row: Record<string, any>) => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)
      || row.libraryId !== options.libraryId || row.parentId !== options.nodeId) fail('FORBIDDEN');
    ids.add(row.id);
    if (row.type !== 'file') return [];
    if (typeof row.name !== 'string' || row.name.length > 480) fail('UNAVAILABLE');
    const extension = typeof row.ext === 'string' ? row.ext.replace(/^\./, '').toLowerCase() : '';
    const mimeType = Object.prototype.hasOwnProperty.call(imageTypes, extension) ? imageTypes[extension] : undefined;
    if (row.name.startsWith('.') || !mimeType) return [];
    const name = row.name.toLowerCase().endsWith('.' + extension) ? row.name : `${row.name}.${extension}`;
    const size = row.fileSize ?? 0;
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.readTotalBytes) fail('LIMIT');
    return [{ nodeId: row.id as number, name, size, mimeType, storageKey: row.storageKey, storageBucket: row.storageBucket }];
  });
  if (hash(await directory(options.signal)) !== hash(initial)) fail('CONTENT_CHANGED');
  const revision = hash([initial, entries]);
  const accountScope = hash([base.href, user.id]);
  const publicEntries = Object.freeze(entries.map(entry => Object.freeze({
    id: hash([options.libraryId, options.nodeId, entry.nodeId]), name: entry.name, size: entry.size, mimeType: entry.mimeType,
  })));
  return Object.freeze({ accountScope, libraryId: options.libraryId, nodeId: options.nodeId,
    name: initial.name, size: 0, revision,
    authorize: async (signal: AbortSignal) => { await directory(signal); return true; },
    currentRevision: async (signal: AbortSignal) => hash(await directory(signal)) === hash(initial) ? revision : 'changed',
    readRange: async () => fail('UNSUPPORTED'),
    directory: {
      type: 'COMIC' as const, entries: publicEntries,
      async open(entryId: string, signal: AbortSignal) {
        const index = publicEntries.findIndex(entry => entry.id === entryId);
        if (index < 0) return fail('FORBIDDEN');
        await directory(signal);
        const entry = entries[index];
        const resource = await openLibraryResource({ ...options, nodeId: entry.nodeId, expectedParentId: options.nodeId,
          signal: AbortSignal.any([signal, options.signal]) });
        if (resource.accountScope !== accountScope || resource.name !== entry.name || resource.size !== entry.size) fail('CONTENT_CHANGED');
        return resource;
      },
    },
  });
}

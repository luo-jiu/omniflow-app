import { createHash } from 'node:crypto';
import { net } from 'electron';

import type { AgentFileAuthorityNodeSnapshotV1 } from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { LIMITS } from '../../../packages/plugin-sdk/index.js';
import { PluginFault, type OpenedResourceAuthority } from '../extensions/resource-broker';
import { agentFileAuthorityBroker, type AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';

declare const __OMNIFLOW_STORAGE_ORIGINS__: readonly string[];

export interface AgentPluginResourceOptions {
  request?: typeof agentFileAuthorityBroker.request;
  fetch?: typeof net.fetch;
  storageOrigins?: readonly string[];
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code: string): never { throw new PluginFault(code, 'Agent plugin resource access failed'); }
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const boundedString = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value)
);

/** main-only adapter; the owner-bound broker remains the source of resource authorization. */
export async function openAgentPluginResource(
  input: AgentFileAuthorityBrokerRequestInput,
  assertCurrent: (signal: AbortSignal) => Promise<void>,
  options: AgentPluginResourceOptions = {},
): Promise<OpenedResourceAuthority> {
  if (input.operation.operation !== 'stage-library-node' || input.internalScopeLookup
    || !positiveInteger(input.libraryId) || !positiveInteger(input.operation.nodeId)
    || ![input.sessionId, input.runId, input.toolRunId].every(value => boundedString(value, 200))
    || !input.sender || input.sender.isDestroyed()) fail('FORBIDDEN');
  const ownerScope = Object.freeze(normalizeAgentOwnerScope(input.ownerScope));
  const nodeId = input.operation.nodeId;
  // Capture immutable host identity so later mutations of caller-owned objects cannot rebind it.
  const binding = Object.freeze({ ...input, ownerScope, operation: Object.freeze({
    operation: 'stage-library-node' as const, nodeId, includeDownloadUrl: true,
  }) });
  const request = options.request ?? agentFileAuthorityBroker.request;
  const fetchRange = options.fetch ?? net.fetch;
  const origins = new Set(options.storageOrigins ?? (typeof __OMNIFLOW_STORAGE_ORIGINS__ === 'undefined'
    ? [] : __OMNIFLOW_STORAGE_ORIGINS__));

  async function bounded<T>(callerSignal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const signal = AbortSignal.any([binding.signal, callerSignal, controller.signal]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort!: () => void;
    try {
      signal.throwIfAborted();
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new PluginFault(controller.signal.aborted ? 'TIMEOUT' : 'CANCELLED', 'Agent plugin resource interrupted'));
        signal.addEventListener('abort', rejectAbort, { once: true });
        timeout = setTimeout(() => controller.abort(), 10_000);
        timeout.unref?.();
      });
      return await Promise.race([action(signal), interrupted]);
    } catch (error) {
      if (signal.aborted) fail(controller.signal.aborted ? 'TIMEOUT' : 'CANCELLED');
      if (error instanceof PluginFault) throw error;
      // Broker/network errors may contain a signed URL or internal metadata; do not expose them.
      return fail('FORBIDDEN');
    } finally {
      clearTimeout(timeout);
      if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
    }
  }

  async function source(signal: AbortSignal, includeDownloadUrl: boolean) {
    signal.throwIfAborted();
    if (binding.sender.isDestroyed()) fail('FORBIDDEN');
    await assertCurrent(signal);
    signal.throwIfAborted();
    const result = await request({ ...binding, signal, operation: {
      operation: 'stage-library-node', nodeId, includeDownloadUrl,
    } });
    signal.throwIfAborted();
    if (result.version !== 1 || result.operation !== 'stage-library-node' || result.node.version !== 1
      || result.node.id !== nodeId || result.node.libraryId !== binding.libraryId || result.node.type !== 'file') fail('FORBIDDEN');
    const fact = result.node;
    if (!Number.isSafeInteger(fact.fileSize) || fact.fileSize < 0 || fact.fileSize > LIMITS.readTotalBytes) fail('LIMIT');
    if (!boundedString(fact.name, 512) || !Number.isSafeInteger(fact.parentId) || fact.parentId < 0
      || !boundedString(fact.storageKey, 2_048)
      || [fact.ext, fact.mimeType, fact.storageProvider, fact.updatedAt].some(value => value !== undefined && !boundedString(value, 512))) fail('UNAVAILABLE');
    // Canonicalize the authoritative facts before hashing, independent of object key order.
    const node: AgentFileAuthorityNodeSnapshotV1 = {
      version: 1, id: fact.id, libraryId: fact.libraryId, parentId: fact.parentId, type: 'file',
      name: fact.name, fileSize: fact.fileSize, ext: fact.ext, mimeType: fact.mimeType,
      storageKey: fact.storageKey, storageProvider: fact.storageProvider, updatedAt: fact.updatedAt,
    };
    let url: URL | undefined;
    if (includeDownloadUrl) {
      if (!boundedString(result.downloadUrl, 32 * 1024)) fail('UNAVAILABLE');
      try { url = new URL(result.downloadUrl!); } catch { fail('FORBIDDEN'); }
      if (!['http:', 'https:'].includes(url!.protocol) || !origins.has(url!.origin)
        || url!.username || url!.password || url!.hash) fail('FORBIDDEN');
      let pathname: string;
      try { pathname = decodeURIComponent(url!.pathname); } catch { fail('FORBIDDEN'); }
      // The broker has no bucket field; constrain the signed object's key and pin its full path below.
      if (!pathname!.endsWith('/' + fact.storageKey) || /[\0\r\n]/u.test(pathname!)) fail('FORBIDDEN');
    }
    await assertCurrent(signal);
    signal.throwIfAborted();
    return { node, url };
  }

  let initial!: AgentFileAuthorityNodeSnapshotV1;
  let metadataRevision = '';
  let targetIdentity = '';
  let etag = '';

  async function collect(response: Response, length: number, signal: AbortSignal): Promise<Uint8Array> {
    if (!response.body) { if (length) fail('CONTENT_CHANGED'); return new Uint8Array(); }
    const reader = response.body.getReader();
    const bytes = new Uint8Array(length);
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const item = await reader.read();
        signal.throwIfAborted();
        if (item.done) break;
        if (item.value.byteLength > length - size) fail('LIMIT');
        bytes.set(item.value, size); size += item.value.byteLength;
      }
      if (size !== length) fail('CONTENT_CHANGED');
      return bytes;
    } finally {
      signal.removeEventListener('abort', cancel);
      // Do not wait forever for an upstream stream's cancellation hook.
      cancel(); reader.releaseLock();
    }
  }

  async function fetchBytes(url: URL, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    if (hash([url.origin, url.pathname]) !== targetIdentity) fail('CONTENT_CHANGED');
    let response: Response;
    try {
      response = await fetchRange(url.href, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        method: initial.fileSize ? 'GET' : 'HEAD', headers: {
          ...(initial.fileSize ? { Range: `bytes=${offset}-${offset + length - 1}` } : {}),
          ...(etag ? { 'If-Match': etag } : {}),
        } });
    } catch { signal.throwIfAborted(); fail('UNAVAILABLE'); }
    if (signal.aborted) { void response!.body?.cancel().catch(() => undefined); signal.throwIfAborted(); }
    const currentEtag = response!.headers.get('etag');
    let fault = '';
    if (response!.status === 412 || (etag && currentEtag && currentEtag !== etag)) fault = 'CONTENT_CHANGED';
    else if (response!.redirected || response!.status !== (initial.fileSize ? 206 : 200)
      || !currentEtag || !/^"[^"\r\n]{1,254}"$/u.test(currentEtag)
      || (initial.fileSize
        ? response!.headers.get('content-range') !== `bytes ${offset}-${offset + length - 1}/${initial.fileSize}`
        : response!.headers.get('content-length') !== '0')
      || (response!.headers.has('content-length') && response!.headers.get('content-length') !== String(length))) fault = 'UNAVAILABLE';
    if (fault) { void response!.body?.cancel().catch(() => undefined); fail(fault); }
    const bytes = await collect(response!, length, signal);
    etag = currentEtag!;
    return bytes;
  }

  async function verifyMetadata(signal: AbortSignal): Promise<void> {
    if (hash((await source(signal, false)).node) !== metadataRevision) fail('CONTENT_CHANGED');
  }

  await bounded(binding.signal, async signal => {
    const opened = await source(signal, true);
    initial = opened.node;
    metadataRevision = hash(initial);
    targetIdentity = hash([opened.url!.origin, opened.url!.pathname]);
    await fetchBytes(opened.url!, 0, initial.fileSize ? 1 : 0, signal);
    await verifyMetadata(signal);
  });
  const revision = hash([metadataRevision, etag]);
  const extension = initial.ext?.replace(/^\./u, '') ?? '';
  const name = extension && !initial.name.toLowerCase().endsWith('.' + extension.toLowerCase())
    ? `${initial.name}.${extension}` : initial.name;
  if (name.length > 512) fail('LIMIT');

  async function readRange(offset: number, length: number, callerSignal: AbortSignal): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
      || length > LIMITS.readChunkBytes || offset > initial.fileSize - length) fail('BAD_REQUEST');
    return bounded(callerSignal, async signal => {
      const before = await source(signal, length > 0);
      if (hash(before.node) !== metadataRevision) fail('CONTENT_CHANGED');
      const bytes = length ? await fetchBytes(before.url!, offset, length, signal) : new Uint8Array();
      await verifyMetadata(signal);
      return bytes;
    });
  }

  return Object.freeze({ accountScope: ownerScope.accountScope, libraryId: binding.libraryId, nodeId,
    name, size: initial.fileSize, revision,
    authorize: (signal: AbortSignal) => bounded(signal, async combined => { await verifyMetadata(combined); return true; }),
    currentRevision: (signal: AbortSignal) => bounded(signal, async combined => {
      const current = await source(combined, true);
      if (hash(current.node) !== metadataRevision) fail('CONTENT_CHANGED');
      await fetchBytes(current.url!, 0, initial.fileSize ? 1 : 0, combined);
      await verifyMetadata(combined);
      return revision;
    }),
    readRange,
  });
}

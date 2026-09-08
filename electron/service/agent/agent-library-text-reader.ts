import { net } from 'electron';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import { agentFileAuthorityBroker } from './agent-file-authority-broker';
import { AGENT_TEXT_MAX_BYTES, collectAgentTextStream } from './agent-text-reader';
import { runtimeLogger } from '../../runtimeLogger';

interface CachedText {
  bytes: Buffer;
  etag: string;
  identity: string;
  runId: string;
  timer: ReturnType<typeof setTimeout>;
}

export function createAgentLibraryTextReader(options: { maxBytes?: number; ttlMs?: number } = {}) {
  const entries = new Map<string, CachedText>();
  const maximum = Math.max(0, Math.min(options.maxBytes ?? 16 * 1024 * 1024, 16 * 1024 * 1024));
  let retainedBytes = 0;
  function remove(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    retainedBytes -= entry.bytes.length;
    entries.delete(key);
  }
  function releaseRun(runId: string) {
    for (const [key, entry] of entries) if (entry.runId === runId) remove(key);
  }
  function store(key: string, bytes: Uint8Array, etag: string, identity: string, runId: string) {
    remove(key);
    if (bytes.byteLength > maximum) return;
    while (entries.size >= 16 || retainedBytes + bytes.byteLength > maximum) remove(entries.keys().next().value!);
    const timer = setTimeout(() => remove(key), Math.max(1, options.ttlMs ?? 60_000));
    timer.unref?.();
    const ownedBytes = Buffer.from(bytes);
    retainedBytes += ownedBytes.length;
    entries.set(key, { bytes: ownedBytes, etag, identity, runId, timer });
  }
  async function read(
    input: AgentFileAuthorityBrokerRequestInput,
    authorize = agentFileAuthorityBroker.request,
    fetchText: typeof net.fetch = net.fetch,
  ): Promise<Uint8Array> {
    const key = JSON.stringify([input.ownerScope, input.sender?.id, input.libraryId, input.sessionId,
      input.runId, input.operation.operation === 'stage-library-node' ? input.operation.nodeId : null]);
    try { return await readValidated(input, authorize, fetchText, key); }
    catch (error) { remove(key); throw error; }
  }

  async function readValidated(
    input: AgentFileAuthorityBrokerRequestInput,
    authorize = agentFileAuthorityBroker.request,
    fetchText: typeof net.fetch = net.fetch,
    key: string,
  ): Promise<Uint8Array> {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(25_000)]);
    const source = await authorize({ ...input, signal });
    if (source.operation !== 'stage-library-node' || !source.downloadUrl
      || input.operation.operation !== 'stage-library-node'
      || source.node.id !== input.operation.nodeId || source.node.libraryId !== input.libraryId) {
      throw new Error('资料库正文读取授权不匹配');
    }
    if (source.node.fileSize > AGENT_TEXT_MAX_BYTES) throw new Error('文本超过 8 MiB 读取上限');
    const identity = JSON.stringify(source.node);
    const stored = entries.get(key);
    const cached = stored?.identity === identity ? stored : undefined;
    if (stored && !cached) remove(key);
    let response: Response;
    try { response = await fetchText(source.downloadUrl, { signal, redirect: 'error', cache: 'no-store',
      ...(cached ? { headers: { 'If-None-Match': cached.etag } } : {}) }); }
    catch { signal.throwIfAborted(); throw new Error('源存储不可达，元数据存在不代表正文可读'); }
    let bytes: Uint8Array;
    const etag = response.headers.get('etag');
    if (response.status === 304 && cached) {
      await response.body?.cancel();
      if (etag && etag !== cached.etag) throw new Error('源文件版本响应不一致，请重新读取');
      bytes = Buffer.from(cached.bytes);
    } else {
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        if (response.status === 404) throw new Error('源文件内容不存在，元数据可能仍然保留');
        if (response.status === 401 || response.status === 403) throw new Error('源文件内容访问被拒绝');
        throw new Error('源存储不可达，正文未读取');
      }
      bytes = await collectAgentTextStream(response.body, signal);
    }
    if (bytes.byteLength !== source.node.fileSize) throw new Error('源文件大小已变化，请重新读取');
    const fresh = await authorize({ ...input, signal,
      operation: { operation: 'stage-library-node', nodeId: source.node.id, includeDownloadUrl: false } });
    signal.throwIfAborted();
    if (fresh.operation !== 'stage-library-node' || JSON.stringify(fresh.node) !== JSON.stringify(source.node)) {
      throw new Error('资料库文件身份或授权已变化，请重新读取');
    }
    const strongEtag = etag || (response.status === 304 ? cached?.etag : undefined);
    if (strongEtag && /^"[^"\r\n]{1,254}"$/u.test(strongEtag) && typeof input.runId === 'string') {
      store(key, bytes, strongEtag, identity, input.runId);
    } else remove(key);
    runtimeLogger.debug('agent.library.text.read', { runId: input.runId, nodeId: source.node.id,
      downloadedBytes: response.status === 304 ? 0 : bytes.byteLength, revalidated: response.status === 304 });
    return bytes;
  }
  return { read, releaseRun, retainedBytes: () => retainedBytes };
}

export const agentLibraryTextReader = createAgentLibraryTextReader();
export const readAgentLibraryText = agentLibraryTextReader.read;

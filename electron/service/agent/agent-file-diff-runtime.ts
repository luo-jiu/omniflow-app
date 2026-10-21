import crypto from 'node:crypto';
import type { AgentFileDiffRequest, AgentFileDiffResult } from '../../../src/shared/agent/agent-file-changes';
import { runAgentFileDiff } from './agent-file-diff-runner';
import type { AgentFileDiffComputation, AgentFileDiffJob } from './agent-file-diff.types';

const CACHE_TTL = 60_000;
const CACHE_CHARACTERS = 8 * 1024 * 1024;
const MAX_READS = 2;
const MAX_CACHE_ENTRIES = 4;
const CURSOR = /^([a-f0-9-]{36}):([0-9]{1,6})$/u;

export interface AgentFileDiffSource {
  /** Includes scope, immutable endpoint revisions, identity and baseline variant. */
  key: string;
  result: AgentFileDiffResult;
  job?: Omit<AgentFileDiffJob, 'pageLines'>;
}
export interface AgentFileDiffRuntimeOptions {
  clock?: () => number;
  run?: typeof runAgentFileDiff;
}
interface Cached {
  key: string;
  computation: AgentFileDiffComputation;
  characters: number;
  expiresAt: number;
}

export function createAgentFileDiffRuntime(options: AgentFileDiffRuntimeOptions = {}) {
  const clock = options.clock ?? Date.now;
  const compute = options.run ?? runAgentFileDiff;
  const cache = new Map<string, Cached>();
  const reads = new Map<AbortController, Promise<AgentFileDiffResult>>();
  let closed = false;
  function sweep() {
    for (const [id, value] of cache) if (value.expiresAt <= clock()) cache.delete(id);
  }
  const timer = setInterval(sweep, 15_000);
  timer.unref();
  function cacheSize() { return [...cache.values()].reduce((sum, value) => sum + value.characters, 0); }
  function expired(): never { throw new Error('差异分页已过期或范围已变化，请重新读取首屏'); }

  async function read(load: (signal: AbortSignal, needsContent: boolean) => Promise<AgentFileDiffSource>,
    request: Pick<AgentFileDiffRequest, 'cursor' | 'pageLines'>, externalSignal?: AbortSignal): Promise<AgentFileDiffResult> {
    if (closed) throw new Error('差异读取已关闭');
    externalSignal?.throwIfAborted();
    const pageLines = request.pageLines ?? 200;
    if (!Number.isSafeInteger(pageLines) || pageLines < 1 || pageLines > 500) throw new Error('差异每页行数无效');
    if (request.cursor !== undefined && (typeof request.cursor !== 'string' || !CURSOR.test(request.cursor))) expired();
    if (reads.size >= MAX_READS) throw new Error('差异读取繁忙，请稍后重试');
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    const work = (async () => {
      sweep();
      const source = await load(controller.signal, request.cursor === undefined);
      controller.signal.throwIfAborted();
      if (!source.result.available) return source.result;
      const key = JSON.stringify([source.key, pageLines]);
      let id: string, index: number, value: Cached;
      if (request.cursor !== undefined) {
        const match = CURSOR.exec(request.cursor)!;
        id = match[1]; index = Number(match[2]);
        const found = cache.get(id);
        if (!found || found.key !== key || found.expiresAt <= clock() || index >= found.computation.pages.length) expired();
        value = found;
      } else {
        if (!source.job) throw new Error('历史差异快照缺失');
        const computation = await compute({ ...source.job, pageLines }, controller.signal);
        controller.signal.throwIfAborted();
        value = { key, computation, characters: computation.pages.reduce((sum, page) => sum + page.patch.length, 0), expiresAt: clock() + CACHE_TTL };
        while (cache.size >= MAX_CACHE_ENTRIES || cache.size > 0 && cacheSize() + value.characters > CACHE_CHARACTERS) {
          cache.delete(cache.keys().next().value!);
        }
        id = crypto.randomUUID(); index = 0; cache.set(id, value);
      }
      const computation = value.computation;
      const page = computation.pages[index];
      return { ...source.result, patch: page.patch, truncated: computation.truncated,
        ...(computation.warning ? { warning: computation.warning } : {}), page: {
          index, totalPages: computation.pages.length, startLine: page.startLine, endLine: page.endLine,
          totalLines: computation.totalLines, continuedFromPrevious: page.continuedFromPrevious, continuesOnNext: page.continuesOnNext,
          ...(index > 0 ? { previousCursor: `${id}:${index - 1}` } : {}),
          ...(index + 1 < computation.pages.length ? { nextCursor: `${id}:${index + 1}` } : {}),
        } };
    })();
    reads.set(controller, work);
    if (externalSignal?.aborted) abort();
    try { return await work; }
    finally { externalSignal?.removeEventListener('abort', abort); reads.delete(controller); }
  }
  return { read, async close() {
    closed = true; clearInterval(timer); cache.clear();
    for (const controller of reads.keys()) controller.abort();
    await Promise.allSettled([...reads.values()]);
  } };
}

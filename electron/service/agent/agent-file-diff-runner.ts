import { Worker } from 'node:worker_threads';
import { AGENT_DIFF_MAX_CHARACTERS, AGENT_DIFF_MAX_PAGES, AGENT_DIFF_PAGE_CHARACTERS,
  type AgentFileDiffComputation, type AgentFileDiffJob } from './agent-file-diff.types';

export interface AgentFileDiffRunnerOptions {
  workerUrl?: URL;
  timeoutMs?: number;
}

function validResult(value: unknown): value is AgentFileDiffComputation {
  if (!value || typeof value !== 'object') return false;
  const result = value as AgentFileDiffComputation;
  let length = 0;
  return Array.isArray(result.pages) && result.pages.length > 0 && result.pages.length <= AGENT_DIFF_MAX_PAGES
    && Number.isSafeInteger(result.totalLines) && result.totalLines >= 0 && typeof result.truncated === 'boolean'
    && (result.warning === undefined || typeof result.warning === 'string' && result.warning.length <= 500)
    && result.pages.every(page => typeof page?.patch === 'string' && page.patch.length <= AGENT_DIFF_PAGE_CHARACTERS
      && (length += page.patch.length) <= AGENT_DIFF_MAX_CHARACTERS
      && Number.isSafeInteger(page.startLine) && page.startLine >= 0 && Number.isSafeInteger(page.endLine)
      && page.endLine >= page.startLine && typeof page.continuedFromPrevious === 'boolean' && typeof page.continuesOnNext === 'boolean');
}

export function runAgentFileDiff(job: AgentFileDiffJob, signal: AbortSignal,
  options: AgentFileDiffRunnerOptions = {}): Promise<AgentFileDiffComputation> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(options.workerUrl ?? new URL(/* @vite-ignore */ './agent-file-diff-worker.js', import.meta.url), {
      workerData: job, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: Error, result?: AgentFileDiffComputation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      // Cancellation is acknowledged only after the worker has actually exited.
      void worker.terminate().then(() => error ? reject(error) : resolve(result!),
        () => reject(error || new Error('差异线程资源释放失败')));
    };
    const abort = () => finish(Object.assign(new Error('差异读取已取消'), { name: 'AbortError' }));
    const timer = setTimeout(() => finish(new Error('差异计算超时，请缩小查看范围')), options.timeoutMs ?? 5000);
    worker.once('message', (payload: { result?: unknown; error?: unknown }) => {
      if (payload?.error) finish(new Error('差异计算失败，历史版本仍保留'));
      else if (validResult(payload?.result)) finish(undefined, payload.result);
      else finish(new Error('差异线程返回了无效或超限结果'));
    });
    worker.once('error', () => finish(new Error('差异线程不可用或达到资源上限')));
    worker.once('exit', () => { if (!settled) finish(new Error('差异线程提前退出')); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

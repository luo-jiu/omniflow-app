import { Worker as NodeWorker } from 'node:worker_threads';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';

export function runAgentDocument(job: AgentDocumentJob, signal: AbortSignal): Promise<AgentDocumentResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(new URL(/* @vite-ignore */ './agent-document-worker.js', import.meta.url), {
      workerData: job, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (error?: Error, result?: AgentDocumentResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      void worker.terminate().then(() => error ? reject(error) : resolve(result!),
        () => reject(error || new Error('文档线程资源释放失败')));
    };
    const abort = () => finish(Object.assign(new Error('文档处理已取消'), { name: 'AbortError' }));
    const timer = setTimeout(() => finish(new Error('文档处理超时，请减少处理范围')), 30_000);
    worker.once('message', payload => payload.error ? finish(new Error(payload.error)) : finish(undefined, payload.result));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('文档处理线程提前退出')); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

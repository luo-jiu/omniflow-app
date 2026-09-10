import { Worker as NodeWorker } from 'node:worker_threads';
import type { AgentDocumentJob, AgentDocumentResult } from './document.types';
import { convertPresentationToPdf } from './office-renderer';

export function runAgentDocument(job: AgentDocumentJob, signal: AbortSignal): Promise<AgentDocumentResult> {
  signal.throwIfAborted();
  if (job.format === 'pptx' && job.operation === 'render') return (async () => {
    const original = await runAgentDocument({ ...job, operation: 'inspect' }, signal);
    if (original.renderAllowed !== true) throw new Error('PPTX 包含宏或外部资源，不能自动渲染页面；可读取内部文字');
    const bytes = await convertPresentationToPdf(job.bytes, signal);
    const result = await runAgentDocument({ ...job, format: 'pdf', bytes }, signal);
    if (result.pageCount !== original.pageCount) throw new Error('转换前后幻灯片页数不一致，未交付可能错位的页面');
    return result;
  })();
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

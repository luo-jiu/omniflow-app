import { parentPort, workerData } from 'node:worker_threads';
import { processAgentDocument } from './document-engine';
void processAgentDocument(workerData).then(
  result => parentPort?.postMessage({ result }),
  error => parentPort?.postMessage({ error: error instanceof Error ? error.message : '文档处理失败' }),
);

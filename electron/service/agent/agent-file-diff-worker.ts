import { parentPort, workerData } from 'node:worker_threads';
import { computeAgentFileDiff } from './agent-file-diff-engine';

try { parentPort?.postMessage({ result: computeAgentFileDiff(workerData) }); }
catch { parentPort?.postMessage({ error: '差异计算失败，历史版本仍保留' }); }

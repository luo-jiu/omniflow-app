import { createCsvParser, CSV_LIMITS } from './csv-parser.js';

export class CsvToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CsvToolError';
    this.code = code;
  }
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Viewer and Tool read through the same bounded parser, without a DOM dependency.
export async function readCsvResource(client, resource, chunkBytes, { signal, wait = pause } = {}) {
  if (!Number.isSafeInteger(resource.size) || resource.size < 0 || resource.size > CSV_LIMITS.bytes) {
    throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV 超过 4 MiB 读取上限或文件大小无效');
  }
  const parser = createCsvParser();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0;
  do {
    if (signal?.aborted) throw new CsvToolError('FAILED', 'CSV 读取已取消');
    const chunk = await client.read(resource.handle, offset, chunkBytes, { signal });
    if (chunk.revision !== resource.revision || chunk.nextOffset !== offset + chunk.bytes.length
      || chunk.nextOffset > resource.size || (chunk.eof && chunk.nextOffset !== resource.size)
      || (!chunk.eof && (chunk.nextOffset === offset || chunk.nextOffset === resource.size))) {
      throw new CsvToolError('FAILED', 'CSV 资源读取不完整或版本已变化');
    }
    try {
      parser.write(decoder.decode(chunk.bytes, { stream: !chunk.eof }));
    } catch {
      throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV 编码、引号格式或内容规模不受支持');
    }
    offset = chunk.nextOffset;
    if (chunk.eof) break;
    // At most 40 sequential reads per second, leaving room for control RPCs.
    await wait(25);
  } while (offset < resource.size);
  if (signal?.aborted) throw new CsvToolError('FAILED', 'CSV 读取已取消');
  try { return parser.finish(); }
  catch { throw new CsvToolError('UNSUPPORTED_FORMAT', 'CSV 引号未闭合或内容规模超过限制'); }
}

import { JsonTransformError } from './json-transform.js';

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export async function readJsonResource(client, resource, chunkBytes, { signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!resource || !Number.isSafeInteger(resource.size) || resource.size < 1 || resource.size > MAX_SOURCE_BYTES) throw new JsonTransformError('UNSUPPORTED_FORMAT', 'JSON 源文件超过 4 MiB 或大小无效');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let offset = 0; let text = '';
  do {
    if (signal?.aborted) throw new JsonTransformError('FAILED', 'JSON 读取已取消');
    const chunk = await client.read(resource.handle, offset, chunkBytes, { signal });
    if (chunk.revision !== resource.revision || chunk.nextOffset !== offset + chunk.bytes.length || chunk.nextOffset > resource.size
      || (chunk.eof && chunk.nextOffset !== resource.size) || (!chunk.eof && (chunk.nextOffset === offset || chunk.nextOffset === resource.size))) throw new JsonTransformError('FAILED', 'JSON 资源读取不完整或版本已变化');
    try { text += decoder.decode(chunk.bytes, { stream: !chunk.eof }); } catch { throw new JsonTransformError('UNSUPPORTED_FORMAT', 'JSON 不是有效 UTF-8'); }
    offset = chunk.nextOffset; if (!chunk.eof) await wait(25);
  } while (offset < resource.size);
  if (signal?.aborted) throw new JsonTransformError('FAILED', 'JSON 读取已取消');
  return text;
}

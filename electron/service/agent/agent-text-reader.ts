import crypto from 'node:crypto';

export const AGENT_TEXT_MAX_BYTES = 8 * 1024 * 1024;
export const AGENT_READ_DEFAULT_OUTPUT_TOKENS = 10_000;
export const AGENT_READ_OUTPUT_MAX_BYTES = 1024 * 1024;

export interface AgentTextReadQuery {
  scope?: 'library' | 'host';
  path: string;
  offset?: number;
  column?: number;
  limit?: number;
  revision?: string;
  maxOutputTokens?: number;
}

export function decodeAgentText(bytes: Uint8Array) {
  if (bytes.byteLength > AGENT_TEXT_MAX_BYTES) throw new Error('文本超过 8 MiB 读取上限，请使用范围下载或本机 Shell');
  if (Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') throw new Error('PDF 不是可直接按行读取的文本，请使用文档解析工具');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('文件不是有效的 UTF-8 文本'); }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 8 || (code >= 14 && code <= 31)) throw new Error('文件包含二进制内容，不能作为文本读取');
  }
  const revision = crypto.createHash('sha256').update(bytes).digest('hex');
  const lines = text ? text.split(/\r\n|\n|\r/u) : [];
  if (lines.at(-1) === '') lines.pop();
  return { revision, lines };
}

export function sliceAgentText(bytes: Uint8Array, query: AgentTextReadQuery, outputBytes = AGENT_READ_DEFAULT_OUTPUT_TOKENS * 4) {
  return sliceDecodedAgentText(decodeAgentText(bytes), query, outputBytes);
}

export function sliceDecodedAgentText(
  decoded: ReturnType<typeof decodeAgentText>, query: AgentTextReadQuery,
  outputBytes = AGENT_READ_DEFAULT_OUTPUT_TOKENS * 4,
) {
  const { revision, lines } = decoded;
  if (query.revision && query.revision !== revision) throw new Error('文件内容已变化，请从头重新读取');
  const offset = query.offset ?? 1;
  const column = query.column ?? 1;
  const limit = query.limit ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(column) || column < 1
    || !Number.isSafeInteger(limit) || limit < 1) throw new Error('读取范围无效');
  if (offset > lines.length && !(offset === 1 && lines.length === 0)) throw new Error('offset 超出文件行数');
  let remaining = Math.max(0, Math.min(outputBytes, AGENT_READ_OUTPUT_MAX_BYTES));
  const entries: { line: number; column: number; text: string }[] = [];
  let nextOffset = offset;
  let nextColumn = column;
  for (let i = offset - 1; i < lines.length && entries.length < limit; i += 1) {
    const start = i === offset - 1 ? column - 1 : 0;
    const prefix = `L${i + 1}${start ? `:${start + 1}` : ''}: `;
    const overhead = Buffer.byteLength(prefix) + 1;
    if (remaining < overhead) break;
    remaining -= overhead;
    let end = 0;
    let partial = false;
    const selected: string[] = [];
    for (const character of lines[i]) {
      if (end < start) { end += 1; continue; }
      const size = Buffer.byteLength(character);
      if (size > remaining) { partial = true; break; }
      remaining -= size; selected.push(character); end += 1;
    }
    if (start > end) throw new Error('column 超出行长度');
    if (partial && !selected.length) break;
    entries.push({ line: i + 1, column: start + 1, text: selected.join('') });
    nextOffset = partial ? i + 1 : i + 2;
    nextColumn = partial ? end + 1 : 1;
    if (partial || remaining <= 0) break;
  }
  const hasMore = nextOffset <= lines.length;
  return { scope: query.scope ?? 'library', path: query.path, revision, offset, column,
    lines: entries, totalLines: lines.length, hasMore,
    content: entries.map(entry => `L${entry.line}${entry.column > 1 ? `:${entry.column}` : ''}: ${entry.text}`).join('\n'),
    ...(entries.length ? { endLine: entries[entries.length - 1].line } : {}),
    ...(hasMore ? { nextOffset, nextColumn } : {}) };
}

export async function collectAgentTextStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = stream.getReader();
  const buffer = Buffer.alloc(AGENT_TEXT_MAX_BYTES);
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > AGENT_TEXT_MAX_BYTES) throw new Error('文本超过 8 MiB 读取上限');
      buffer.set(item.value, size - item.value.byteLength);
    }
    return buffer.subarray(0, size);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

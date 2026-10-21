import { AgentGrepError, runAgentRipgrep } from './agent-ripgrep';

export interface AgentGrepPattern {
  pattern: string;
  mode?: 'literal' | 'regex';
  regexProfile?: 'rust-regex-v1';
  caseSensitive?: boolean;
}
export interface AgentGrepRange { start: number; end: number }

function originalColumn(text: string, normalizedOffset: number, folded: boolean, end: boolean) {
  let offset = 0, column = 0;
  for (const character of text) {
    if (offset >= normalizedOffset) return column;
    offset += (folded ? character.toLowerCase() : character).length;
    column += 1;
    if (offset > normalizedOffset) return end ? column : column - 1;
  }
  if (offset !== normalizedOffset) throw new AgentGrepError('SEARCH_FAILED', 'rg 返回了无效的匹配位置');
  return column;
}

function utf16OffsetAtByte(text: string, at: number) {
  const bytes = Buffer.from(text);
  if (!Number.isSafeInteger(at) || at < 0 || at > bytes.length) throw new AgentGrepError('SEARCH_FAILED', 'rg 返回了无效的字节位置');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, at)).length; }
  catch { throw new AgentGrepError('SEARCH_FAILED', 'rg 匹配位置没有对齐 UTF-8 字符'); }
}

function parseRipgrep(output: string, original: string[], normalized: string[], folded: boolean) {
  const matches = new Map<number, AgentGrepRange>();
  let summary = false;
  for (const line of output.split('\n')) {
    if (!line) continue;
    let event: { type: string; data: { line_number?: number; lines?: { text?: string }; submatches?: { start: number; end: number }[] } };
    try { event = JSON.parse(line); } catch { throw new AgentGrepError('SEARCH_FAILED', 'rg 返回了无效的 JSON'); }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw new AgentGrepError('SEARCH_FAILED', 'rg 返回了无效的事件');
    if (event.type === 'summary') { summary = true; continue; }
    if (event.type === 'begin' || event.type === 'end') continue;
    if (event.type !== 'match') throw new AgentGrepError('SEARCH_FAILED', 'rg 返回了不支持的事件');
    const index = (event.data?.line_number ?? 0) - 1;
    const first = event.data?.submatches?.[0];
    if (!Number.isSafeInteger(index) || index < 0 || index >= original.length || !first || first.start > first.end
      || event.data.lines?.text !== `${normalized[index]}\n` || matches.has(index)) {
      throw new AgentGrepError('SEARCH_FAILED', 'rg 匹配事件与搜索快照不一致');
    }
    const start = originalColumn(original[index], utf16OffsetAtByte(normalized[index], first.start), folded, false);
    const end = first.start === first.end ? start : originalColumn(original[index], utf16OffsetAtByte(normalized[index], first.end), folded, true);
    matches.set(index, { start, end });
  }
  if (!summary) throw new AgentGrepError('SEARCH_FAILED', 'rg 输出不完整，缺少 summary');
  return matches;
}

export function validateAgentGrepPattern(query: AgentGrepPattern) {
  if (typeof query.pattern !== 'string' || !query.pattern || [...query.pattern].length > 256 || /[\r\n\0]/u.test(query.pattern)
    || Buffer.from(query.pattern).toString('utf8') !== query.pattern) {
    throw new AgentGrepError('INVALID_PATTERN', 'pattern 必须为非空单行文本，最多 256 个 Unicode 字符');
  }
  if (query.mode !== undefined && query.mode !== 'literal' && query.mode !== 'regex') throw new AgentGrepError('UNSUPPORTED_CAPABILITY', '不支持该搜索 mode');
  if (query.regexProfile !== undefined && (query.regexProfile !== 'rust-regex-v1' || query.mode !== 'regex')) {
    throw new AgentGrepError('UNSUPPORTED_CAPABILITY', 'regexProfile 仅支持 regex 模式的 rust-regex-v1');
  }
}

export async function createAgentGrepMatcher(query: AgentGrepPattern, signal: AbortSignal,
  run: typeof runAgentRipgrep = runAgentRipgrep) {
  validateAgentGrepPattern(query);
  const regex = query.mode === 'regex';
  const folded = !regex && query.caseSensitive === false;
  const pattern = folded ? query.pattern.toLowerCase() : query.pattern;
  let engine: 'ripgrep' | 'literal-fallback' = 'ripgrep';
  try { parseRipgrep(await run('', pattern, { signal, regex, caseSensitive: regex ? query.caseSensitive : true }), [], [], folded); }
  catch (error) {
    if (!(error instanceof AgentGrepError) || error.code !== 'UNSUPPORTED_CAPABILITY' || regex) throw error;
    engine = 'literal-fallback';
  }
  return {
    engine, profile: regex ? 'rust-regex-v1' : 'literal-v1',
    caseFold: query.caseSensitive === false ? (regex ? 'rust-unicode-simple' : 'ecmascript-lowercase') : 'none',
    ...(engine === 'literal-fallback' ? { warning: '未找到 rg，使用相同 literal-v1 语义的内置匹配器' } : {}),
    async match(lines: string[], timeoutMs: number): Promise<Map<number, AgentGrepRange>> {
      signal.throwIfAborted();
      const normalized = folded ? lines.map(line => line.toLowerCase()) : lines;
      if (engine === 'ripgrep') return parseRipgrep(await run(normalized.length ? `${normalized.join('\n')}\n` : '', pattern,
        { signal, regex, caseSensitive: regex ? query.caseSensitive : true, timeoutMs }), lines, normalized, folded);
      const matches = new Map<number, AgentGrepRange>();
      for (let i = 0; i < lines.length; i += 1) {
        if (i % 256 === 0) signal.throwIfAborted();
        const at = normalized[i].indexOf(pattern);
        if (at >= 0) matches.set(i, { start: originalColumn(lines[i], at, folded, false), end: originalColumn(lines[i], at + pattern.length, folded, true) });
      }
      return matches;
    },
  };
}

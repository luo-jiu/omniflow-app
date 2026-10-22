import { AGENT_FILE_TEXT_MAX_BYTES, AgentFileMutationError, hasAgentFileBinaryControls } from './agent-file-write';
import { AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS } from './agent-file-patch-input';
import { AgentFilePatchError, type AgentFileFinalNewline, type AgentFilePatchExecutionOptions,
  type AgentFilePatchResult, type AgentFilePatchSpec } from './agent-file-patch-types';

interface ContextLine { kind: ' ' | '+' | '-'; text: string }
interface ContextHunk { lines: ContextLine[]; patchLine: number; eof: boolean }
interface SourceLine { text: string; ending: string; start: number; end: number }
interface Replacement { start: number; count: number; added: string[] }
interface CandidateSearch { candidates: number[]; truncated: boolean; suggestedLine?: number }
const OFFSET_CHUNK = 16_384;
const YIELD_WORK = 65_536;
const MAX_SCAN_WORK = 64 * 1024 * 1024;
const MAX_CANDIDATES = 5;
const LINE_SCAN_CHUNK = 16_384;

function invalid(message: string, patchLine?: number, hunkIndex?: number): never {
  throw new AgentFilePatchError(message, { code: 'INVALID_PATCH', phase: 'parse', patchLine, hunkIndex, nextAction: 'fix_input' });
}

/** Pure syntax preflight; source text and filesystem access are deliberately absent. */
export function parseAgentContextPatch(patch: string): ContextHunk[] {
  if (typeof patch !== 'string' || !patch || patch.length > AGENT_FILE_CONTEXT_PATCH_MAX_CHARACTERS
    || hasAgentFileBinaryControls(patch)) invalid('context-v1 补丁必须为非空文本，最多32000字符');
  if (new TextDecoder().decode(new TextEncoder().encode(patch)) !== patch) invalid('补丁包含无法编码为 UTF-8 的字符');
  const lines = patch.replace(/\r\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hunks: ContextHunk[] = [];
  let current: ContextHunk | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes('\r')) invalid('补丁请使用 LF 或 CRLF 行分隔符', index + 1, hunks.length || undefined);
    if (line === '@@') {
      current = { lines: [], eof: false, patchLine: index + 1 };
      hunks.push(current);
    } else if (!current) invalid('context-v1 必须以单独的 @@ 行开始，不接受文件 header 或跳转锚点', index + 1);
    else if (line === '*** End of File') {
      if (!current.lines.length || current.eof) invalid('EOF 约束必须紧跟当前 hunk 的正文', index + 1, hunks.length);
      current.eof = true;
    } else {
      if (current.eof) invalid('EOF 约束后只能开始下一个 @@ hunk', index + 1, hunks.length);
      const kind = line[0];
      if (kind !== ' ' && kind !== '+' && kind !== '-') invalid('正文行必须以空格、+ 或 - 开始；定位使用连续上下文', index + 1, hunks.length);
      current.lines.push({ kind, text: line.slice(1) });
    }
  }
  if (!hunks.length) invalid('补丁缺少 @@ hunk');
  for (let index = 0; index < hunks.length; index++) {
    if (!hunks[index].lines.some(line => line.kind !== ' ')) {
      invalid('每个 hunk 必须包含实际增删行', hunks[index].patchLine, index + 1);
    }
  }
  return hunks;
}

class ScanBudget {
  private work = 0;
  private sinceYield = 0;
  readonly deadline: number;
  readonly maximum: number;
  constructor(readonly options: AgentFilePatchExecutionOptions) {
    this.deadline = options.deadlineMs ?? Date.now() + 10_000;
    this.maximum = options.maxScanWork ?? MAX_SCAN_WORK;
    if (!Number.isFinite(this.deadline) || !Number.isSafeInteger(this.maximum) || this.maximum < 0) {
      invalid('补丁执行预算无效');
    }
    this.check();
  }
  check() {
    this.options.signal?.throwIfAborted();
    if (Date.now() >= this.deadline) throw new AgentFilePatchError('补丁定位超过本次时间预算，未修改', {
      code: 'PATCH_SCAN_TIMEOUT', phase: 'match', nextAction: 'reduce_patch',
    });
  }
  consume(amount: number): boolean {
    this.work += amount;
    this.sinceYield += amount;
    if (this.work > this.maximum) throw new AgentFilePatchError('补丁定位超过本次扫描预算，未修改；请补充更明确的上下文或拆分修改', {
      code: 'PATCH_SCAN_LIMIT', phase: 'match', nextAction: 'reduce_patch',
    });
    if (this.sinceYield < YIELD_WORK) return false;
    this.sinceYield = 0;
    this.check();
    return true;
  }
}

/** Decode bounded native chunks; validation of a single long line must also yield. */
function* decodeSource(bytes: Uint8Array, budget: ScanBudget): Generator<void, string, void> {
  if (bytes.byteLength > AGENT_FILE_TEXT_MAX_BYTES) throw new AgentFileMutationError('FILE_TOO_LARGE', '文本超过 8 MiB 修改上限');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += LINE_SCAN_CHUNK) {
    const end = Math.min(bytes.byteLength, offset + LINE_SCAN_CHUNK);
    if (budget.consume(end - offset)) { yield; budget.check(); }
    let part: string;
    try { part = decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.byteLength }); }
    catch { throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持有效 UTF-8 文本文件'); }
    for (let index = 0; index < part.length; index++) {
      if (budget.consume(1)) { yield; budget.check(); }
      const code = part.charCodeAt(index);
      if (code <= 8 || (code >= 14 && code <= 31)) {
        throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持修改 UTF-8 文本，不支持二进制文件');
      }
    }
    parts.push(part);
  }
  const text = parts.join('');
  if (text.slice(text.startsWith('\uFEFF') ? 1 : 0, text.startsWith('\uFEFF') ? 6 : 5) === '%PDF-') {
    throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持修改 UTF-8 文本，不支持二进制文件');
  }
  budget.check();
  return text;
}

/** Compact offsets cost four bytes per logical line, without retaining millions of line objects. */
class SourceText {
  private chunks: Uint32Array[] = [];
  count = 0;
  constructor(readonly text: string) {}
  add(start: number) {
    const chunk = Math.floor(this.count / OFFSET_CHUNK);
    this.chunks[chunk] ??= new Uint32Array(OFFSET_CHUNK);
    this.chunks[chunk][this.count % OFFSET_CHUNK] = start;
    this.count++;
  }
  offset(index: number): number {
    return index === this.count ? this.text.length : this.chunks[Math.floor(index / OFFSET_CHUNK)][index % OFFSET_CHUNK];
  }
  line(index: number): SourceLine {
    const start = this.offset(index);
    const end = this.offset(index + 1);
    let contentEnd = end;
    if (this.text[end - 1] === '\n') contentEnd -= this.text[end - 2] === '\r' ? 2 : 1;
    else if (this.text[end - 1] === '\r') contentEnd--;
    return { start, end, text: this.text.slice(start, contentEnd), ending: this.text.slice(contentEnd, end) };
  }
}

function* indexSource(text: string, budget: ScanBudget): Generator<void, SourceText, void> {
  const source = new SourceText(text);
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\r' || text[index] === '\n') {
      source.add(start);
      if (text[index] === '\r' && text[index + 1] === '\n') index++;
      start = index + 1;
    }
    if (budget.consume(1)) yield;
  }
  if (start < text.length) source.add(start);
  return source;
}

function* contextEnd(value: string, budget: ScanBudget): Generator<void, number, void> {
  let end = value.length;
  while (end > 0) {
    if (budget.consume(1)) { yield; budget.check(); }
    const code = value.charCodeAt(end - 1);
    if (code !== 32 && code !== 9) break;
    end--;
  }
  return end;
}

function* sameLine(actual: string, expected: ContextLine, lenient: boolean,
  budget: ScanBudget): Generator<void, boolean, void> {
  const tolerant = lenient && expected.kind === ' ';
  const actualEnd = tolerant ? yield* contextEnd(actual, budget) : actual.length;
  const expectedEnd = tolerant ? yield* contextEnd(expected.text, budget) : expected.text.length;
  if (budget.consume(1)) { yield; budget.check(); }
  if (actualEnd !== expectedEnd) return false;
  for (let offset = 0; offset < actualEnd; offset += LINE_SCAN_CHUNK) {
    const end = Math.min(actualEnd, offset + LINE_SCAN_CHUNK);
    if (budget.consume((end - offset) * 2)) { yield; budget.check(); }
    // String equality is native work, bounded here rather than applied to an 8 MiB line.
    if (actual.slice(offset, end) !== expected.text.slice(offset, end)) return false;
  }
  return true;
}

function* findCandidates(source: SourceText, hunk: ContextHunk, minimum: number,
  lenient: boolean, budget: ScanBudget): Generator<void, CandidateSearch, void> {
  const old = hunk.lines.filter(line => line.kind !== '+');
  if (!old.length) return { candidates: [source.count], truncated: false };
  // A long anchor is a cheap filter. Complete old-side comparison still decides every match.
  let anchor = 0;
  for (let index = 1; index < old.length; index++) if (old[index].text.length > old[anchor].text.length) anchor = index;
  const candidates: number[] = [];
  let suggestedLine: number | undefined;
  const last = source.count - old.length;
  const first = hunk.eof ? Math.max(minimum, last) : minimum;
  for (let start = first; start <= last; start++) {
    const anchorText = source.line(start + anchor).text;
    if (budget.consume(1)) { yield; budget.check(); }
    if (!(yield* sameLine(anchorText, old[anchor], lenient, budget))) continue;
    suggestedLine ??= start + 1;
    let matches = true;
    for (let offset = 0; offset < old.length; offset++) {
      if (offset === anchor) continue;
      const actual = source.line(start + offset).text;
      if (!(yield* sameLine(actual, old[offset], lenient, budget))) { matches = false; break; }
    }
    if (matches) {
      candidates.push(start);
      if (candidates.length > MAX_CANDIDATES) return { candidates, truncated: true, suggestedLine };
    }
  }
  return { candidates, truncated: false, suggestedLine };
}

function lastEnding(text: string): string {
  const position = Math.max(text.lastIndexOf('\r'), text.lastIndexOf('\n'));
  if (position < 0) return '';
  return text[position] === '\n' && text[position - 1] === '\r' ? '\r\n' : text[position];
}
const hasEnding = (text: string) => /[\r\n]$/u.test(text);

/** EOF rules operate on logical content, never on the independently retained BOM. */
export function finalizeAgentFilePatchText(before: string, after: string, policy: AgentFileFinalNewline): { text: string; warnings: string[] } {
  if (policy === 'ensure' && after && !hasEnding(after)) after += lastEnding(after) || lastEnding(before) || '\n';
  if (policy === 'remove' && after && hasEnding(after)) {
    const ending = lastEnding(after);
    const prefix = after.slice(0, -ending.length);
    if (!prefix || hasEnding(prefix)) throw new AgentFilePatchError('末行是空行，移除尾换行会丢失该行；请明确删除空行后重新修改，文件未提交', {
      code: 'PATCH_FINAL_NEWLINE_CONFLICT', phase: 'finalize', nextAction: 'fix_input',
    });
    after = prefix;
  }
  return { text: after, warnings: policy === 'preserve' && hasEnding(before) !== hasEnding(after)
    ? ['EOF_STATE_CHANGED_BY_STRUCTURE'] : [] };
}

function planHunk(hunk: ContextHunk, start: number): Replacement[] {
  const replacements: Replacement[] = [];
  let cursor = start;
  let pending: Replacement | undefined;
  const flush = () => { if (pending) replacements.push(pending); pending = undefined; };
  for (const line of hunk.lines) {
    if (line.kind === ' ') { flush(); cursor++; }
    else {
      pending ??= { start: cursor, count: 0, added: [] };
      if (line.kind === '-') { pending.count++; cursor++; }
      else pending.added.push(line.text);
    }
  }
  flush();
  return replacements;
}

function rebuild(source: SourceText, replacements: Replacement[], budget: ScanBudget): string {
  const parts: string[] = [];
  let previousEndingMutable = false;
  const append = (value: string, endingMutable: boolean) => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.endsWith('\r') && value.startsWith('\n')) {
      // Separate logical CR and LF endings must not turn into one CRLF across a splice.
      // Only generated endings may change: prefer extending the preceding CR to CRLF,
      // otherwise extend a newly added empty line's LF to CRLF. Retained bytes stay exact.
      if (previousEndingMutable) parts[parts.length - 1] += '\n';
      else if (endingMutable) value = '\r' + value;
      else throw new AgentFilePatchError('保留行的 CR 与 LF 换行在修改边界会合并并丢失空行；请将相邻行纳入修改后重试，文件未提交', {
        code: 'PATCH_LINE_ENDING_CONFLICT', phase: 'finalize', nextAction: 'fix_input',
      });
    }
    parts.push(value);
    previousEndingMutable = endingMutable;
  };
  const total = source.count + replacements.reduce((sum, replacement) => sum + replacement.added.length - replacement.count, 0);
  let sourceCursor = 0;
  let outputLines = 0;
  const fallbackEnding = lastEnding(source.text) || '\n';
  const nearbyEnding = (line: number) => (line < source.count ? source.line(line).ending : '')
    || (line > 0 ? source.line(line - 1).ending : '') || fallbackEnding;
  const copyUntil = (line: number) => {
    if (line <= sourceCursor) return;
    const chunk = source.text.slice(source.offset(sourceCursor), source.offset(line));
    outputLines += line - sourceCursor;
    append(chunk, false);
    if (chunk && !hasEnding(chunk) && outputLines < total) append(nearbyEnding(line), true);
    sourceCursor = line;
  };
  for (const replacement of replacements) {
    copyUntil(replacement.start);
    const local = nearbyEnding(replacement.start);
    for (let index = 0; index < replacement.added.length; index++) {
      const text = replacement.added[index];
      let ending = index < replacement.count ? source.line(replacement.start + index).ending : local;
      const lastAdded = index === replacement.added.length - 1;
      if (lastAdded && replacement.start + replacement.count === source.count && source.count) {
        ending = source.line(source.count - 1).ending;
      }
      outputLines++;
      if (!ending && (outputLines < total || !text)) ending = local;
      append(text + ending, true);
    }
    sourceCursor = replacement.start + replacement.count;
  }
  copyUntil(source.count);
  budget.check();
  return parts.join('');
}

function* applyContextSteps(before: Uint8Array, input: AgentFilePatchSpec,
  options: AgentFilePatchExecutionOptions): Generator<void, AgentFilePatchResult, void> {
  const budget = new ScanBudget(options);
  const hunks = parseAgentContextPatch(input.patch);
  const decoded = yield* decodeSource(before, budget);
  const bom = decoded.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = bom ? decoded.slice(1) : decoded;
  const source = yield* indexSource(text, budget);
  const replacements: Replacement[] = [];
  let cursor = 0;
  let matchMode: AgentFilePatchResult['matchMode'] = 'exact';
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index];
    let found = yield* findCandidates(source, hunk, cursor, false, budget);
    if (!found.candidates.length && hunk.lines.some(line => line.kind === ' ')) {
      found = yield* findCandidates(source, hunk, cursor, true, budget);
      if (found.candidates.length) matchMode = 'context-trailing-whitespace';
    }
    const oldCount = hunk.lines.filter(line => line.kind !== '+').length;
    if (found.candidates.length !== 1) {
      const ambiguous = found.candidates.length > 1;
      throw new AgentFilePatchError(ambiguous
        ? '补丁上下文存在多个匹配位置，未修改；请增加连续上下文后重试'
        : '补丁上下文未匹配当前文件，未修改；请读取真实上下文后重试', {
        code: ambiguous ? 'PATCH_CONTEXT_AMBIGUOUS' : 'PATCH_CONTEXT_MISMATCH', phase: 'match',
        hunkIndex: index + 1, patchLine: hunk.patchLine, nextAction: 'read_context',
        ...(ambiguous ? { candidateRanges: found.candidates.slice(0, MAX_CANDIDATES).map(start => ({ startLine: start + 1,
          endLine: start + oldCount })), candidatesTruncated: found.truncated } : {}),
        ...(found.suggestedLine ? { suggestedRead: { offset: Math.max(1, found.suggestedLine - 3), limit: Math.min(30, oldCount + 6) } } : {}),
      });
    }
    const start = found.candidates[0];
    replacements.push(...planHunk(hunk, start));
    cursor = start + oldCount;
  }
  const finalized = finalizeAgentFilePatchText(text, rebuild(source, replacements, budget), input.finalNewline ?? 'preserve');
  const output = bom + finalized.text;
  const bytes = new TextEncoder().encode(output);
  if (bytes.byteLength > AGENT_FILE_TEXT_MAX_BYTES) throw new AgentFilePatchError('补丁结果超过 8 MiB 修改上限，未修改', {
    code: 'FILE_TOO_LARGE', phase: 'finalize', nextAction: 'reduce_patch',
  });
  budget.check();
  return { bytes, additions: hunks.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === '+').length, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === '-').length, 0),
    hunks: hunks.length, changed: decoded !== output, matchMode, warnings: finalized.warnings, endsWithNewline: hasEnding(finalized.text) };
}

export function applyAgentContextPatch(before: Uint8Array, input: AgentFilePatchSpec,
  options: AgentFilePatchExecutionOptions = {}): AgentFilePatchResult {
  const steps = applyContextSteps(before, input, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export async function applyAgentContextPatchAsync(before: Uint8Array, input: AgentFilePatchSpec,
  options: AgentFilePatchExecutionOptions = {}): Promise<AgentFilePatchResult> {
  const steps = applyContextSteps(before, input, options);
  const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  let next = steps.next();
  while (!next.done) {
    await yieldControl();
    options.signal?.throwIfAborted();
    next = steps.next();
  }
  return next.value;
}

import {
  AGENT_FILE_TEXT_MAX_BYTES, AgentFileMutationError,
} from './agent-file-write';
import { decodeAgentMutableText } from './agent-file-text-codec';
import { applyAgentContextPatch, applyAgentContextPatchAsync, parseAgentContextPatch } from './agent-file-context-patch';
import { AgentFilePatchError, type AgentFilePatchSpec, type AgentFilePatchResult, type AgentFilePatchExecutionOptions } from './agent-file-patch-types';

export { decodeAgentMutableText } from './agent-file-text-codec';
export * from './agent-file-patch-input';
export * from './agent-file-patch-types';

interface TextLine { text: string; ending: string; end: number }
interface PatchLine { kind: ' ' | '+' | '-'; text: string; noNewline: boolean }
interface PatchHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: PatchLine[] }

function patchError(message: string): never { throw new AgentFileMutationError('INVALID_PATCH', message); }

function parsePatch(patch: string, targetPath: string): PatchHunk[] {
  const lines = patch.replace(/\r\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.some(line => line.includes('\r'))) patchError('补丁请使用 LF 或 CRLF 行分隔符');
  let index = 0;
  if (lines[0]?.startsWith('--- ')) {
    const before = lines[index++].slice(4);
    const after = lines[index++]?.startsWith('+++ ') ? lines[index - 1].slice(4) : undefined;
    const relative = targetPath.replace(/^\//u, '');
    if (!((before === targetPath && after === targetPath)
      || (before === `a/${relative}` && after === `b/${relative}`))) {
      patchError('补丁 header 必须指向结构化参数中的同一文件，不能创建、删除或切换目标');
    }
  }
  const hunks: PatchHunk[] = [];
  while (index < lines.length) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(lines[index++]);
    if (!match) patchError('补丁必须由标准 @@ 行号 hunk 组成，不能包含其他文件或命令');
    const numbers = [match[1], match[2] ?? '1', match[3], match[4] ?? '1'].map(Number);
    if (numbers.some(value => !Number.isSafeInteger(value) || value < 0)) patchError('补丁行号无效');
    const [oldStart, oldCount, newStart, newCount] = numbers;
    if ((!oldStart && oldCount) || (!newStart && newCount) || (!oldCount && !newCount)) patchError('补丁行范围无效');
    const body: PatchLine[] = [];
    let consumed = 0;
    let produced = 0;
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++];
      if (line === '\\ No newline at end of file') {
        if (!body.length || body.at(-1)!.noNewline) patchError('无尾换行标记必须紧跟对应正文行');
        body.at(-1)!.noNewline = true;
        continue;
      }
      const kind = line[0];
      if (kind !== ' ' && kind !== '+' && kind !== '-') patchError('补丁正文行必须以空格、+ 或 - 开始');
      body.push({ kind, text: line.slice(1), noNewline: false });
      if (kind !== '+') consumed++;
      if (kind !== '-') produced++;
      if (consumed > oldCount || produced > newCount) patchError('补丁正文超出声明行范围');
    }
    if (consumed !== oldCount || produced !== newCount || !body.some(line => line.kind !== ' ')) {
      patchError('补丁正文与声明行范围不符或没有实际修改');
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
  }
  if (!hunks.length) patchError('补丁缺少 hunk');
  return hunks;
}

/** Exact line matching; untouched line endings/BOM are retained byte for byte for valid UTF-8. */
function* applyUnifiedSteps(before: Uint8Array, patch: string, targetPath: string,
  options: AgentFilePatchExecutionOptions = {}): Generator<void, {
  bytes: Uint8Array; additions: number; deletions: number; hunks: number;
}, void> {
  const deadline = options.deadlineMs ?? Date.now() + 10_000;
  let work = 0;
  let scanned = 0;
  const check = () => {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new AgentFilePatchError('补丁超过执行时间预算，未修改', {
      code: 'PATCH_SCAN_TIMEOUT', phase: 'match', nextAction: 'reduce_patch',
    });
  };
  check();
  const decoded = decodeAgentMutableText(before);
  const bom = decoded.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = bom ? decoded.slice(1) : decoded;
  const parsed = parsePatch(patch, targetPath);
  const output: string[] = [];
  const defaultEnding = /\r\n|\r|\n/u.exec(text)?.[0] || '\n';
  const endings = /\r\n|\r|\n/gu;
  let position = 0;
  let previousEnding = '';
  let outputCount = 0;
  let outputHasUnterminatedLine = false;
  // Stream source line boundaries. An 8 MiB file of empty lines must not retain millions of objects.
  const sourceLine = (): TextLine | undefined => {
    if (position >= text.length) return undefined;
    endings.lastIndex = position;
    const match = endings.exec(text);
    return match ? { text: text.slice(position, match.index), ending: match[0], end: match.index + match[0].length }
      : { text: text.slice(position), ending: '', end: text.length };
  };
  const append = (chunk: string, hasEnding: boolean) => {
    if (outputHasUnterminatedLine) patchError('无尾换行标记只能出现在结果文件末尾');
    output.push(chunk);
    outputHasUnterminatedLine = !hasEnding;
  };
  let cursor = 0;
  let additions = 0;
  let deletions = 0;
  for (const hunk of parsed) {
    const start = hunk.oldCount ? hunk.oldStart - 1 : hunk.oldStart;
    if (start < cursor) {
      throw new AgentFileMutationError('PATCH_CONTEXT_MISMATCH', '补丁范围重叠或超出当前文件，未修改');
    }
    if (start > cursor) {
      const copyStart = position;
      while (cursor < start) {
        const line = sourceLine();
        if (!line) throw new AgentFileMutationError('PATCH_CONTEXT_MISMATCH', '补丁范围超出当前文件，未修改');
        position = line.end;
        previousEnding = line.ending;
        cursor++;
        outputCount++;
        scanned += line.text.length + line.ending.length;
        if (scanned > (options.maxScanWork ?? 64 * 1024 * 1024)) throw new AgentFilePatchError('补丁超过扫描预算，未修改', {
          code: 'PATCH_SCAN_LIMIT', phase: 'match', nextAction: 'reduce_patch',
        });
        if (++work % 8_192 === 0) { check(); yield; }
      }
      append(text.slice(copyStart, position), Boolean(previousEnding));
    }
    const expectedNewStart = hunk.newCount ? outputCount + 1 : outputCount;
    if (hunk.newStart !== expectedNewStart) patchError('补丁的新旧行号不一致');
    const insertedEnding = sourceLine()?.ending || previousEnding || defaultEnding;
    for (const line of hunk.lines) {
      if (line.kind === '+') {
        append(line.text + (line.noNewline ? '' : insertedEnding), !line.noNewline);
        outputCount++;
        additions++;
      } else {
        const original = sourceLine();
        if (!original || original.text !== line.text || Boolean(original.ending) === line.noNewline) {
          throw new AgentFileMutationError('PATCH_CONTEXT_MISMATCH', '补丁上下文与当前文件不完全匹配，未修改');
        }
        position = original.end;
        previousEnding = original.ending;
        cursor++;
        scanned += original.text.length + original.ending.length;
        if (scanned > (options.maxScanWork ?? 64 * 1024 * 1024)) throw new AgentFilePatchError('补丁超过扫描预算，未修改', {
          code: 'PATCH_SCAN_LIMIT', phase: 'match', nextAction: 'reduce_patch',
        });
        if (++work % 8_192 === 0) { check(); yield; }
        if (line.kind === ' ') { append(original.text + original.ending, Boolean(original.ending)); outputCount++; }
        else deletions++;
      }
    }
  }
  if (position < text.length) append(text.slice(position), /[\r\n]$/u.test(text));
  const bytes = new TextEncoder().encode(bom + output.join(''));
  if (bytes.byteLength > AGENT_FILE_TEXT_MAX_BYTES) {
    throw new AgentFileMutationError('FILE_TOO_LARGE', '补丁结果超过 8 MiB 修改上限');
  }
  check();
  return { bytes, additions, deletions, hunks: parsed.length };
}

/** Existing strict unified-v1 API. Kept for old callers and historical fixtures. */
export function applyAgentFilePatch(before: Uint8Array, patch: string, targetPath: string): {
  bytes: Uint8Array; additions: number; deletions: number; hunks: number;
} {
  const steps = applyUnifiedSteps(before, patch, targetPath);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

function preflightError(error: unknown): never {
  if (error instanceof AgentFilePatchError) throw error;
  if (error instanceof AgentFileMutationError) throw new AgentFilePatchError(error.message, {
    code: error.code, phase: error.code === 'INVALID_PATCH' ? 'parse' : 'match',
    nextAction: error.code === 'INVALID_PATCH' ? 'fix_input' : 'read_context',
  });
  throw error;
}

export function preflightAgentFilePatch(input: AgentFilePatchSpec): void {
  try {
    if (input.format === 'context-v1') {
      if (input.finalNewline !== undefined && !['preserve', 'ensure', 'remove'].includes(input.finalNewline)) {
        throw new AgentFilePatchError('finalNewline 无效', { code: 'INVALID_PATCH', phase: 'parse', nextAction: 'fix_input' });
      }
      parseAgentContextPatch(input.patch);
    } else if (input.format === 'unified-v1' && input.finalNewline === undefined) parsePatch(input.patch, input.path);
    else throw new AgentFilePatchError('补丁格式或尾换行设置无效', { code: 'INVALID_PATCH', phase: 'parse', nextAction: 'fix_input' });
  } catch (error) { preflightError(error); }
}

function legacyResult(before: Uint8Array, result: ReturnType<typeof applyAgentFilePatch>): AgentFilePatchResult {
  return { ...result, changed: result.bytes.length !== before.length || result.bytes.some((byte, index) => byte !== before[index]),
    matchMode: 'exact', warnings: [], endsWithNewline: result.bytes.at(-1) === 10 || result.bytes.at(-1) === 13 };
}

/** Synchronous adapter for small fixtures. Production execution should use the cooperative async API. */
export function applyAgentFilePatchInput(before: Uint8Array, input: AgentFilePatchSpec,
  options: AgentFilePatchExecutionOptions = {}): AgentFilePatchResult {
  preflightAgentFilePatch(input);
  try {
    if (input.format === 'context-v1') return applyAgentContextPatch(before, input, options);
    const steps = applyUnifiedSteps(before, input.patch, input.path, options);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return legacyResult(before, next.value);
  } catch (error) { preflightError(error); }
}

export async function applyAgentFilePatchAsync(before: Uint8Array, input: AgentFilePatchSpec,
  options: AgentFilePatchExecutionOptions = {}): Promise<AgentFilePatchResult> {
  preflightAgentFilePatch(input);
  try {
    if (input.format === 'context-v1') return await applyAgentContextPatchAsync(before, input, options);
    const steps = applyUnifiedSteps(before, input.patch, input.path, options);
    const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    let next = steps.next();
    while (!next.done) { await yieldControl(); options.signal?.throwIfAborted(); next = steps.next(); }
    return legacyResult(before, next.value);
  } catch (error) { preflightError(error); }
}

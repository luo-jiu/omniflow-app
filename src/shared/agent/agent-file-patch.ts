import {
  AGENT_FILE_TEXT_MAX_BYTES, AgentFileMutationError, hasAgentFileBinaryControls,
  normalizeAgentFileExpectedRevision, normalizeAgentFileMutationTarget,
} from './agent-file-write';

export const AGENT_FILE_PATCH_MAX_CHARACTERS = 128_000;

export interface AgentFilePatchInput {
  scope: 'library' | 'host'; path: string; basePath?: string; view: 'saved'; revision: string;
  patch: string; format: 'unified-v1';
}

export function normalizeAgentFilePatchInput(value: unknown): AgentFilePatchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentFileMutationError('INVALID_INPUT', '补丁参数无效');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['scope', 'path', 'basePath', 'view', 'revision', 'expectedRevision', 'patch', 'format'].includes(key))
    || typeof input.patch !== 'string' || !input.patch || input.patch.length > AGENT_FILE_PATCH_MAX_CHARACTERS
    || hasAgentFileBinaryControls(input.patch) || (input.format !== undefined && input.format !== 'unified-v1')) {
    throw new AgentFileMutationError('INVALID_PATCH', '只支持单文件、严格上下文的 unified-v1 文本补丁（最多128000字符）');
  }
  return { ...normalizeAgentFileMutationTarget(input), revision: normalizeAgentFileExpectedRevision(input, true)!,
    patch: input.patch, format: 'unified-v1' };
}

interface TextLine { text: string; ending: string; end: number }
interface PatchLine { kind: ' ' | '+' | '-'; text: string; noNewline: boolean }
interface PatchHunk { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: PatchLine[] }

export function decodeAgentMutableText(bytes: Uint8Array): string {
  if (bytes.byteLength > AGENT_FILE_TEXT_MAX_BYTES) {
    throw new AgentFileMutationError('FILE_TOO_LARGE', '文本超过 8 MiB 修改上限');
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持有效 UTF-8 文本文件'); }
  if (text.replace(/^\uFEFF/u, '').startsWith('%PDF-') || hasAgentFileBinaryControls(text)) {
    throw new AgentFileMutationError('UNSUPPORTED_ENCODING', '只支持修改 UTF-8 文本，不支持二进制文件');
  }
  return text;
}

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
export function applyAgentFilePatch(before: Uint8Array, patch: string, targetPath: string): {
  bytes: Uint8Array; additions: number; deletions: number; hunks: number;
} {
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
  return { bytes, additions, deletions, hunks: parsed.length };
}

import { structuredPatch } from 'diff';
import { AGENT_DIFF_MAX_CHARACTERS, AGENT_DIFF_MAX_PAGES, AGENT_DIFF_MAX_SOURCE_LINES, AGENT_DIFF_PAGE_CHARACTERS,
  type AgentFileDiffComputation, type AgentFileDiffJob, type AgentFileDiffWorkerPage } from './agent-file-diff.types';

function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10 && ++count > AGENT_DIFF_MAX_SOURCE_LINES) return count;
  }
  return count;
}

function safeEnd(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return end < text.length && code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

function paginate(patch: string, pageLines: number): AgentFileDiffWorkerPage[] {
  if (!patch) return [{ patch: '', startLine: 0, endLine: 0, continuedFromPrevious: false, continuesOnNext: false }];
  const pages: AgentFileDiffWorkerPage[] = [];
  let start = 0, line = 1;
  while (start < patch.length && pages.length < AGENT_DIFF_MAX_PAGES) {
    const startLine = line;
    const hardEnd = safeEnd(patch, Math.min(patch.length, start + AGENT_DIFF_PAGE_CHARACTERS));
    let end = start, lines = 0;
    while (end < hardEnd) {
      const newline = patch.indexOf('\n', end);
      if (newline < 0 || newline >= hardEnd) { end = hardEnd; break; }
      end = newline + 1;
      line += 1;
      if (++lines >= pageLines) break;
    }
    const endsWithNewline = patch.charCodeAt(end - 1) === 10;
    pages.push({ patch: patch.slice(start, end), startLine, endLine: endsWithNewline ? line - 1 : line,
      continuedFromPrevious: start > 0 && patch.charCodeAt(start - 1) !== 10,
      continuesOnNext: end < patch.length && !endsWithNewline });
    start = end;
  }
  return pages;
}

/** Worker-only CPU work. No filesystem, database, Electron or renderer capabilities. */
export function computeAgentFileDiff(job: AgentFileDiffJob): AgentFileDiffComputation {
  if (!job || typeof job.before !== 'string' || typeof job.after !== 'string'
    || typeof job.beforeLabel !== 'string' || typeof job.afterLabel !== 'string'
    || job.beforeLabel.length > 8192 || job.afterLabel.length > 8192
    || Buffer.byteLength(job.before) > 8 * 1024 * 1024 || Buffer.byteLength(job.after) > 8 * 1024 * 1024
    || !Number.isSafeInteger(job.pageLines) || job.pageLines < 1 || job.pageLines > 500) throw new Error('差异计算输入无效');
  if (countLines(job.before) > AGENT_DIFF_MAX_SOURCE_LINES || countLines(job.after) > AGENT_DIFF_MAX_SOURCE_LINES) {
    return { pages: paginate('', job.pageLines), totalLines: 0, truncated: true,
      warning: '历史文件行数超过差异计算上限，原始快照仍保留' };
  }
  const result = structuredPatch(job.beforeLabel, job.afterLabel, job.before, job.after, undefined, undefined,
    { context: 3, timeout: 1500, maxEditLength: 20_000 });
  if (!result) return { pages: paginate('', job.pageLines), totalLines: 0, truncated: true,
    warning: '差异计算达到时间或编辑量上限，历史版本仍保留' };
  if (!result.hunks.length) return { pages: paginate('', job.pageLines), totalLines: 0, truncated: false };
  const chunks: string[] = [];
  let length = 0, truncated = false;
  const append = (text: string) => {
    const available = AGENT_DIFF_MAX_CHARACTERS - length;
    if (text.length > available) {
      const end = safeEnd(text, available);
      chunks.push(text.slice(0, end)); length += end; truncated = true;
      return false;
    }
    chunks.push(text); length += text.length;
    return true;
  };
  append(`--- ${result.oldFileName}\n+++ ${result.newFileName}\n`);
  outer: for (const hunk of result.hunks) {
    if (!append(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`)) break;
    for (const line of hunk.lines) if (!append(`${line}\n`)) break outer;
  }
  const pages = paginate(chunks.join(''), job.pageLines);
  const pageBudgetReached = pages.reduce((sum, page) => sum + page.patch.length, 0) < length;
  truncated ||= pageBudgetReached;
  return { pages, totalLines: pages.at(-1)?.endLine ?? 0, truncated,
    ...(truncated ? { warning: pageBudgetReached ? '差异分页数量达到上限，后续内容未展示' : '差异总展示量达到 4 Mi 字符上限，后续内容未展示' } : {}) };
}

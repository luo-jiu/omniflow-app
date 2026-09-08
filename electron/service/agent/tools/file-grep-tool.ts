import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import { assessFileScope, readAgentFileBytes } from './file-content-tool';
import { agentGlobProperty, createAgentFileGlob } from '../agent-file-glob';
import { decodeAgentText } from '../agent-text-reader';
import { searchAgentFiles, type AgentFileSearchEntry, type AgentFileSearchPage } from '../agent-file-search';
import { queryAgentHostFiles } from '../agent-host-file-query';
import { decodeSearchCursor, encodeSearchCursor, searchQueryHash } from '../agent-search-cursor';

interface GrepQuery {
  scope?: 'library' | 'host'; path: string; pattern: string; glob?: string;
  caseSensitive?: boolean; contextLines?: number; limit?: number; cursor?: string;
}
interface GrepCursor { page?: string; index: number; line: number; revision?: string; pageHash?: string; skipped: number }
interface ContextLine { line: number; text: string; truncated: boolean }
interface Match { path: string; nodeId?: number; line: number; text: string; textTruncated: boolean; revision: string; context: ContextLine[] }

async function resolveTarget(query: GrepQuery, context: AgentToolExecutionContext): Promise<AgentFileSearchEntry> {
  if (query.scope === 'host') {
    const result = await queryAgentHostFiles('stat', { path: query.path }, context.signal);
    if (!result.node) throw new Error('搜索路径无效');
    return result.node;
  }
  if (!context.readLibraryMetadata) throw new Error('当前运行时未接入资料库查询');
  const result = await context.readLibraryMetadata({ kind: 'resolve', path: query.path }, context.signal);
  if (!result.node || !result.node.path) throw new Error('搜索路径不存在或没有规范路径');
  return result.node;
}

function validateGrepQuery(query: GrepQuery) {
  if (!query.pattern || query.pattern.length > 256 || /[\r\n]/u.test(query.pattern)) throw new Error('pattern 必须为单行字面文本，最多 256 个字符');
  const limit = query.limit ?? 50;
  const around = query.contextLines ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(around) || around < 0 || around > 3) throw new Error('搜索条数或上下文行数无效');
  const matchGlob = createAgentFileGlob(query.glob);
  return { limit, around, matchGlob };
}

export async function grepAgentFiles(query: GrepQuery, context: AgentToolExecutionContext) {
  const { limit, around, matchGlob } = validateGrepQuery(query);
  const target = await resolveTarget(query, context);
  const path = target.path!;
  const hash = searchQueryHash([context.appContext.libraryId, query.scope ?? 'library', path,
    query.pattern, query.glob, query.caseSensitive ?? true, around]);
  let state = decodeSearchCursor<GrepCursor>(query.cursor, 'grep', hash)
    ?? { index: 0, line: 1, skipped: 0 };
  const matches: Match[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let files = 0, lines = 0, pages = 0, outputBytes = 0;
  const deadline = Date.now() + 15_000;
  const needle = query.caseSensitive === false ? query.pattern.toLowerCase() : query.pattern;
  const finish = (hasMore: boolean, stopReason?: string) => ({
    scope: query.scope ?? 'library', path, matches, skipped,
    scannedFiles: files, scannedLines: lines, skippedFiles: state.skipped,
    complete: !hasMore && state.skipped === 0, hasMore,
    ...(stopReason ? { stopReason } : {}),
    ...(hasMore ? { nextCursor: encodeSearchCursor('grep', hash, state) } : {}),
  });
  for (;;) {
    context.signal.throwIfAborted();
    if (++pages > 10 || Date.now() >= deadline) return finish(true, 'scan_budget');
    const page: AgentFileSearchPage = target.type === 'file'
      ? { entries: matchGlob(target.name + (target.ext && !target.name.toLowerCase().endsWith(`.${target.ext.toLowerCase()}`) ? `.${target.ext}` : '')) ? [target] : [], hasMore: false }
      : await searchAgentFiles({ scope: query.scope, path, glob: query.glob, nodeType: 'file', limit: 100, cursor: state.page }, context);
    const pageHash = searchQueryHash(page.entries.map(node => [node.id, node.path, node.fileSize, node.updatedAt]));
    if (state.pageHash && state.pageHash !== pageHash) throw new Error('待搜索文件列表已变化，请从第一页重新搜索');
    state.pageHash = pageHash;
    while (state.index < page.entries.length) {
      if (files >= 5 || Date.now() >= deadline || outputBytes >= 8_000) return finish(true, 'scan_budget');
      const node = page.entries[state.index];
      let decoded: ReturnType<typeof decodeAgentText>;
      files += 1;
      try {
        if (!node.path) throw new Error('节点缺少规范路径');
        decoded = decodeAgentText(await readAgentFileBytes({ scope: query.scope, path: node.path, nodeId: node.id }, context));
      } catch (error) {
        context.signal.throwIfAborted();
        if (state.revision) throw new Error('续搜文件当前不可读，不能跳过剩余内容；请重新搜索');
        const item = { path: node.path || node.name, reason: (error instanceof Error ? error.message : '文件不可读').slice(0, 200) };
        skipped.push(item); outputBytes += Buffer.byteLength(JSON.stringify(item)); state.skipped += 1;
        state.index += 1; state.line = 1;
        continue;
      }
      if (state.revision && state.revision !== decoded.revision) throw new Error('文件正文已变化，请从第一页重新搜索');
      state.revision = decoded.revision;
      for (let i = state.line - 1; i < decoded.lines.length; i += 1) {
        if (lines >= 20_000 || Date.now() >= deadline) return finish(true, 'scan_budget');
        if (i % 256 === 0) context.signal.throwIfAborted();
        const text = decoded.lines[i];
        const at = (query.caseSensitive === false ? text.toLowerCase() : text).indexOf(needle);
        lines += 1;
        if (at >= 0) {
          const start = Math.max(0, at - 80);
          const end = Math.min(text.length, Math.max(start + 320, at + query.pattern.length));
          const surrounding: ContextLine[] = [];
          for (let j = Math.max(0, i - around); j <= Math.min(decoded.lines.length - 1, i + around); j += 1) {
            if (j !== i) surrounding.push({ line: j + 1, text: decoded.lines[j].slice(0, 80), truncated: decoded.lines[j].length > 80 });
          }
          const item: Match = { path: node.path!, ...(node.id ? { nodeId: node.id } : {}), line: i + 1,
            text: text.slice(start, end), textTruncated: start > 0 || end < text.length, revision: decoded.revision, context: surrounding };
          const size = Buffer.byteLength(JSON.stringify(item));
          if (size > 8_000) throw new Error('单条匹配超出输出预算，请减少 contextLines 或缩小搜索范围');
          if (matches.length >= limit || outputBytes + size > 8_000) return finish(true, 'output_budget');
          matches.push(item); outputBytes += size;
        }
        state.line = i + 2;
      }
      state.index += 1; state.line = 1; state.revision = undefined;
    }
    if (!page.hasMore) return finish(false);
    if (!page.nextCursor || page.nextCursor === state.page) throw new Error('搜索分页没有前进');
    state = { page: page.nextCursor, index: 0, line: 1, skipped: state.skipped };
  }
}

export const fileGrepTool: AgentTool = {
  name: 'file.grep', risk: 'read', timeoutMs: 60_000,
  presentation: { groupKind: 'resource-read', operationKind: 'search' },
  validate(input) {
    try { validateGrepQuery(input as GrepQuery); return { ok: true }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : '搜索条件无效' }; }
  },
  assess(input, context) {
    const decision = assessFileScope(input, context);
    if (decision.behavior !== 'ask') return decision;
    const query = input as GrepQuery;
    return { ...decision, preview: { ...decision.preview, title: '搜索本机正文',
      description: '读取指定文件或目录内匹配的 UTF-8 文件并把脱敏搜索结果交给当前模型；目录会递归搜索。',
      details: [...(decision.preview.details || []), { label: '正文文本', value: query.pattern },
        { label: '文件模式', value: query.glob || '全部文件' }] } };
  },
  description: '搜索 UTF-8 文件正文的单行字面文本（不是正则或管道）。scope 默认 library，host 使用同一语法。path 可为文件或目录，目录递归搜索，可用 glob 筛文件。返回每条匹配行的路径、行号、正文片段、上下文和版本。每次最多扫描 5 文件/20000行，单文件最多8MiB。hasMore 时原条件加 nextCursor 续搜；skippedFiles>0 或 complete=false 不能宣称没有匹配。不可读、二进制和超限文件明确列入 skipped。游标在应用重启后失效。',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'pattern'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] }, path: { type: 'string', minLength: 1, maxLength: 2048 },
    pattern: { type: 'string', minLength: 1, maxLength: 256 }, glob: agentGlobProperty,
    caseSensitive: { type: 'boolean', description: '默认 true；false 时忽略大小写。' },
    contextLines: { type: 'integer', minimum: 0, maximum: 3 },
    limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string', maxLength: 4096 },
  } },
  async execute(input, context) {
    const data = await grepAgentFiles(input as GrepQuery, context);
    return { ok: true, data, message: `找到 ${data.matches.length} 条匹配行${data.hasMore ? '，还有未搜索内容' : ''}${data.skippedFiles ? '；有文件未能读取，结果不完整' : ''}` };
  },
};

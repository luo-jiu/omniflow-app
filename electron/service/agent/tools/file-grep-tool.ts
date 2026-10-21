import pathModule from 'node:path';
import type { AgentTool, AgentToolExecutionContext } from '../agent-tool-registry';
import { assessFileScope, readAgentFileBytes } from './file-content-tool';
import { agentGlobProperty, createAgentFileFilter } from '../agent-file-glob';
import { decodeAgentText } from '../agent-text-reader';
import { searchAgentFiles, type AgentFileSearchEntry, type AgentFileSearchPage } from '../agent-file-search';
import { queryAgentHostFiles } from '../agent-host-file-query';
import { decodeSearchCursor, encodeSearchCursor, searchQueryHash } from '../agent-search-cursor';
import { createAgentGrepMatcher, validateAgentGrepPattern, type AgentGrepPattern } from '../agent-grep-matcher';
import { AgentGrepError } from '../agent-ripgrep';
import { resolveAgentFileQuery } from '../agent-file-path-resolver';

interface GrepQuery extends AgentGrepPattern {
  scope?: 'library' | 'host'; path: string; basePath?: string; pattern: string; glob?: string;
  include?: string[]; exclude?: string[]; ignoreMode?: 'none';
  caseSensitive?: boolean; contextLines?: number; limit?: number; cursor?: string;
}
interface GrepCursor { page?: string; index: number; line: number; revision?: string; pageHash?: string; skipped: number }
interface ContextLine { line: number; text: string; truncated: boolean }
interface Match { path: string; nodeId?: number; line: number; column: number; endColumn: number; textColumn: number; text: string; textTruncated: boolean; revision: string; context: ContextLine[] }
const grepGlobList = { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 256 } };

function relativeCandidatePath(node: AgentFileSearchEntry, root: string, host: boolean) {
  if (!node.path) return undefined;
  if (host) {
    const relative = pathModule.relative(root, node.path);
    if (!relative || pathModule.isAbsolute(relative) || relative.split(pathModule.sep)[0] === '..') throw new Error('候选文件不在搜索目录内');
    return relative.split(pathModule.sep).join('/');
  }
  const prefix = root === '/' ? '/' : `${root.replace(/\/$/u, '')}/`;
  if (!node.path.startsWith(prefix) || node.path === root) throw new Error('候选文件不在搜索目录内');
  return node.path.slice(prefix.length);
}

function snippet(text: string, start: number, limit: number) {
  const selected: string[] = [];
  let column = 0;
  for (const character of text) {
    if (column >= start + limit) return { text: selected.join(''), truncated: true };
    if (column >= start) selected.push(character);
    column += 1;
  }
  return { text: selected.join(''), truncated: start > 0 };
}

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
  validateAgentGrepPattern(query);
  if (query.ignoreMode !== undefined && query.ignoreMode !== 'none') throw new AgentGrepError('UNSUPPORTED_CAPABILITY', '两种 scope 当前仅支持 ignoreMode=none，不读取 .gitignore/.ignore');
  const limit = query.limit ?? 50;
  const around = query.contextLines ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(around) || around < 0 || around > 3) throw new Error('搜索条数或上下文行数无效');
  const matchGlob = createAgentFileFilter(query);
  return { limit, around, matchGlob };
}

export async function grepAgentFiles(query: GrepQuery, context: AgentToolExecutionContext) {
  query = await resolveAgentFileQuery(query, context);
  const { limit, around, matchGlob } = validateGrepQuery(query);
  const matcher = await createAgentGrepMatcher(query, context.signal);
  const target = await resolveTarget(query, context);
  const path = target.path!;
  const hash = searchQueryHash([context.appContext.libraryId, query.scope ?? 'library', path,
    query.pattern, query.glob, query.include, query.exclude, query.mode ?? 'literal', query.regexProfile,
    query.ignoreMode ?? 'none', query.caseSensitive ?? true, around]);
  let state = decodeSearchCursor<GrepCursor>(query.cursor, 'grep', hash)
    ?? { index: 0, line: 1, skipped: 0 };
  const matches: Match[] = [];
  const skipped: { path: string; reason: string; code?: string }[] = [];
  let files = 0, lines = 0, pages = 0, outputBytes = 0, examinedEntries = 0, filteredEntries = 0;
  const enumerationEngines = new Set<string>();
  let candidateMetadataReads = 0;
  const deadline = Date.now() + 15_000;
  const finish = (hasMore: boolean, stopReason?: string) => ({
    scope: query.scope ?? 'library', path, matches, skipped,
    engine: matcher.engine, matchProfile: matcher.profile, caseFold: matcher.caseFold, ignoreMode: 'none' as const,
    columnUnit: 'unicode-code-point' as const,
    warnings: matcher.warning ? [matcher.warning] : [],
    coverage: { consistency: 'live' as const, examinedEntries, filteredEntries,
      candidateEnumeration: [...enumerationEngines], candidateMetadataReads },
    limits: { files: 50, lines: 20_000, candidatePages: 10, outputBytes: 8_000, fileBytes: 8 * 1024 * 1024 },
    scannedFiles: files, scannedLines: lines, skippedFiles: state.skipped,
    complete: !hasMore && state.skipped === 0, hasMore,
    ...(stopReason ? { stopReason } : {}),
    ...(hasMore ? { nextCursor: encodeSearchCursor('grep', hash, state) } : {}),
  });
  for (;;) {
    context.signal.throwIfAborted();
    if (++pages > 10 || Date.now() >= deadline) return finish(true, 'scan_budget');
    const page: AgentFileSearchPage = target.type === 'file'
      ? { entries: [target], hasMore: false }
      : await searchAgentFiles({ scope: query.scope, path, nodeType: 'file', limit: 100, cursor: state.page }, context);
    enumerationEngines.add(page.enumerationEngine ?? (target.type === 'file' ? 'single-file' : 'library-metadata'));
    candidateMetadataReads += page.metadataReads ?? 0;
    const pageHash = searchQueryHash(page.entries.map(node => [node.id, node.path, node.fileSize, node.updatedAt]));
    if (state.pageHash && state.pageHash !== pageHash) throw new Error('待搜索文件列表已变化，请从第一页重新搜索');
    state.pageHash = pageHash;
    while (state.index < page.entries.length) {
      if (files >= 50 || lines >= 20_000 || Date.now() >= deadline || outputBytes >= 8_000) return finish(true, 'scan_budget');
      const node = page.entries[state.index];
      examinedEntries += 1;
      const relativePath = target.type === 'file'
        ? node.name + (node.ext && !node.name.toLowerCase().endsWith(`.${node.ext.toLowerCase()}`) ? `.${node.ext}` : '')
        : relativeCandidatePath(node, path, query.scope === 'host');
      if (relativePath && !matchGlob(relativePath)) {
        filteredEntries += 1; state.index += 1; state.line = 1; state.revision = undefined;
        continue;
      }
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
      const firstLine = state.line - 1;
      const selected = decoded.lines.slice(firstLine, firstLine + 20_000 - lines);
      lines += selected.length;
      let found: Awaited<ReturnType<typeof matcher.match>>;
      try { found = await matcher.match(selected, Math.min(5_000, Math.max(1, deadline - Date.now()))); }
      catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof AgentGrepError) || error.code === 'INVALID_PATTERN' || error.code === 'UNSUPPORTED_CAPABILITY') throw error;
        const item = { path: node.path!, reason: error.message.slice(0, 200), code: error.code };
        skipped.push(item); outputBytes += Buffer.byteLength(JSON.stringify(item)); state.skipped += 1;
        state.index += 1; state.line = 1; state.revision = undefined;
        continue;
      }
      for (let i = state.line - 1; i < firstLine + selected.length; i += 1) {
        if (Date.now() >= deadline) return finish(true, 'scan_budget');
        if (i % 256 === 0) context.signal.throwIfAborted();
        const text = decoded.lines[i];
        const occurrence = found.get(i - firstLine);
        if (occurrence) {
          const start = Math.max(0, occurrence.start - 80);
          const matchedSnippet = snippet(text, start, 320);
          const surrounding: ContextLine[] = [];
          for (let j = Math.max(0, i - around); j <= Math.min(decoded.lines.length - 1, i + around); j += 1) {
            if (j !== i) surrounding.push({ line: j + 1, ...snippet(decoded.lines[j], 0, 80) });
          }
          const item: Match = { path: node.path!, ...(node.id ? { nodeId: node.id } : {}), line: i + 1,
            column: occurrence.start + 1, endColumn: occurrence.end + 1, textColumn: start + 1,
            text: matchedSnippet.text, textTruncated: matchedSnippet.truncated, revision: decoded.revision, context: surrounding };
          const size = Buffer.byteLength(JSON.stringify(item));
          if (size > 8_000) throw new Error('单条匹配超出输出预算，请减少 contextLines 或缩小搜索范围');
          if (matches.length >= limit || outputBytes + size > 8_000) return finish(true, 'output_budget');
          matches.push(item); outputBytes += size;
        }
        state.line = i + 2;
      }
      if (state.line <= decoded.lines.length) return finish(true, 'scan_budget');
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
  async assess(input, context) {
    const decision = await assessFileScope(input, context);
    if (decision.behavior !== 'ask') return decision;
    const query = input as GrepQuery;
    return { ...decision, preview: { ...decision.preview, title: '搜索本机正文',
      description: '读取指定文件或目录内匹配的 UTF-8 文件并把脱敏搜索结果交给当前模型；目录会递归搜索。',
      details: [...(decision.preview.details || []), { label: '正文文本', value: query.pattern },
        { label: '文件模式', value: query.glob || '全部文件' }] } };
  },
  description: 'Search UTF-8 saved text in a file or recursive directory. scope defaults to library; host has identical semantics. mode defaults to literal; regex uses rust-regex-v1 (no PCRE2/lookaround/backreferences/multiline). Missing rg: equivalent literal fallback, regex unavailable. Each matching line returns its first match, revision and context; column/endColumn are 1-based Unicode code points, end exclusive. include is OR; exclude wins; glob is an additional AND. ignoreMode=none ignores no files and follows no symlinks. Limits: 50 files/20000 lines/call, 8MiB/file. Continue hasMore with unchanged query + nextCursor. skippedFiles or complete=false means incomplete coverage.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'pattern'], properties: {
    scope: { type: 'string', enum: ['library', 'host'] }, path: { type: 'string', minLength: 1, maxLength: 2048 },
    basePath: { type: 'string', minLength: 1, maxLength: 2048 },
    pattern: { type: 'string', minLength: 1, maxLength: 256 }, glob: { ...agentGlobProperty,
      description: 'Common glob: * ** ? [abc]; case-insensitive, includes hidden. Relative to root; no / matches basename. No braces/extglob/!.' },
    include: grepGlobList, exclude: grepGlobList,
    mode: { type: 'string', enum: ['literal', 'regex'] },
    regexProfile: { type: 'string', enum: ['rust-regex-v1'] },
    ignoreMode: { type: 'string', enum: ['none'] },
    caseSensitive: { type: 'boolean', description: 'Default true; false: literal ECMAScript lowercase, regex Rust Unicode simple fold.' },
    contextLines: { type: 'integer', minimum: 0, maximum: 3 },
    limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string', maxLength: 4096 },
  } },
  async execute(input, context) {
    const data = await grepAgentFiles(input as GrepQuery, context);
    return { ok: true, data, message: `找到 ${data.matches.length} 条匹配行${data.hasMore ? '，还有未搜索内容' : ''}${data.skippedFiles ? '；有文件未能读取，结果不完整' : ''}` };
  },
};

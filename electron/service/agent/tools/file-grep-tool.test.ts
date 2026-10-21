import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { grepAgentFiles, fileGrepTool } from './file-grep-tool';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { createAgentToolRegistry } from '../agent-tool-registry';
import { resolveAgentRipgrepExecutable } from '../agent-ripgrep-executable';

function context(): AgentToolExecutionContext { return { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, onProgress() {}, signal: new AbortController().signal }; }
const hasRg = Boolean(await resolveAgentRipgrepExecutable());

describe('file.grep', () => {
  it.skipIf(!hasRg)('executes registered structured regex/include/exclude using bundled rg and real host files with no PATH', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-bundled-regex-'));
    const originalPath = process.env.PATH;
    try {
      await mkdir(path.join(dir, 'skip'));
      for (const name of ['.hidden.TXT', 'keep.txt', 'skip/a.txt', 'other.md']) {
        await writeFile(path.join(dir, name), 'before\r\n😀ΩΣ value\r\nafter');
      }
      await writeFile(path.join(dir, '.gitignore'), '*.txt\n.hidden.TXT\n');
      process.env.PATH = '';
      const registry = createAgentToolRegistry([fileGrepTool]);
      const query = { scope: 'host', path: dir, pattern: '\\p{Greek}+', mode: 'regex', regexProfile: 'rust-regex-v1',
        include: ['**/*.txt'], exclude: ['skip/**'], ignoreMode: 'none', contextLines: 0 };
      expect(registry.validateInput('file.grep', query).ok).toBe(true);
      const result = await registry.execute('file.grep', query, context());
      expect(result).toMatchObject({ ok: true, data: { engine: 'ripgrep', complete: true, hasMore: false, scannedFiles: 2,
        coverage: { candidateEnumeration: ['ripgrep-files'], filteredEntries: 3 },
        matches: [
          { path: path.join(dir, '.hidden.TXT'), line: 2, column: 2, endColumn: 4, text: '😀ΩΣ value' },
          { path: path.join(dir, 'keep.txt'), line: 2, column: 2, endColumn: 4, text: '😀ΩΣ value' },
        ] } });
    } finally { process.env.PATH = originalPath; await rm(dir, { recursive: true, force: true }); }
  });
  it('registers a strict schema and keeps host approval behavior', async () => {
    const registry = createAgentToolRegistry([fileGrepTool]);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', glob: '*.txt' }).ok).toBe(true);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', command: 'ls' }).ok).toBe(false);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', mode: 'regex', include: ['*.txt'], exclude: ['skip/**'], ignoreMode: 'none' }).ok).toBe(true);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', ignoreMode: 'git' }).ok).toBe(false);
    expect(await fileGrepTool.validate!({ path: '/tmp/a', pattern: 'x', include: ['../*'] }, context())).toMatchObject({ ok: false });
    expect(await fileGrepTool.assess!({ scope: 'host', path: '/tmp/a' }, context())).toMatchObject({ behavior: 'ask', risk: 'read' });
  });
  it('searches directories with glob, paginates matching lines without loss and reports binary skips', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-grep-'));
    try {
      await mkdir(path.join(dir, 'nested'));
      await writeFile(path.join(dir, 'nested', 'a.txt'), 'before\nneedle one\nneedle two\nafter\n');
      await writeFile(path.join(dir, 'nested', 'b.txt'), Buffer.from([0, 1, 2]));
      await writeFile(path.join(dir, 'ignored.md'), 'needle');
      const query = { scope: 'host' as const, path: dir, pattern: 'needle', glob: '**/*.txt', limit: 1, contextLines: 1 };
      const first = await grepAgentFiles(query, context());
      expect(first).toMatchObject({ matches: [{ line: 2, text: 'needle one' }], hasMore: true, complete: false });
      expect(first.matches[0].context).toContainEqual({ line: 1, text: 'before', truncated: false });
      const second = await grepAgentFiles({ ...query, cursor: first.nextCursor }, context());
      expect(second).toMatchObject({ matches: [{ line: 3, text: 'needle two' }], hasMore: false, complete: false, skippedFiles: 1 });
      expect(second.skipped[0].reason).toContain('二进制');
      await expect(grepAgentFiles({ ...query, pattern: 'changed', cursor: first.nextCursor }, context())).rejects.toThrow('游标');
      await writeFile(path.join(dir, 'nested', 'a.txt'), 'changed\nneedle');
      await expect(grepAgentFiles({ ...query, cursor: first.nextCursor }, context())).rejects.toThrow('变化');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('returns paths, line numbers and revisions for library text, and preserves incomplete coverage', async () => {
    const node = { id: 7, libraryId: 3, parentId: 9, name: 'a.txt', type: 'file' as const, path: '/a.txt' };
    const ctx = { ...context(), readLibraryMetadata: vi.fn(async () => ({ libraryId: 3, node })),
      readLibraryText: vi.fn(async () => Buffer.from('zero\nHELLO | world\nlast')) };
    const result = await grepAgentFiles({ path: '/a.txt', pattern: 'hello |', caseSensitive: false }, ctx);
    expect(result).toMatchObject({ matches: [{ path: '/a.txt', nodeId: 7, line: 2, text: 'HELLO | world' }], complete: true, hasMore: false });
    ctx.readLibraryText.mockRejectedValueOnce(new Error('源存储不可达'));
    const offline = await grepAgentFiles({ path: '/a.txt', pattern: 'hello' }, ctx);
    expect(offline).toMatchObject({ matches: [], complete: false, skippedFiles: 1, hasMore: false });
  });
  it('returns a continuation when scanning hits a line budget, even with no matches yet', async () => {
    const node = { id: 7, libraryId: 3, parentId: 9, name: 'a.txt', type: 'file' as const, path: '/a.txt' };
    const ctx = { ...context(), readLibraryMetadata: vi.fn(async () => ({ libraryId: 3, node })),
      readLibraryText: vi.fn(async () => Buffer.from('no\n'.repeat(20_000) + 'needle')) };
    const first = await grepAgentFiles({ path: '/a.txt', pattern: 'needle' }, ctx);
    expect(first).toMatchObject({ matches: [], hasMore: true, complete: false, stopReason: 'scan_budget' });
    const last = await grepAgentFiles({ path: '/a.txt', pattern: 'needle', cursor: first.nextCursor }, ctx);
    expect(last).toMatchObject({ matches: [{ line: 20_001 }], complete: true });
  });

  it('keeps skipped coverage across file-budget pages and centers long-line snippets on matches', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-grep-budget-'));
    try {
      await writeFile(path.join(dir, '0.txt'), Buffer.from([0]));
      for (let i = 1; i <= 50; i += 1) await writeFile(path.join(dir, `${String(i).padStart(3, '0')}.txt`), i >= 49 ? 'x'.repeat(4000) + 'needle' : 'no match');
      const query = { scope: 'host' as const, path: dir, pattern: 'needle', glob: '*.txt', contextLines: 0 };
      const first = await grepAgentFiles(query, context());
      expect(first).toMatchObject({ hasMore: true, complete: false, skippedFiles: 1, scannedFiles: 50, limits: { files: 50 } });
      expect(first.matches).toHaveLength(1);
      expect(first.matches[0]).toMatchObject({ textTruncated: true, line: 1 });
      expect(first.matches[0].text).toContain('needle');
      const second = await grepAgentFiles({ ...query, cursor: first.nextCursor }, context());
      expect(second).toMatchObject({ hasMore: false, complete: false, skippedFiles: 1 });
      expect(second.matches).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.skipIf(!hasRg)('shares regex positions and context across host/library, preserving CRLF and Unicode code-point columns', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-grep-regex-'));
    try {
      const text = 'before\r\n😀ΩΣ value\r\nafter';
      await writeFile(path.join(dir, 'a.txt'), text);
      const node = { id: 7, libraryId: 3, parentId: 9, name: 'a.txt', type: 'file' as const, path: '/a.txt' };
      const ctx = { ...context(), readLibraryMetadata: vi.fn(async () => ({ libraryId: 3, node })), readLibraryText: vi.fn(async () => Buffer.from(text)) };
      const options = { pattern: '\\p{Greek}+', mode: 'regex' as const, regexProfile: 'rust-regex-v1' as const, contextLines: 1 };
      const host = await grepAgentFiles({ ...options, path: path.join(dir, 'a.txt'), scope: 'host' }, context());
      const library = await grepAgentFiles({ ...options, path: '/a.txt' }, ctx);
      for (const result of [host, library]) {
        expect(result).toMatchObject({ engine: 'ripgrep', matchProfile: 'rust-regex-v1', columnUnit: 'unicode-code-point', complete: true,
          matches: [{ line: 2, column: 2, endColumn: 4, textColumn: 1, text: '😀ΩΣ value', context: [{ line: 1, text: 'before' }, { line: 3, text: 'after' }] }] });
      }
      expect(host.matches[0].revision).toBe(library.matches[0].revision);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('applies common include/exclude rules to hidden files without silently honoring gitignore', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-grep-globs-'));
    try {
      await mkdir(path.join(dir, 'skip'));
      for (const name of ['.hidden.TXT', 'keep.txt', 'skip/a.txt', 'other.md']) await writeFile(path.join(dir, name), 'needle');
      await writeFile(path.join(dir, '.gitignore'), '*.txt\n.hidden.TXT\n');
      const query = { pattern: 'needle', include: ['**/*.txt'], exclude: ['skip/**'], ignoreMode: 'none' as const };
      const host = await grepAgentFiles({ ...query, scope: 'host', path: dir }, context());
      expect(host.matches.map(item => path.basename(item.path))).toEqual(['.hidden.TXT', 'keep.txt']);
      expect(host).toMatchObject({ complete: true, scannedFiles: 2, coverage: { filteredEntries: 3 } });
      const files = ['.hidden.TXT', 'keep.txt', 'skip/a.txt', 'other.md'].map((name, index) => ({ id: index + 10, libraryId: 3, parentId: 9,
        name: name.split('/').at(-1)!, type: 'file' as const, path: `/${name}` }));
      const root = { id: 9, libraryId: 3, parentId: 0, name: '/', type: 'dir' as const, path: '/' };
      const ctx: AgentToolExecutionContext = { ...context(), readLibraryMetadata: vi.fn(async input => input.kind === 'search'
        ? { libraryId: 3, entries: files, hasMore: false } : { libraryId: 3,
          node: input.path === '/' ? root : files.find(file => file.path === input.path || file.id === input.nodeId) }), readLibraryText: vi.fn(async () => Buffer.from('needle')) };
      const library = await grepAgentFiles({ ...query, path: '/' }, ctx);
      expect(library.matches.map(item => item.path)).toEqual(['/.hidden.TXT', '/keep.txt']);
      expect(library).toMatchObject({ complete: true, scannedFiles: 2, coverage: { filteredEntries: 2 } });
      await expect(grepAgentFiles({ ...query, path: '/', exclude: ['../*'] }, ctx)).rejects.toThrow('glob');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('continues through a filtered candidate page and binds the cursor to new filters', async () => {
    const root = { id: 9, libraryId: 3, parentId: 0, name: '/', type: 'dir' as const, path: '/' };
    const file = { id: 10, libraryId: 3, parentId: 9, name: 'match.txt', type: 'file' as const, path: '/match.txt' };
    const ctx: AgentToolExecutionContext = { ...context(), readLibraryMetadata: vi.fn(async input => {
      if (input.kind !== 'search') return { libraryId: 3, node: input.path === '/' ? root : file };
      return input.cursor ? { libraryId: 3, entries: [file], hasMore: false }
        : { libraryId: 3, entries: [{ ...file, id: 11, name: 'skip.md', path: '/skip.md' }], hasMore: true, nextCursor: 'page2' };
    }), readLibraryText: vi.fn(async () => Buffer.from('needle\nneedle')) };
    const query = { path: '/', pattern: 'needle', include: ['*.txt'], limit: 1 };
    const result = await grepAgentFiles(query, ctx);
    expect(result).toMatchObject({ matches: [{ path: '/match.txt', line: 1 }], hasMore: true, coverage: { filteredEntries: 1 } });
    await expect(grepAgentFiles({ ...query, exclude: ['skip/*'], cursor: result.nextCursor }, ctx)).rejects.toThrow('游标');
    const last = await grepAgentFiles({ ...query, cursor: result.nextCursor }, ctx);
    expect(last).toMatchObject({ matches: [{ line: 2 }], hasMore: false, complete: true });
  });
});

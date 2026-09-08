import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { grepAgentFiles, fileGrepTool } from './file-grep-tool';
import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { createAgentToolRegistry } from '../agent-tool-registry';

function context(): AgentToolExecutionContext { return { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, onProgress() {}, signal: new AbortController().signal }; }

describe('file.grep', () => {
  it('registers a strict schema and keeps host approval behavior', async () => {
    const registry = createAgentToolRegistry([fileGrepTool]);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', glob: '*.txt' }).ok).toBe(true);
    expect(registry.validateInput('file.grep', { path: '/tmp/a', pattern: 'x', command: 'ls' }).ok).toBe(false);
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
      for (let i = 1; i <= 5; i += 1) await writeFile(path.join(dir, `${i}.txt`), 'x'.repeat(4000) + 'needle');
      const query = { scope: 'host' as const, path: dir, pattern: 'needle', glob: '*.txt', contextLines: 0 };
      const first = await grepAgentFiles(query, context());
      expect(first).toMatchObject({ hasMore: true, complete: false, skippedFiles: 1, scannedFiles: 5 });
      expect(first.matches).toHaveLength(4);
      expect(first.matches[0]).toMatchObject({ textTruncated: true, line: 1 });
      expect(first.matches[0].text).toContain('needle');
      const second = await grepAgentFiles({ ...query, cursor: first.nextCursor }, context());
      expect(second).toMatchObject({ hasMore: false, complete: false, skippedFiles: 1 });
      expect(second.matches).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

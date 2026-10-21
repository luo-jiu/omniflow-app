import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryAgentHostFiles } from './agent-host-file-query';

describe('host file metadata', () => {
  it('filters before file metadata I/O and keeps native/fallback Unicode and hidden semantics equal', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-query-native-'));
    const signal = new AbortController().signal;
    try {
      await mkdir(path.join(dir, '文档'));
      for (const name of ['a.TXT', '.hidden.txt', '文档/😀.txt', 'other.md', '.gitignore']) await writeFile(path.join(dir, name), 'fixture');
      if (process.platform !== 'win32') {
        await symlink(path.join(dir, '文档'), path.join(dir, 'linked-dir'));
        await symlink(path.join(dir, 'other.md'), path.join(dir, 'linked.txt'));
      }
      const query = { path: dir, glob: '*.txt', nodeType: 'file', limit: 1 };
      const fallback = await queryAgentHostFiles('search', query, signal, { executable: 'omniflow-no-such-rg-fixture' });
      const native = await queryAgentHostFiles('search', query, signal);
      if (!('entries' in native) || !('entries' in fallback)) throw new Error('expected directory results');
      expect(native).toMatchObject({ entries: [{ name: '.hidden.txt' }], hasMore: true,
        examinedEntries: 5, filteredEntries: 2, metadataReads: 4 });
      expect(native.entries).toEqual(fallback.entries);
      expect(native.nextCursor).toBe(fallback.nextCursor);
      await writeFile(path.join(dir, 'new.txt'), 'new');
      await expect(queryAgentHostFiles('search', { ...query, cursor: native.nextCursor }, signal)).rejects.toThrow('已变化');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('paginates, searches descendants, and rejects stale cursors and library IDs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-query-'));
    const signal = new AbortController().signal;
    try {
      await writeFile(path.join(dir, 'a.txt'), 'a');
      await mkdir(path.join(dir, 'child'));
      await writeFile(path.join(dir, 'child', 'b.txt'), 'b');
      const first = await queryAgentHostFiles('list', { path: dir, limit: 1 }, signal);
      if (!('nextCursor' in first)) throw new Error('expected paginated response');
      expect(first).toMatchObject({ hasMore: true, entries: [{ name: 'a.txt' }] });
      const next = await queryAgentHostFiles('list', { path: dir, cursor: first.nextCursor }, signal);
      expect(next).toMatchObject({ hasMore: false, entries: [{ name: 'child' }] });
      const found = await queryAgentHostFiles('search', { path: dir, keyword: 'b.txt' }, signal);
      expect(found).toMatchObject({ entries: [{ name: 'b.txt' }] });
      await writeFile(path.join(dir, 'new.txt'), 'n');
      await expect(queryAgentHostFiles('list', { path: dir, cursor: first.nextCursor }, signal)).rejects.toThrow('已变化');
      await expect(queryAgentHostFiles('list', { path: dir, nodeId: 3 }, signal)).rejects.toThrow('资料库 ID');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

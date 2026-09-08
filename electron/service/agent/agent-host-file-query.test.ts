import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryAgentHostFiles } from './agent-host-file-query';

describe('host file metadata', () => {
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

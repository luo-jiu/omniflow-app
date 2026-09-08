import { describe, expect, it, vi } from 'vitest';
import { searchAgentFiles } from './agent-file-search';
import type { AgentToolExecutionContext } from './agent-tool-registry';

describe('library glob pagination', () => {
  it('returns empty-but-incomplete pages and resumes from the original backend cursor', async () => {
    const readLibraryMetadata = vi.fn().mockResolvedValueOnce({ libraryId: 3, entries: [
      { id: 1, libraryId: 3, parentId: 9, name: 'a', ext: 'txt', type: 'file', path: '/docs/a.txt' },
    ], hasMore: true, nextCursor: 'backend-next' }).mockResolvedValueOnce({ libraryId: 3, entries: [
      { id: 2, libraryId: 3, parentId: 9, name: 'b', ext: 'md', type: 'file', path: '/docs/b.md' },
    ], hasMore: false });
    const context: AgentToolExecutionContext = { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      onProgress() {}, signal: new AbortController().signal, readLibraryMetadata };
    const first = await searchAgentFiles({ path: '/docs', glob: '*.md', limit: 1 }, context);
    expect(first).toMatchObject({ entries: [], hasMore: true, examinedEntries: 1 });
    const second = await searchAgentFiles({ path: '/docs', glob: '*.md', limit: 1, cursor: first.nextCursor }, context);
    expect(second).toMatchObject({ entries: [{ path: '/docs/b.md' }], hasMore: false });
    expect(readLibraryMetadata.mock.calls[1][0]).toMatchObject({ cursor: 'backend-next' });
    await expect(searchAgentFiles({ path: '/docs', glob: '*.txt', cursor: first.nextCursor }, context)).rejects.toThrow('游标');
  });
});

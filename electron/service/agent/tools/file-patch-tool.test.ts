import { describe, expect, it, vi } from 'vitest';
import { filePatchTool } from './file-patch-tool';
import { fileWriteTool } from './file-write-tool';
import type { AgentToolExecutionContext } from '../agent-tool-registry';

describe('unified saved mutation tool dispatch', () => {
  it('delegates library write/patch to the same supervised renderer adapter', async () => {
    const executeLibraryFileMutation = vi.fn(async () => ({ ok: true, data: { writeCommitState: 'committed' } }));
    const context = { signal: new AbortController().signal, appContext: { libraryId: 3 },
      executeLibraryFileMutation, commitSettlement: { begin: vi.fn(), settle: vi.fn() } } as unknown as AgentToolExecutionContext;
    const write = { path: '/a.txt', content: 'new' };
    const patch = { path: '/a.txt', revision: 'a'.repeat(64), patch: '@@ -1 +1 @@\n-old\n+new\n' };
    await expect(fileWriteTool.execute!(write, context)).resolves.toMatchObject({ ok: true });
    await expect(filePatchTool.execute!(patch, context)).resolves.toMatchObject({ ok: true });
    expect(executeLibraryFileMutation).toHaveBeenNthCalledWith(1, expect.objectContaining({ mode: 'create', scope: 'library' }), context.signal, context.commitSettlement);
    expect(executeLibraryFileMutation).toHaveBeenNthCalledWith(2, expect.objectContaining({ format: 'unified-v1', scope: 'library' }), context.signal, context.commitSettlement);
  });
  it('rejects working writes and missing patch revisions before execution', async () => {
    const context = { appContext: { libraryId: 3 } } as AgentToolExecutionContext;
    expect(await filePatchTool.validate!({ path: '/a.txt', patch: 'anything' }, context)).toMatchObject({ ok: false });
    expect(await fileWriteTool.validate!({ path: '/a.txt', content: 'new', view: 'working' }, context)).toMatchObject({ ok: false });
  });
});

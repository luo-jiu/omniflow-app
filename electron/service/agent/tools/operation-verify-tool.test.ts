import { describe, expect, it, vi } from 'vitest';
import { operationVerifyTool } from './operation-verify-tool';

const context = (node?: unknown, failure?: Error, journal?: { status: 'committed' | 'uncommitted' | 'commit_unknown' | 'unknown' }) => ({
  appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
  onProgress: vi.fn(), signal: new AbortController().signal,
  readLibraryMetadata: vi.fn(async () => { if (failure) throw failure; return { libraryId: 3, node: node as never }; }),
  readOperationJournal: vi.fn(async () => journal ? { operationId: 'op-1', toolName: 'file.copy', ...journal } : undefined),
});

describe('operation.verify', () => {
  it('confirms expected creation and detects an unmet name/parent expectation', async () => {
    const node = { id: 9, libraryId: 3, parentId: 8, name: 'copy', ext: 'txt', type: 'file' as const };
    await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true, expectedParentId: 8, expectedName: 'copy.txt' }, context(node))).resolves.toMatchObject({ data: { status: 'committed' } });
    await expect(operationVerifyTool.execute!({ operationId: 'op-2', nodeId: 9, expectedExists: true, expectedParentId: 7 }, context(node))).resolves.toMatchObject({ data: { status: 'not_committed' } });
  });
  it('confirms deletion only when the node read returns no node, and keeps network failures unknown', async () => {
    await expect(operationVerifyTool.execute!({ operationId: 'op-3', nodeId: 9, expectedExists: false }, context(undefined))).resolves.toMatchObject({ data: { status: 'committed' } });
    await expect(operationVerifyTool.execute!({ operationId: 'op-4', nodeId: 9, expectedExists: false }, context(undefined, new Error('源存储不可达')))).resolves.toMatchObject({ ok: false, data: { status: 'commit_unknown' } });
  });
  it('uses the persisted operation journal before resource reconciliation', async () => {
    const readLibraryMetadata = vi.fn();
    const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true }, {
      ...context(undefined, undefined, { status: 'uncommitted' }), readLibraryMetadata,
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'not_committed', journalStatus: 'uncommitted' } });
    expect(readLibraryMetadata).not.toHaveBeenCalled();
  });
});

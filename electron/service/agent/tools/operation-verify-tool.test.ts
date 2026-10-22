import { describe, expect, it, vi } from 'vitest';
import { operationVerifyTool } from './operation-verify-tool';
import type { AgentToolActivitySnapshot, AgentToolResult } from '../../../../src/shared/agent/agent.types';
import { projectAgentOperationJournalEntry } from '../agent-operation-journal';

const context = (node?: unknown, failure?: Error, journal?: {
  status: 'committed' | 'uncommitted' | 'commit_unknown' | 'unknown'; toolName?: string;
}) => ({
  appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
  onProgress: vi.fn(), signal: new AbortController().signal,
  readLibraryMetadata: vi.fn(async () => { if (failure) throw failure; return { libraryId: 3, node: node as never }; }),
  readOperationJournal: vi.fn(async () => journal ? { operationId: 'op-1', toolName: 'file.copy', ...journal } : undefined),
});

describe('operation.verify', () => {
  const projectedJournal = (toolName: string, result: AgentToolResult) => projectAgentOperationJournalEntry('op-1', {
    id: 'tool-1', runId: 'run-1', sessionId: 'session-1', createdAt: '2026-10-22T00:00:00Z',
    ordinal: 0, permissionBehavior: 'allow', revision: 1, status: 'completed',
    call: { id: 'call-1', name: toolName, input: {} }, result,
  } satisfies AgentToolActivitySnapshot);

  it('reconciles expected creation only for a known node-operation journal, and detects unmet metadata expectations', async () => {
    const node = { id: 9, libraryId: 3, parentId: 8, name: 'copy', ext: 'txt', type: 'file' as const };
    for (const toolName of ['directory.create', 'file.copy', 'file.move', 'file.rename', 'recycle.restore']) {
      const runtime = context(node, undefined, { toolName, status: 'unknown' });
      await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true,
        expectedParentId: 8, expectedName: 'copy.txt' }, runtime)).resolves.toMatchObject({ data: { status: 'committed', journalStatus: 'unknown', node } });
      expect(runtime.readLibraryMetadata).toHaveBeenCalledTimes(1);
      await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true, expectedParentId: 7 }, runtime))
        .resolves.toMatchObject({ data: { status: 'not_committed' } });
      await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true, expectedName: 'other.txt' }, runtime))
        .resolves.toMatchObject({ data: { status: 'not_committed' } });
    }
  });
  it('reconciles a known deletion when the node read returns no node, and keeps network failures unknown', async () => {
    const journal = { toolName: 'file.delete', status: 'commit_unknown' as const };
    await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: false }, context(undefined, undefined, journal)))
      .resolves.toMatchObject({ data: { status: 'committed' } });
    await expect(operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: false }, context(undefined, new Error('源存储不可达'), journal)))
      .resolves.toMatchObject({ ok: false, data: { status: 'commit_unknown', journalStatus: 'commit_unknown', retryAllowed: false } });
  });
  it('uses the persisted operation journal before resource reconciliation', async () => {
    const readLibraryMetadata = vi.fn();
    const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true }, {
      ...context(undefined, undefined, { status: 'uncommitted' }), readLibraryMetadata,
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'not_committed', journalStatus: 'uncommitted' } });
    expect(readLibraryMetadata).not.toHaveBeenCalled();
  });

  it('keeps a production-projected successful no-op uncommitted without reading a node', async () => {
    const readLibraryMetadata = vi.fn();
    const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true }, {
      ...context(), readLibraryMetadata,
      readOperationJournal: async () => projectedJournal('file.patch', { ok: true, data: {
        mutationCommitState: 'uncommitted', writeCommitState: 'uncommitted', changed: false, outcome: 'unchanged',
      } }),
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'not_committed', journalStatus: 'uncommitted',
      changed: false, outcome: 'unchanged', node: null } });
    expect(readLibraryMetadata).not.toHaveBeenCalled();
  });

  it('preserves an explicit committed receipt despite failed postprocessing or changed current metadata', async () => {
    const readLibraryMetadata = vi.fn();
    const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true }, {
      ...context(), readLibraryMetadata,
      readOperationJournal: async () => projectedJournal('file.patch', { ok: false, data: {
        mutationCommitState: 'committed', writeCommitState: 'committed',
      } }),
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'committed', journalStatus: 'committed' } });
    expect(readLibraryMetadata).not.toHaveBeenCalled();
  });

  it.each(['file.write', 'file.patch'])('never infers %s content commit from matching node metadata', async toolName => {
    const node = { id: 9, libraryId: 3, parentId: 8, name: 'copy', ext: 'txt', type: 'file' as const };
    for (const data of [undefined, { mutationCommitState: 'commit_unknown' },
      { mutationCommitState: 'committed', writeCommitState: 'uncommitted' },
      { mutationCommitState: 'committed', writeCommitState: null }]) {
      const runtime = context(node);
      const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9,
        expectedExists: true, expectedParentId: 8, expectedName: 'copy.txt' }, {
        ...runtime, readOperationJournal: async () => projectedJournal(toolName, { ok: true, data }),
      });
      expect(result).toMatchObject({ ok: true, data: { status: 'commit_unknown', nextAction: 'verify_content', retryAllowed: false } });
      expect(runtime.readLibraryMetadata).not.toHaveBeenCalled();
    }
  });

  it('keeps a missing operation unknown without requiring or observing library metadata', async () => {
    const runtime = context({ id: 9, libraryId: 3, parentId: 8, name: 'copy', type: 'file' });
    expect(await operationVerifyTool.execute!({ operationId: 'missing' }, runtime)).toMatchObject({
      ok: true, data: { status: 'commit_unknown', journalStatus: 'unknown', node: null, nextAction: 'verify_receipt', retryAllowed: false },
    });
    expect(runtime.readLibraryMetadata).not.toHaveBeenCalled();
  });

  it.each(['missing-entry', 'missing-reader', 'unavailable-reader', 'unknown-tool'] as const)(
    'never infers a missing or unidentified operation from matching metadata: %s', async source => {
      for (const expectedExists of [true, false]) {
        const runtime = context(expectedExists ? { id: 9, libraryId: 3, parentId: 8, name: 'copy', ext: 'txt', type: 'file' } : undefined);
        const readOperationJournal = source === 'missing-reader' ? undefined : vi.fn(async () => {
          if (source === 'unavailable-reader') throw new Error('账本不可访问');
          if (source === 'unknown-tool') return { operationId: 'op-1', toolName: 'unknown.mutation', status: 'unknown' as const };
          return undefined;
        });
        const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists,
          expectedParentId: 8, expectedName: 'copy.txt' }, { ...runtime, readOperationJournal });
        expect(result).toMatchObject({ ok: source !== 'unavailable-reader', data: {
          operationId: 'op-1', status: 'commit_unknown', journalStatus: 'unknown', node: null,
          nextAction: 'verify_receipt', retryAllowed: false,
        } });
        expect(runtime.readLibraryMetadata).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps known metadata reconciliation unknown when its metadata reader is unavailable', async () => {
    const result = await operationVerifyTool.execute!({ operationId: 'op-1', nodeId: 9, expectedExists: true }, {
      ...context(undefined, undefined, { toolName: 'file.rename', status: 'commit_unknown' }), readLibraryMetadata: undefined,
    });
    expect(result).toMatchObject({ ok: false, data: { status: 'commit_unknown', journalStatus: 'commit_unknown', retryAllowed: false } });
  });
});

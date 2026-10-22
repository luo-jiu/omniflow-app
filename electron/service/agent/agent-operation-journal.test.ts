import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionSnapshot, AgentToolActivitySnapshot, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { projectAgentOperationJournalEntry, readAgentOperationJournal } from './agent-operation-journal';

function activity(result?: AgentToolResult): AgentToolActivitySnapshot {
  return { id: 'tool-run-1', runId: 'run-1', sessionId: 'session-1', createdAt: '2026-10-22T00:00:00Z',
    ordinal: 0, permissionBehavior: 'allow', revision: 1, status: 'completed',
    call: { id: 'call-1', name: 'file.patch', input: {} }, ...(result ? { result } : {}) };
}
const session = (result?: AgentToolResult) => ({ toolActivities: [activity(result)] }) as AgentSessionSnapshot;

describe('production operation journal projection', () => {
  it.each([true, false])('preserves explicit state independently of ok=%s and completed lifecycle', ok => {
    for (const status of ['committed', 'uncommitted', 'commit_unknown'] as const) {
      expect(projectAgentOperationJournalEntry('op-1', activity({ ok, data: { mutationCommitState: status } })))
        .toMatchObject({ status });
    }
    expect(projectAgentOperationJournalEntry('op-1', activity({ ok }))).toMatchObject({ status: 'unknown' });
    expect(projectAgentOperationJournalEntry('op-1', activity())).toEqual({ operationId: 'op-1', toolName: 'file.patch', status: 'unknown' });
  });

  it('projects invalid or conflicting explicit receipt fields as diagnostic unknown', () => {
    expect(projectAgentOperationJournalEntry('op-1', activity({ ok: true,
      data: { writeCommitState: 'committed', mutationCommitState: null } })))
      .toMatchObject({ status: 'commit_unknown', receiptIssue: 'invalid_commit_state' });
    expect(projectAgentOperationJournalEntry('op-1', activity({ ok: true,
      data: { writeCommitState: 'committed', mutationCommitState: 'uncommitted' } })))
      .toMatchObject({ status: 'commit_unknown', receiptIssue: 'conflicting_commit_states' });
  });

  it.each(['tool-run-1', 'op-1'])('finds the same persisted operation using %s', async operationId => {
    const result = { ok: true, data: { operationId: 'op-1', writeCommitState: 'uncommitted' } };
    await expect(readAgentOperationJournal({ operationId, signal: new AbortController().signal,
      readSession: async () => session(result) })).resolves.toEqual({ operationId, toolName: 'file.patch', status: 'uncommitted', result });
  });

  it('returns no entry for another operation and does not match inherited operation IDs', async () => {
    for (const snapshot of [null, session({ ok: true, data: Object.create({ operationId: 'missing' }) })]) {
      await expect(readAgentOperationJournal({ operationId: 'missing', signal: new AbortController().signal,
        readSession: async () => snapshot })).resolves.toBeUndefined();
    }
  });

  it('honors cancellation before and after loading the scoped session', async () => {
    const controller = new AbortController(); controller.abort();
    const readSession = vi.fn(async () => session());
    await expect(readAgentOperationJournal({ operationId: 'op-1', signal: controller.signal, readSession })).rejects.toThrow();
    expect(readSession).not.toHaveBeenCalled();
    const afterRead = new AbortController();
    await expect(readAgentOperationJournal({ operationId: 'op-1', signal: afterRead.signal,
      readSession: async () => { afterRead.abort(); return session(); } })).rejects.toThrow();
  });
});

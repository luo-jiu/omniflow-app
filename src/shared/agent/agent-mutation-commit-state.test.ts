import { describe, expect, it } from 'vitest';
import { normalizeAgentMutationCommitState } from './agent-mutation-commit-state';

const fields = ['mutationCommitState', 'writeCommitState', 'deleteCommitState', 'uploadCommitState'] as const;

describe('mutation commit receipt normalization', () => {
  it.each(fields)('accepts the explicit %s field independently of all other result data', field => {
    for (const status of ['committed', 'uncommitted', 'commit_unknown'] as const) {
      expect(normalizeAgentMutationCommitState({ [field]: status, ok: status !== 'committed', status: 'completed' }))
        .toEqual({ status });
    }
  });

  it('accepts consistent aliases and rejects conflicts without selecting the first field', () => {
    expect(normalizeAgentMutationCommitState(Object.fromEntries(fields.map(field => [field, 'uncommitted']))))
      .toEqual({ status: 'uncommitted' });
    for (const field of fields.slice(1)) {
      expect(normalizeAgentMutationCommitState({ mutationCommitState: 'committed', [field]: 'uncommitted' }))
        .toEqual({ status: 'commit_unknown', receiptIssue: 'conflicting_commit_states' });
    }
  });

  it.each([undefined, null, '', false, 0, {}, [], 'unknown', 'COMMITTED'])('rejects a present malformed receipt value %j', value => {
    for (const field of fields) {
      expect(normalizeAgentMutationCommitState({ [field]: value, writeCommitState: value }))
        .toEqual({ status: 'commit_unknown', receiptIssue: 'invalid_commit_state' });
    }
  });

  it('keeps missing and inherited receipt fields unknown', () => {
    for (const data of [undefined, null, [], 'committed', { ok: true, status: 'completed' },
      Object.create({ mutationCommitState: 'committed' })]) {
      expect(normalizeAgentMutationCommitState(data)).toEqual({ status: 'unknown' });
    }
    expect(normalizeAgentMutationCommitState(Object.assign(Object.create({ mutationCommitState: 'committed' }), {
      writeCommitState: 'uncommitted',
    }))).toEqual({ status: 'uncommitted' });
  });
});

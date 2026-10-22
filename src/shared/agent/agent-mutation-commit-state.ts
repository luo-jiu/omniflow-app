export interface AgentMutationCommitState {
  status: 'committed' | 'uncommitted' | 'commit_unknown' | 'unknown';
  receiptIssue?: 'invalid_commit_state' | 'conflicting_commit_states';
}

const COMMIT_STATE_FIELDS = ['mutationCommitState', 'writeCommitState', 'deleteCommitState', 'uploadCommitState'] as const;
const COMMIT_STATES = new Set(['committed', 'uncommitted', 'commit_unknown']);

/** Explicit receipts describe side effects independently of ToolRun success. */
export function normalizeAgentMutationCommitState(data: unknown): AgentMutationCommitState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 'unknown' };
  const record = data as Record<string, unknown>;
  const values = COMMIT_STATE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(record, field))
    .map(field => record[field]);
  if (values.some(value => typeof value !== 'string' || !COMMIT_STATES.has(value))) {
    return { status: 'commit_unknown', receiptIssue: 'invalid_commit_state' };
  }
  if (new Set(values).size > 1) return { status: 'commit_unknown', receiptIssue: 'conflicting_commit_states' };
  return { status: values.length ? values[0] as AgentMutationCommitState['status'] : 'unknown' };
}

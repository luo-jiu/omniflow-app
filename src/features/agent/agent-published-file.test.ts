import { describe, expect, it } from 'vitest';
import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { committedAgentFileParent } from './agent-published-file';

const activity: AgentToolActivitySnapshot = {
  id: 'publish', sessionId: 's', runId: 'r', createdAt: '2026-09-09', ordinal: 1, revision: 1,
  status: 'completed', permissionBehavior: 'allow', call: { id: 'call', name: 'file.publish', input: {} },
  result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'library', nodeId: 32, parentId: 20 } } },
};
describe('committed publication refresh target', () => {
  it.each(['file.publish', 'file.upload'])('refreshes committed %s destinations', name => {
    expect(committedAgentFileParent({ ...activity, call: { ...activity.call, name } })).toBe(20);
  });
  it.each(['commit_unknown', 'uncommitted'])('does not treat %s as committed', uploadCommitState => {
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { ...(activity.result!.data as Record<string, unknown>), uploadCommitState } } })).toBeNull();
  });
  it('ignores local, failed and malformed results', () => {
    expect(committedAgentFileParent({ ...activity, status: 'failed' })).toBeNull();
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'local' } } } })).toBeNull();
    expect(committedAgentFileParent({ ...activity, result: { ok: true, data: { uploadCommitState: 'committed', destination: { kind: 'library', nodeId: 3, parentId: '20' } } } })).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AgentPluginFileOutputPreparedActionPublicV1, AgentPluginOperationReconcileRequest, AgentToolActivitySnapshot } from '../../../src/shared/agent/agent.types';
import type { AgentSessionStore, ReconcileAgentPluginToolRunInput } from './agent-session-store';
import type { AgentMediaUploadCompletionStatus } from './agent-media-upload-control-plane';
import type { ConditionalRenameReceipt } from './plugin-rename-transport';
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
import { createAgentPluginReceiptService } from './agent-plugin-receipts';

const owner = { backendScope: 'https://example.com/api', accountScope: 'user:7' };
const operationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
function fixture() {
  const action: AgentPluginFileOutputPreparedActionPublicV1 = { kind: 'plugin.file-output', version: 1, libraryId: 3, operationId,
    pluginId: 'example.csv-export', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), sourceNodeId: 11,
    parentId: 10, fileName: 'export.csv', providerId: 'local-minio', mediaType: 'text/csv', sizeBytes: 100, sha256: 'b'.repeat(64) };
  const activity: AgentToolActivitySnapshot = { id: 'tool', sessionId: 'session', runId: 'run', ordinal: 1, revision: 5, createdAt: '', status: 'failed', permissionBehavior: 'ask',
    call: { id: 'call', name: 'example.csv-export.export', input: {} }, pluginSource: { pluginId: action.pluginId, pluginVersion: action.pluginVersion,
      packageFingerprint: action.packageFingerprint, toolId: 'example.csv-export.export', registrationId: `plugin-tool:${'c'.repeat(64)}` },
    preparation: { action, preparedActionId: 'prepared', snapshotHash: 'd'.repeat(64) },
    approval: { status: 'approved', approvalId: 'approval', preview: { title: '', description: '', risk: 'write' } },
    result: { ok: false, data: { uploadCommitState: 'commit_unknown', mutationCommitState: 'commit_unknown', operationId, libraryId: 3 } } };
  const request: AgentPluginOperationReconcileRequest = { ownerScope: owner, libraryId: 3, sessionId: 'session', toolRunId: 'tool', expectedRevision: 5, credentials: { token: 'test-token', username: 'test' } };
  const node = { id: 22, libraryId: 3, parentId: 10, type: 'file', name: 'export', ext: 'csv', storageProvider: 'local-minio', fileSize: 100, mimeType: 'text/csv' };
  const getSession = vi.fn(async () => ({ toolActivities: [activity] }));
  const reconcilePluginToolRun = vi.fn(async (input: ReconcileAgentPluginToolRunInput) => ({ ...activity, result: input.result, revision: activity.revision + 1 }));
  const store = { getSession, reconcilePluginToolRun } as unknown as AgentSessionStore;
  const rename = { verifyActor: vi.fn(async () => undefined), statusForAction: vi.fn<() => Promise<ConditionalRenameReceipt | null>>().mockResolvedValue(null) };
  const upload = { verifyAccount: vi.fn(async () => undefined), reconcile: vi.fn<() => Promise<AgentMediaUploadCompletionStatus>>().mockResolvedValue({ state: 'committed', node }) };
  const sender = { id: 9, isDestroyed: vi.fn(() => false) };
  const query = createAgentPluginReceiptService({ apiBaseUrl: owner.backendScope, rename, upload, now: () => '2026-09-22T10:00:00.000Z' });
  return { action, activity, request, node, store, rename, upload, sender, query, getSession, reconcilePluginToolRun };
}
describe('host plugin receipt querying', () => {
  it('accepts a matching MIME essence with encoding parameters without re-reading content', async () => {
    const f = fixture(); f.upload.reconcile.mockResolvedValueOnce({ state: 'committed', node: { ...f.node, mimeType: 'Text/CSV; charset=utf-8' } });
    expect((await f.query(f.store, f.sender, f.request)).result?.ok).toBe(true);
  });
  it('queries the stored operation with fresh account verification and no plugin or current-file execution', async () => {
    const f = fixture(); const result = await f.query(f.store, f.sender, f.request);
    expect(f.upload.verifyAccount).toHaveBeenCalledWith(f.request.credentials, 7, expect.any(AbortSignal));
    expect(f.upload.reconcile).toHaveBeenCalledWith(f.request.credentials, operationId, expect.any(AbortSignal));
    expect(result.result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed', uploadCommitState: 'committed', operationId,
      destination: { kind: 'library', nodeId: 22, parentId: 10 }, fileName: 'export.csv', sha256: f.action.sha256 } });
    // No current node fetch exists: a later rename/move/deletion cannot invalidate the immutable operation receipt.
    expect(f.rename.statusForAction).not.toHaveBeenCalled(); expect(f.reconcilePluginToolRun).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.reconcilePluginToolRun.mock.calls)).not.toContain('test-token');
  });
  it.each(['unknown', 'uncommitted'] as const)('preserves %s upload responses as unknown for older pending semantics', async state => {
    const f = fixture(); f.upload.reconcile.mockResolvedValueOnce({ state });
    expect((await f.query(f.store, f.sender, f.request)).result).toMatchObject({ ok: false, data: { uploadCommitState: 'commit_unknown', mutationCommitState: 'commit_unknown' } });
  });
  it.each([{ id: 11 }, { libraryId: 4 }, { parentId: 99 }, { name: 'other' }, { ext: 'json' }, { fileSize: 99 }, { storageProvider: 'remote' }, { mimeType: 'text/html' }, { type: 'dir' }])('rejects a receipt inconsistent with the frozen new-file proposal %j', async change => {
    const f = fixture(); f.upload.reconcile.mockResolvedValueOnce({ state: 'committed', node: { ...f.node, ...change } });
    await expect(f.query(f.store, f.sender, f.request)).rejects.toThrow('不匹配'); expect(f.reconcilePluginToolRun).not.toHaveBeenCalled();
  });
  it('does not mutate state on authentication, API, stale revision or closed-window errors', async () => {
    const auth = fixture(); auth.upload.verifyAccount.mockRejectedValue(new Error('auth expired'));
    await expect(auth.query(auth.store, auth.sender, auth.request)).rejects.toThrow('auth expired'); expect(auth.reconcilePluginToolRun).not.toHaveBeenCalled();
    const api = fixture(); api.upload.reconcile.mockRejectedValue(new Error('offline'));
    await expect(api.query(api.store, api.sender, api.request)).rejects.toThrow('offline'); expect(api.reconcilePluginToolRun).not.toHaveBeenCalled();
    const stale = fixture(); await expect(stale.query(stale.store, stale.sender, { ...stale.request, expectedRevision: 4 })).rejects.toThrow('已变化'); expect(stale.upload.verifyAccount).not.toHaveBeenCalled();
    const closed = fixture(); closed.sender.isDestroyed.mockReturnValue(true); await expect(closed.query(closed.store, closed.sender, closed.request)).rejects.toThrow('已关闭'); expect(closed.getSession).not.toHaveBeenCalled();
  });
  it('takes no operation parameters from the caller and keeps unsupported historical uploads out', async () => {
    const f = fixture(); await expect(f.query(f.store, f.sender, { ...f.request, operationId: 'override' } as AgentPluginOperationReconcileRequest)).rejects.toThrow('请求无效');
    await expect(f.query(f.store, f.sender, { ...f.request, ownerScope: { ...owner, backendScope: 'https://other.example/api' } })).rejects.toThrow('不匹配');
    f.activity.preparation = undefined; await expect(f.query(f.store, f.sender, f.request)).rejects.toThrow(); expect(f.reconcilePluginToolRun).not.toHaveBeenCalled();
  });
  it('queries an approved rename without requiring its plugin to remain installed and preserves not_found', async () => {
    const f = fixture(); f.activity.preparation!.action = { kind: 'plugin.rename', version: 1, libraryId: 3, operationId,
      pluginId: f.action.pluginId, pluginVersion: f.action.pluginVersion, packageFingerprint: f.action.packageFingerprint,
      items: [{ nodeId: 11, parentId: 10, oldName: 'old.csv', newName: 'new.csv' }] };
    const unknown = await f.query(f.store, f.sender, f.request); expect(unknown.result).toMatchObject({ ok: false, data: { mutationCommitState: 'commit_unknown' } });
    expect(f.rename.statusForAction).toHaveBeenCalledWith(f.activity.preparation!.action, f.request.credentials, expect.any(AbortSignal));
    f.rename.statusForAction.mockResolvedValueOnce({ libraryId: 3, operationId, atomic: true, state: 'committed', replayed: true, affectedParentIds: [10],
      items: [{ nodeId: 11, parentId: 10, status: 'committed', previous: { name: 'old', ext: 'csv', updatedAt: '2026-09-22T00:00:00Z' }, current: { name: 'new', ext: 'csv', updatedAt: '2026-09-22T00:00:01Z' } }] });
    expect((await f.query(f.store, f.sender, f.request)).result).toMatchObject({ ok: true, data: { items: [{ nodeId: 11, name: 'new', ext: 'csv' }] } });
  });
});

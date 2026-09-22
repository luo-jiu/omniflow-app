import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentPluginFileOutputPreparedActionPublicV1, AgentToolResult } from '../../../src/shared/agent/agent.types';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const owner = { accountScope: 'user:7', backendScope: 'https://example.com/api' };
const time = '2026-09-22T10:00:00.000Z';
const source = { pluginId: 'example.csv-export', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.csv-export.export', registrationId: '' };
source.registrationId = `plugin-tool:${createHash('sha256').update(JSON.stringify(['omniflow-agent-tool-v1', source.pluginId, source.pluginVersion, source.packageFingerprint, source.toolId])).digest('hex')}`;
const action = (): AgentPluginFileOutputPreparedActionPublicV1 => ({ kind: 'plugin.file-output', version: 1, libraryId: 3,
  operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', pluginId: source.pluginId, pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint,
  sourceNodeId: 11, parentId: 10, fileName: 'export.json', providerId: 'local-minio', mediaType: 'application/json', sizeBytes: 100, sha256: 'b'.repeat(64) });
const unknown = (): AgentToolResult => ({ ok: false, message: '未知，请查询', data: { mutationCommitState: 'commit_unknown', uploadCommitState: 'commit_unknown', operationId: action().operationId, libraryId: 3 } });
const committed = (): AgentToolResult => ({ ok: true, data: { mutationCommitState: 'committed', uploadCommitState: 'committed', operationId: action().operationId,
  libraryId: 3, destination: { kind: 'library', nodeId: 22, parentId: 10 }, fileName: action().fileName, sizeBytes: action().sizeBytes, sha256: action().sha256 } });
const stores: AgentSessionStore[] = []; const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-output-store-')); roots.push(root); const file = path.join(root, 'sessions.sqlite3');
  const store = await createSQLiteAgentSessionStore(file); stores.push(store);
  await store.createSession({ id: 'session', ownerScope: owner, title: 'export', now: time, appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } });
  await store.createRun({ id: 'run', sessionId: 'session', model: 'test', profileId: 'test', reasoningEffort: 'auto', userPrompt: 'export', now: time });
  await store.createToolRun({ id: 'tool', callId: 'call', runId: 'run', toolName: source.toolId, pluginSource: source, input: {}, permissionBehavior: 'ask', status: 'preparing', now: time });
  const prepare = (value = action()) => store.completeToolPreparation({ id: 'tool', action: value, preparedActionId: 'prepared', snapshotHash: 'c'.repeat(64), approvalId: 'approval', approvalInputHash: 'c'.repeat(64), permissionBehavior: 'ask', approvalPreview: { title: 'export', description: 'new file', risk: 'write' } });
  const approve = async () => { await prepare(); await store.resolveToolApproval('approval', 'approved', time); };
  return { store, file, approve, prepare };
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('file-output Store and receipt reconciliation', () => {
  it('persists matching dynamic source actions and rejects foreign scopes and fingerprints', async () => {
    const f = await fixture();
    for (const change of [{ libraryId: 4 }, { pluginId: 'other.plugin' }, { packageFingerprint: 'd'.repeat(64) }, { pluginVersion: '9.0.0' }]) await expect(f.prepare({ ...action(), ...change })).rejects.toThrow('prepared action');
    expect(await f.prepare()).toMatchObject({ preparation: { action: action() }, pluginSource: source });
  });
  it('recovers an approved in-flight new file as unknown without opening a new Run', async () => {
    const f = await fixture(); await f.approve(); await f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const recovered = await createSQLiteAgentSessionStore(f.file); stores.push(recovered);
    const session = await recovered.getSession('session', owner, 3);
    expect(session!.runs[0].status).toBe('interrupted');
    expect(session!.toolActivities[0]).toMatchObject({ status: 'interrupted', result: { ok: false, data: {
      mutationCommitState: 'commit_unknown', uploadCommitState: 'commit_unknown', operationId: action().operationId, libraryId: 3,
    } } });
  });
  it('updates one terminal row with CAS, preserves the initial result and caps check history', async () => {
    const f = await fixture(); await f.approve(); let row = await f.store.completeToolRun('tool', unknown(), time);
    const request = { ownerScope: owner, libraryId: 3, sessionId: 'session', toolRunId: 'tool', operationId: action().operationId, checkedAt: time };
    const initial = row;
    for (let index = 0; index < 10; index++) row = await f.store.reconcilePluginToolRun({ ...request, expectedRevision: row.revision, result: unknown() });
    expect(row.result?.data).toMatchObject({ reconciliation: { originalResult: initial.result, originalStatus: 'failed', checks: expect.any(Array) } });
    expect((row.result!.data as { reconciliation: { checks: unknown[] } }).reconciliation.checks).toHaveLength(8);
    await expect(f.store.reconcilePluginToolRun({ ...request, expectedRevision: initial.revision, result: committed() })).rejects.toThrow('版本已变化');
    const resolved = await f.store.reconcilePluginToolRun({ ...request, expectedRevision: row.revision, result: committed() });
    expect(resolved.status).toBe('completed'); expect(resolved.finishedAt).toBe(initial.finishedAt);
    const again = await f.store.reconcilePluginToolRun({ ...request, expectedRevision: resolved.revision, result: unknown() }); expect(again).toEqual(resolved);
    expect((await f.store.getSession('session', owner, 3))!.toolActivities).toHaveLength(1);
  });
  it('refuses wrong owner/library, unapproved/running rows, mismatched operation and fake committed targets', async () => {
    const f = await fixture(); await f.approve(); let row = (await f.store.getSession('session', owner, 3))!.toolActivities[0];
    const req = () => ({ ownerScope: owner, libraryId: 3, sessionId: 'session', toolRunId: 'tool', operationId: action().operationId, checkedAt: time, expectedRevision: row.revision, result: committed() });
    await expect(f.store.reconcilePluginToolRun(req())).rejects.toThrow('已批准');
    row = await f.store.completeToolRun('tool', unknown(), time);
    for (const change of [{ ownerScope: { ...owner, accountScope: 'user:8' } }, { libraryId: 4 }, { operationId: 'wrong' },
      { result: { ok: true, data: { ...(committed().data as object), destination: { kind: 'library', nodeId: 22, parentId: 99 } } } },
    ]) await expect(f.store.reconcilePluginToolRun({ ...req(), ...change })).rejects.toThrow();
    expect((await f.store.getSession('session', owner, 3))!.toolActivities[0].revision).toBe(row.revision);
  });
});

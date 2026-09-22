import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentPluginRenamePreparedActionPublicV1, AgentPluginToolSource } from '../../../src/shared/agent/agent.types';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const ownerScope = { accountScope: 'user:7', backendScope: 'https://example.com/api' };
const time = '2026-09-22T10:00:00.000Z';
const stores: AgentSessionStore[] = []; const directories: string[] = [];
function source(): AgentPluginToolSource {
  const identity = { pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.prefix' };
  return { ...identity, registrationId: `plugin-tool:${createHash('sha256').update(JSON.stringify([
    'omniflow-agent-tool-v1', identity.pluginId, identity.pluginVersion, identity.packageFingerprint, identity.toolId,
  ])).digest('hex')}` };
}
function action(): AgentPluginRenamePreparedActionPublicV1 {
  const plugin = source();
  return { kind: 'plugin.rename', version: 1, libraryId: 3, operationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    pluginId: plugin.pluginId, pluginVersion: plugin.pluginVersion, packageFingerprint: plugin.packageFingerprint,
    items: [{ nodeId: 8, parentId: 2, oldName: 'old.jpg', newName: 'new.jpg' }] };
}
async function fixture({ toolName = source().toolId, withSource = true } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-plugin-rename-store-')); directories.push(directory);
  const databasePath = path.join(directory, 'sessions.sqlite3');
  const store = await createSQLiteAgentSessionStore(databasePath); stores.push(store);
  await store.createSession({ id: 'session', ownerScope, title: 'Rename QA', now: time,
    appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } });
  await store.createRun({ id: 'run', sessionId: 'session', model: 'test', profileId: 'test', reasoningEffort: 'auto', userPrompt: 'Rename files', now: time });
  await store.createToolRun({ id: 'tool', callId: 'call', runId: 'run', toolName, now: time, input: { resources: [8], prefix: 'new' },
    permissionBehavior: 'ask', status: 'preparing', ...(withSource ? { pluginSource: source() } : {}) });
  const prepare = (value = action()) => store.completeToolPreparation({ id: 'tool', action: value, approvalId: 'approval',
    approvalInputHash: 'b'.repeat(64), snapshotHash: 'b'.repeat(64), preparedActionId: 'prepared', permissionBehavior: 'ask',
    approvalPreview: { title: 'Rename', description: 'Rename selected files', risk: 'write' } });
  return { store, databasePath, prepare };
}
async function update(databasePath: string, statement: string, values: unknown[]) {
  const db = await new Promise<sqlite3.Database>((resolve, reject) => { const value = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(value)); });
  try { await new Promise<void>((resolve, reject) => db.run(statement, values, error => error ? reject(error) : resolve())); }
  finally { await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
async function reopen(store: AgentSessionStore, databasePath: string) {
  await store.close(); stores.splice(stores.indexOf(store), 1);
  const recovered = await createSQLiteAgentSessionStore(databasePath); stores.push(recovered);
  return recovered;
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('plugin rename prepared action SQLite consistency', () => {
  it('prepares, approves and restores a dynamic plugin Tool with a generic rename action kind', async () => {
    const f = await fixture();
    const prepared = await f.prepare();
    expect(prepared).toMatchObject({ call: { name: source().toolId }, pluginSource: source(),
      preparation: { action: action() }, status: 'awaiting_approval' });
    await expect(f.store.resolveToolApproval('approval', 'approved', time)).resolves.toMatchObject({ status: 'running', approval: { status: 'approved' }, preparation: { action: action() } });
    await f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = await createSQLiteAgentSessionStore(f.databasePath); stores.push(reopened);
    const session = await reopened.getSession('session', ownerScope, 3);
    expect(session?.toolActivities?.[0]).toMatchObject({ pluginSource: source(), preparation: { action: action() } });
  });

  it.each(['source', 'builtin'])('rejects a rename preparation with missing %s identity', async mode => {
    const f = await fixture({ withSource: false, ...(mode === 'builtin' ? { toolName: 'file.rename' } : {}) });
    await expect(f.prepare()).rejects.toThrow('prepared action is invalid');
  });

  it('rejects preparation sources or library scopes that differ from the immutable row and session', async () => {
    const f = await fixture();
    for (const patch of [{ pluginId: 'other.rename' }, { pluginVersion: '0.2.0' }, { packageFingerprint: 'c'.repeat(64) }, { libraryId: 4 }]) {
      await expect(f.prepare({ ...action(), ...patch })).rejects.toThrow('prepared action is invalid');
    }
    await expect(f.prepare()).resolves.toMatchObject({ status: 'awaiting_approval' });
  });

  it('keeps SQL writes strict for forged kinds, identities, fields, targets and names', async () => {
    const f = await fixture(); await f.prepare();
    const item = action().items[0];
    const changes: unknown[] = [
      { ...action(), kind: 'file.rename' }, { ...action(), kind: source().toolId },
      { ...action(), pluginId: 'other.rename' }, { ...action(), pluginVersion: '0.2.0' },
      { ...action(), packageFingerprint: 'b'.repeat(64) }, { ...action(), libraryId: 4 },
      { ...action(), operationId: 'not-a-uuid' }, { ...action(), credentials: {} },
      { ...action(), items: [] }, { ...action(), items: [item, item] },
      { ...action(), items: [item, { ...item, nodeId: 9 }] },
      { ...action(), items: [{ ...item, nodeId: '8' }] }, { ...action(), items: [{ ...item, parentId: 0 }] },
      { ...action(), items: [{ ...item, newName: item.oldName }] }, { ...action(), items: [{ ...item, newName: 'a/b.jpg' }] },
      { ...action(), items: [{ ...item, newName: '中'.repeat(81) }] }, { ...action(), items: [{ ...item, newName: '.\n' }] },
      { ...action(), items: [{ ...item, newName: 'new.jpg', delete: true }] },
    ];
    for (const value of changes) {
      await expect(update(f.databasePath, 'UPDATE agent_tool_runs SET prepared_action_json = ? WHERE id = ?', [JSON.stringify(value), 'tool'])).rejects.toThrow('prepared action is invalid');
    }
    const current = await f.store.getSession('session', ownerScope, 3);
    expect(current?.toolActivities?.[0].preparation?.action).toEqual(action());
  });

  it('does not let a plugin row impersonate a built-in prepared action', async () => {
    const f = await fixture();
    await expect(f.store.completeToolPreparation({ id: 'tool', action: { kind: 'file.stage', version: 1, sourceKind: 'local-picker', targetLabel: 'input' },
      approvalId: 'approval', approvalInputHash: 'b'.repeat(64), snapshotHash: 'b'.repeat(64), preparedActionId: 'prepared', permissionBehavior: 'ask',
      approvalPreview: { title: 'Stage', description: 'Invalid', risk: 'write' } })).rejects.toThrow('prepared action is invalid');
  });
});

describe('plugin rename interruption recovery', () => {
  it('reconciles the original unknown rename row while retaining its original outcome', async () => {
    const f = await fixture(); await f.prepare(); await f.store.resolveToolApproval('approval', 'approved', time);
    const original = { ok: false, data: { mutationCommitState: 'commit_unknown', operationId: action().operationId, libraryId: 3, atomic: true } };
    const row = await f.store.completeToolRun('tool', original, time);
    const result = { ok: true, data: { mutationCommitState: 'committed', operationId: action().operationId, libraryId: 3, atomic: true,
      affectedParentIds: [2], items: [{ nodeId: 8, parentId: 2, name: 'new', ext: 'jpg' }] } };
    const updated = await f.store.reconcilePluginToolRun({ ownerScope, libraryId: 3, sessionId: 'session', toolRunId: 'tool', expectedRevision: row.revision,
      operationId: action().operationId, result, checkedAt: time });
    expect(updated).toMatchObject({ id: 'tool', status: 'completed', revision: row.revision + 1, result: { ok: true,
      data: { reconciliation: { originalResult: original, originalStatus: 'failed', checks: [{ checkedAt: time, state: 'committed' }] } } } });
  });
  it('recovers an approved in-flight rename as commit_unknown before Run finalization can overwrite it', async () => {
    const f = await fixture(); await f.prepare(); await f.store.resolveToolApproval('approval', 'approved', time);
    // A sibling open read Tool demonstrates that the ordinary Run trigger still runs.
    await f.store.createToolRun({ id: 'sibling', callId: 'sibling-call', runId: 'run', toolName: 'file.list',
      input: {}, permissionBehavior: 'allow', status: 'running', now: time });
    const before = await f.store.getSession('session', ownerScope, 3);
    const reopened = await reopen(f.store, f.databasePath);
    const recovered = await reopened.getSession('session', ownerScope, 3);
    const result = { ok: false,
      message: '应用退出时重命名尚未确认提交结果，请先按操作ID核对，勿直接重复提交。',
      data: { mutationCommitState: 'commit_unknown', operationId: action().operationId, libraryId: 3, atomic: true } };
    const activity = recovered!.toolActivities.find(item => item.id === 'tool')!;
    expect(activity).toMatchObject({ status: 'interrupted', pluginSource: source(), preparation: { action: action() },
      approval: { status: 'approved' }, result, finishedAt: expect.any(String) });
    expect(activity.revision).toBe(before!.toolActivities.find(item => item.id === 'tool')!.revision + 1);
    expect(recovered!.toolActivities.find(item => item.id === 'sibling')).toMatchObject({ status: 'interrupted', result: { ok: false } });
    expect(recovered!.toolActivities.find(item => item.id === 'sibling')!.result?.data).toBeUndefined();
    expect(recovered!.runs[0]).toMatchObject({ status: 'interrupted', currentStep: '重命名结果待核对' });
    expect(recovered!.runs[0].error).toContain('先按操作ID核对');
    expect(recovered!.runs[0].error).toContain('勿直接');
    expect(recovered!.runs[0].error).not.toContain('可重新发送');

    const again = await reopen(reopened, f.databasePath);
    const recoveredAgain = await again.getSession('session', ownerScope, 3);
    expect(recoveredAgain!.toolActivities.find(item => item.id === 'tool')).toEqual(activity);
    expect(recoveredAgain!.runs[0]).toEqual(recovered!.runs[0]);
  });

  it.each(['preparing', 'awaiting_approval'] as const)('does not report an unapproved %s proposal as an unknown commit', async phase => {
    const f = await fixture();
    if (phase === 'awaiting_approval') await f.prepare();
    const recovered = await reopen(f.store, f.databasePath);
    const session = await recovered.getSession('session', ownerScope, 3);
    expect(session!.toolActivities[0].status).toBe('interrupted');
    expect(session!.toolActivities[0].result?.data).toBeUndefined();
    expect(session!.runs[0].currentStep).toBe('上次运行已中断');
    if (phase === 'awaiting_approval') expect(session!.toolActivities[0].approval?.status).toBe('interrupted');
  });

  it('preserves a committed terminal Tool receipt even if its enclosing Run was interrupted', async () => {
    const f = await fixture(); await f.prepare(); await f.store.resolveToolApproval('approval', 'approved', time);
    const receipt = { ok: true, message: '已完成改名', data: { mutationCommitState: 'committed', operationId: action().operationId,
      libraryId: 3, atomic: true, items: [{ nodeId: 8, oldName: 'old.jpg', newName: 'new.jpg', status: 'committed' }] } };
    const completed = await f.store.completeToolRun('tool', receipt, time);
    const reopened = await reopen(f.store, f.databasePath); const session = await reopened.getSession('session', ownerScope, 3);
    expect(session!.runs[0].status).toBe('interrupted');
    expect(session!.runs[0].currentStep).toBe('改名已提交，任务已中断');
    expect(session!.runs[0].error).toBe('改名已提交，请查看现有回执继续未完成步骤，勿重复改名。');
    expect(session!.runs[0].error).not.toContain('重新发送');
    expect(session!.toolActivities[0]).toEqual(completed);
    expect(session!.toolActivities[0]).toMatchObject({ status: 'completed', result: receipt });
  });

  it('does not trust a damaged historical source registration when reconstructing operation uncertainty', async () => {
    const f = await fixture(); await f.prepare(); await f.store.resolveToolApproval('approval', 'approved', time);
    await update(f.databasePath, 'DROP TRIGGER agent_tool_runs_plugin_source_is_immutable', []);
    await update(f.databasePath, 'UPDATE agent_tool_runs SET plugin_source_json = ? WHERE id = ?', [
      JSON.stringify({ ...source(), registrationId: `plugin-tool:${'f'.repeat(64)}` }), 'tool',
    ]);
    const recovered = await reopen(f.store, f.databasePath); const session = await recovered.getSession('session', ownerScope, 3);
    expect(session!.toolActivities[0].status).toBe('interrupted');
    expect(session!.toolActivities[0].pluginSource).toBeUndefined();
    expect(session!.toolActivities[0].result?.data).toBeUndefined();
  });
});

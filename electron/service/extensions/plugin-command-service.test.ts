import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentPreparedActionPublic, AgentToolResult } from '../../../src/shared/agent/agent.types';
import type { PluginCommandExecution, PluginCommandPrepareRequest } from '../../../src/shared/plugins/manual-command.types';
import type { AgentMainCommitSettlement, AgentToolMainPreparationResult } from '../agent/agent-tool-registry';
import type { PluginManager } from './plugin-manager';
import { PluginCommandStore } from './plugin-command-store';
import { parsePluginManifest } from './manifest';
import renameManifest from '../../../samples/batch-rename/manifest.json';
import outputManifest from '../../../samples/csv-export/manifest.json';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn(), outputPrepare: vi.fn(), outputExecute: vi.fn(), revoke: vi.fn(), release: vi.fn(), verify: vi.fn(), receipt: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, net: { fetch: vi.fn() } }));
vi.mock('./isolated-view', () => ({ PluginDevelopmentHost: class { dispose() {} } }));
vi.mock('./plugin-tool-runtime', async importOriginal => ({ ...await importOriginal<typeof import('./plugin-tool-runtime')>(), PluginToolRuntime: class { dispose() {} } }));
vi.mock('../agent/agent-plugin-rename', () => ({ createAgentPluginRenameService: () => ({ prepare: mocks.prepare, execute: mocks.execute }) }));
vi.mock('../agent/agent-plugin-file-output', () => ({ createAgentPluginFileOutputService: () => ({ prepare: mocks.outputPrepare, execute: mocks.outputExecute, revoke: mocks.revoke, releaseRun: mocks.release }) }));
vi.mock('../agent/plugin-rename-transport', () => ({ createPluginRenameTransport: () => ({ verifyActor: mocks.verify, statusForAction: mocks.receipt }) }));
import { createPluginCommandService } from './plugin-command-service';

const ownerScope = { accountScope: 'user:7', backendScope: 'https://backend.test/api' };
const disposers: Array<() => void> = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
function fixture(kind: 'rename' | 'output' = 'rename') {
  const directory = mkdtempSync(path.join(tmpdir(), 'omniflow-command-test-'));
  const storePath = path.join(directory, 'history.json');
  const store = new PluginCommandStore(storePath);
  const manifest = parsePluginManifest(kind === 'rename' ? renameManifest : outputManifest, 'darwin');
  const plugin = { ...manifest, fingerprint: 'a'.repeat(64), commands: manifest.commands! };
  const tool = manifest.agentTools![0];
  const command = manifest.commands![0];
  const listeners = new Set<(id?: string) => void>();
  const manager = { catalog: () => ({ plugins: [plugin] }), resolveTool: vi.fn(() => ({ plugin, tool, registrationId: 'plugin-tool:' + 'b'.repeat(64) })), stillToolAllowed: vi.fn(() => true),
    attachRuntime: (listener: (id?: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const sender = { id: 9, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents;
  const parent = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow;
  const service = createPluginCommandService({ manager: manager as unknown as PluginManager, getMainWindow: () => parent, store, apiBaseUrl: ownerScope.backendScope });
  const input: PluginCommandPrepareRequest = { ownerScope, libraryId: 3, pluginId: plugin.id, commandId: command.id, nodeIds: kind === 'rename' ? [7, 8] : [7], parameters: kind === 'rename' ? { prefix: 'new-' } : { format: 'json' }, ...(kind === 'output' ? { destination: { parentId: 5, fileName: 'output.json' } } : {}) };
  const renameAction: AgentPreparedActionPublic = { kind: 'plugin.rename', version: 1, libraryId: 3, operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', pluginId: plugin.id,
    pluginVersion: plugin.version, packageFingerprint: plugin.fingerprint, items: [{ nodeId: 7, parentId: 5, oldName: 'one.csv', newName: 'new-one.csv' }] };
  const action: AgentPreparedActionPublic = kind === 'rename' ? renameAction : { kind: 'plugin.file-output', version: 1, libraryId: 3, operationId: renameAction.operationId, pluginId: plugin.id, pluginVersion: plugin.version, packageFingerprint: plugin.fingerprint, sourceNodeId: 7, parentId: 5, fileName: 'output.json', providerId: 'local', mediaType: 'application/json', sizeBytes: 10, sha256: 'c'.repeat(64) };
  const preparation: AgentToolMainPreparationResult = { publicAction: action, binding: { private: 'must-not-persist' }, snapshotMaterial: { revision: 'first' }, decision: { behavior: 'ask', risk: 'write', preview: { title: '改名', description: '核对', risk: 'write' } } };
  mocks.prepare.mockResolvedValue(preparation); mocks.outputPrepare.mockResolvedValue(preparation);
  mocks.release.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(undefined); mocks.receipt.mockResolvedValue(null);
  const unknown: AgentToolResult = { ok: false, message: 'unknown', data: { mutationCommitState: 'commit_unknown', operationId: action.operationId, libraryId: 3 } };
  const committed: AgentToolResult = { ok: true, message: 'done', data: { mutationCommitState: 'committed', operationId: action.operationId, libraryId: 3 } };
  mocks.execute.mockImplementation(async (_request, _preparation, commit: AgentMainCommitSettlement) => { commit.begin(unknown); commit.settle(committed); return committed; });
  mocks.outputExecute.mockImplementation(async (...args) => mocks.execute(...args));
  disposers.push(() => { service.dispose(); rmSync(directory, { recursive: true, force: true }); });
  const operation = (record: PluginCommandExecution) => ({ ownerScope, libraryId: 3, executionId: record.id, expectedRevision: record.revision });
  return { store, storePath, service, sender, input, action, preparation, unknown, committed, manager, listeners, operation };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); });

describe('manual plugin command owner', () => {
  it('owns an execution without model records and rechecks a revision-bound approval before writing', async () => {
    const f = fixture(); const prepared = await f.service.prepare(f.sender, f.input);
    expect(prepared.status).toBe('awaiting-approval'); expect(mocks.execute).not.toHaveBeenCalled();
    expect(f.manager.resolveTool).toHaveBeenCalledWith(f.input.commandId.replace(/[^.]+$/, 'propose'), 'a'.repeat(64), 'command');
    const completed = await f.service.approve(f.sender, f.operation(prepared));
    expect(completed.status).toBe('completed'); expect(mocks.prepare).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledOnce();
    const disk = readFileSync(f.storePath, 'utf8'); expect(disk).not.toContain('must-not-persist'); expect(disk).not.toContain('new-"');
    expect(JSON.parse(disk)).toMatchObject({ version: 1, records: [{ id: prepared.id, status: 'completed' }] });
  });
  it('uses the shared file-output preparation and commit path with a sealed lifetime and destination', async () => {
    const f = fixture('output'); const prepared = await f.service.prepare(f.sender, f.input);
    expect(prepared.status).toBe('awaiting-approval'); expect(prepared.action?.kind).toBe('plugin.file-output');
    expect(mocks.outputPrepare).toHaveBeenCalledWith(expect.objectContaining({ input: { resource: { nodeId: 7 }, destination: { parentId: 5, fileName: 'output.json' }, format: 'json' }, lifetimeSignal: expect.any(AbortSignal) }));
    expect((await f.service.approve(f.sender, f.operation(prepared))).status).toBe('completed');
    expect(mocks.outputExecute).toHaveBeenCalledOnce(); expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(`manual:${prepared.id}`);
  });
  it('retains the durable unknown fallback if the successful settlement cannot be persisted', async () => {
    const f = fixture(); const prepared = await f.service.prepare(f.sender, f.input);
    const realSave = f.store.save.bind(f.store);
    vi.spyOn(f.store, 'save').mockImplementation(record => { if (record.status === 'completed') throw new Error('disk unavailable'); realSave(record); });
    expect((await f.service.approve(f.sender, f.operation(prepared))).status).toBe('commit-unknown');
    expect(new PluginCommandStore(f.storePath).get(prepared.id)?.status).toBe('commit-unknown');
  });
  it('keeps upload-only unknown receipts queryable and preserves their original action after restart', async () => {
    const f = fixture('output');
    const result: AgentToolResult = { ok: false, message: '上传回执未知', data: { uploadCommitState: 'commit_unknown', operationId: f.action.operationId, libraryId: 3 } };
    mocks.outputExecute.mockImplementation(async (_request, _preparation, commit: AgentMainCommitSettlement) => {
      commit.begin(result); commit.settle(result); return result;
    });
    const prepared = await f.service.prepare(f.sender, f.input);
    const unknown = await f.service.approve(f.sender, f.operation(prepared));
    expect(unknown).toMatchObject({ status: 'commit-unknown', approvedAt: expect.any(String), action: f.action, result });
    expect(new PluginCommandStore(f.storePath).get(unknown.id)).toMatchObject({ status: 'commit-unknown', action: f.action, result });
  });
  it('returns a fresh preview if files or output changed and never executes the stale approval', async () => {
    const f = fixture(); const prepared = await f.service.prepare(f.sender, f.input);
    mocks.prepare.mockResolvedValueOnce({ ...f.preparation, snapshotMaterial: { revision: 'changed' } });
    const updated = await f.service.approve(f.sender, f.operation(prepared));
    expect(updated.status).toBe('awaiting-approval'); expect(updated.revision).toBeGreaterThan(prepared.revision); expect(mocks.execute).not.toHaveBeenCalled();
    await expect(f.service.approve(f.sender, f.operation(prepared))).rejects.toThrow('已变化');
  });
  it('persists an unknown result before dispatch; cancellation cannot erase the authoritative success', async () => {
    const f = fixture(); const started = deferred<void>(); const finish = deferred<void>();
    mocks.execute.mockImplementation(async (_request, _preparation, commit: AgentMainCommitSettlement) => {
      commit.begin(f.unknown); expect(JSON.parse(readFileSync(f.storePath, 'utf8')).records[0].status).toBe('commit-unknown');
      started.resolve(); await finish.promise; commit.settle(f.committed); return f.committed;
    });
    const prepared = await f.service.prepare(f.sender, f.input); const execution = f.service.approve(f.sender, f.operation(prepared)); await started.promise;
    const inFlight = f.service.list(f.sender, { ownerScope, libraryId: 3 })[0];
    expect(f.service.cancel(f.sender, f.operation(inFlight)).status).toBe('commit-unknown'); finish.resolve();
    expect((await execution).status).toBe('completed');
  });
  it('recovers pending approvals as interrupted and dispatched writes as unknown without resending', async () => {
    const f = fixture(); const prepared = await f.service.prepare(f.sender, f.input);
    expect(new PluginCommandStore(f.storePath).get(prepared.id)?.status).toBe('interrupted');
    mocks.execute.mockImplementation(async (_request, _preparation, commit: AgentMainCommitSettlement) => { commit.begin(f.unknown); throw new Error('lost response'); });
    await f.service.approve(f.sender, f.operation(prepared));
    const restored = new PluginCommandStore(f.storePath).get(prepared.id)!;
    expect(restored.status).toBe('commit-unknown'); expect(restored.action).toEqual(f.action); expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it('rejects scope substitution, reserved resource parameters and duplicate approvals', async () => {
    const f = fixture(); await expect(f.service.prepare(f.sender, { ...f.input, parameters: { resource: { nodeId: 99 } } })).rejects.toThrow('参数无效');
    const prepared = await f.service.prepare(f.sender, f.input);
    await expect(f.service.approve(f.sender, { ...f.operation(prepared), libraryId: 4 })).rejects.toThrow('已变化');
    await f.service.approve(f.sender, f.operation(prepared)); await expect(f.service.approve(f.sender, f.operation(prepared))).rejects.toThrow('已变化');
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it('revokes a pending approval when the library releases or the plugin stops', async () => {
    const f = fixture(); const first = await f.service.prepare(f.sender, f.input); f.service.release(f.sender, { ownerScope, libraryId: 3 });
    expect(f.store.get(first.id)?.status).toBe('cancelled');
    const second = await f.service.prepare(f.sender, f.input); for (const listener of f.listeners) listener(f.input.pluginId);
    expect(f.store.get(second.id)?.status).toBe('cancelled'); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('queries only the persisted operation and keeps missing receipts unknown', async () => {
    const f = fixture(); mocks.execute.mockImplementation(async (_request, _preparation, commit: AgentMainCommitSettlement) => { commit.begin(f.unknown); commit.settle(f.unknown); return f.unknown; });
    const prepared = await f.service.prepare(f.sender, f.input); const unknown = await f.service.approve(f.sender, f.operation(prepared));
    const checked = await f.service.reconcile(f.sender, { ...f.operation(unknown), credentials: { token: 'not-persisted', username: 'user' } });
    expect(checked.status).toBe('commit-unknown'); expect(checked.originalResult).toEqual(f.unknown); expect(checked.receiptChecks).toHaveLength(1);
    expect(mocks.receipt).toHaveBeenCalledWith(f.action, { token: 'not-persisted', username: 'user' }, expect.any(AbortSignal));
    expect(readFileSync(f.storePath, 'utf8')).not.toContain('not-persisted');
  });
});

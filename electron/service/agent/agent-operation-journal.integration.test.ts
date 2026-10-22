import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentToolSummary } from '../../../src/features/agent/agent-tool-presentation';
import { executeAgentFileWrite, type AgentFileWriteDependencies } from '../../../src/features/agent/services/agent-file-write';
import type { AgentToolExecutionRequest } from '../../../src/shared/agent/agent.types';
import { createAgentFileChangeStore, type AgentFileChangeStore } from './agent-file-change-store';
import { readAgentOperationJournal } from './agent-operation-journal';
import { bootstrapAgentPersistenceDatabase } from './agent-persistence-runtime';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';
import { createAgentToolBroker } from './agent-tool-broker';
import { createAgentToolRegistry, type AgentToolDispatchContext } from './agent-tool-registry';
import { filePatchTool } from './tools/file-patch-tool';
import { fileWriteTool } from './tools/file-write-tool';
import { operationVerifyTool } from './tools/operation-verify-tool';
import * as localFile from './tools/agent-local-file';

const OWNER = { accountScope: 'user:7', backendScope: 'https://fixture.invalid/api' };
const NOW = '2026-10-22T00:00:00.000Z';
const APP_CONTEXT = { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] };
const SOURCE = 'old\n';
const REVISION = createHash('sha256').update(SOURCE).digest('hex');

describe('durable production mutation receipt wiring', () => {
  const directories: string[] = [];
  const stores: (AgentSessionStore | AgentFileChangeStore)[] = [];
  afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()));
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });

  it.each([
    { scope: 'host', toolName: 'file.write' }, { scope: 'host', toolName: 'file.patch' },
    { scope: 'library', toolName: 'file.write' }, { scope: 'library', toolName: 'file.patch' },
  ] as const)('preserves actual $scope $toolName no-op through Broker, SQLite reopen, journal and registered verify', async ({ scope, toolName }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-operation-wiring-')); directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    await bootstrapAgentPersistenceDatabase(databasePath);
    let sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    const changes = await createAgentFileChangeStore(databasePath, path.join(directory, 'snapshots')); stores.push(changes);
    const identity = { ownerScope: OWNER, libraryId: 3, sessionId: 'session-1', runId: 'run-1',
      toolRunId: 'tool-run-1', operationId: 'main-operation-1' };
    const targetPath = scope === 'host' ? path.join(directory, 'target.txt') : '/target.txt';
    const input = { scope, path: targetPath, revision: REVISION, ...(toolName === 'file.patch'
      ? { format: 'context-v1', patch: '@@\n-old\n+old\n' } : { content: SOURCE }) };
    await sessions.createSession({ id: identity.sessionId, ownerScope: OWNER, title: 'Synthetic no-op', appContext: APP_CONTEXT, now: NOW });
    await sessions.createRun({ id: identity.runId, sessionId: identity.sessionId, model: 'fixture-model',
      profileId: 'fixture-profile', reasoningEffort: 'auto', userPrompt: 'fixture', now: NOW });
    await sessions.createToolRun({ id: identity.toolRunId, runId: identity.runId, callId: 'call-1', toolName,
      input, permissionBehavior: 'allow', status: 'running', now: NOW });
    await writeFile(path.join(directory, 'target.txt'), SOURCE);
    const before = await stat(path.join(directory, 'target.txt'));
    const prepare = vi.fn(async (...args: Parameters<AgentFileChangeStore['prepare']>) => changes.prepare(...args));
    const settle = vi.fn(async (...args: Parameters<AgentFileChangeStore['settle']>) => changes.settle(...args));
    const prepareMutation = vi.fn(async () => undefined), beforeCommit = vi.fn(async () => undefined);
    const update = vi.fn(), onCommitted = vi.fn();
    const dependencies: AgentFileWriteDependencies = {
      assertOwner: vi.fn(), prepareMutation, beforeCommit, update, onCommitted,
      resolvePath: vi.fn(async () => ({ id: 9, parentId: 8, libraryId: 3, type: 'file' as const, name: 'target', ext: 'txt', path: '/target.txt' })),
      detail: vi.fn(async () => ({ id: 9, parentId: 8, libraryId: 3, type: 'file', name: 'target', ext: 'txt',
        storageKey: 'synthetic-binding', fileSize: SOURCE.length }) as Awaited<ReturnType<NonNullable<AgentFileWriteDependencies['detail']>>>),
      readBytes: vi.fn(async () => new TextEncoder().encode(SOURCE)),
    };
    const registry = createAgentToolRegistry([fileWriteTool, filePatchTool, operationVerifyTool]);
    const snapshot = registry.createSnapshot();
    const broker = createAgentToolBroker({ toolRegistry: registry });
    const readLibraryMetadata = vi.fn();
    const context: AgentToolDispatchContext = { appContext: APP_CONTEXT, onProgress: vi.fn(), signal: new AbortController().signal,
      fileMutation: { operationId: identity.operationId,
        prepare: (mutation, signal) => prepare(identity, mutation, signal), settle: result => settle(identity, result) },
      executeLibraryFileMutation: async (normalized, signal) => {
        const request: AgentToolExecutionRequest = { appContext: APP_CONTEXT, executionId: 'renderer-execution-1',
          ownerScope: OWNER, runId: identity.runId, sessionId: identity.sessionId, toolName,
          input: { ...(normalized as Record<string, unknown>), libraryId: 3 } };
        const outcome = await executeAgentFileWrite(request, { ...dependencies, signal });
        return { ...outcome.result, data: { ...(outcome.result.data as Record<string, unknown>), operationId: identity.operationId } };
      },
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) } as unknown as AgentToolDispatchContext['runCapabilitySnapshot'], readLibraryMetadata,
      readOperationJournal: (operationId: string, signal: AbortSignal) => readAgentOperationJournal({ operationId, signal,
        readSession: () => sessions.getSession(identity.sessionId, OWNER, 3) }),
    };
    const result = await broker.executeMain(toolName, input, context, 10_000, snapshot);
    expect(result).toMatchObject({ ok: true, data: { operationId: identity.operationId, changed: false, outcome: 'unchanged',
      beforeRevision: REVISION, afterRevision: REVISION, mutationCommitState: 'uncommitted', writeCommitState: 'uncommitted' } });
    for (const effect of [prepare, settle, prepareMutation, beforeCommit, update, onCommitted]) expect(effect).not.toHaveBeenCalled();
    expect(await readFile(path.join(directory, 'target.txt'), 'utf8')).toBe(SOURCE);
    expect((await stat(path.join(directory, 'target.txt'))).mtimeMs).toBe(before.mtimeMs);
    expect((await readdir(directory)).filter(name => name.startsWith('.omniflow-'))).toEqual([]);
    await sessions.completeToolRun(identity.toolRunId, result, NOW);
    await sessions.close(); stores.splice(stores.indexOf(sessions), 1);
    sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    const persisted = await sessions.getSession(identity.sessionId, OWNER, 3);
    expect(persisted?.toolActivities).toEqual([expect.objectContaining({ id: identity.toolRunId, status: 'completed', result })]);
    expect(buildAgentToolSummary(persisted!.toolActivities[0], 3)).toEqual({ label: '未修改', subject: 'target.txt' });
    for (const operationId of [identity.operationId, identity.toolRunId]) {
      const verified = await broker.executeMain('operation.verify', { operationId }, context, 10_000, snapshot);
      expect(verified).toMatchObject({ ok: true, data: { operationId, status: 'not_committed', journalStatus: 'uncommitted',
        changed: false, outcome: 'unchanged', node: null } });
    }
    expect(readLibraryMetadata).not.toHaveBeenCalled();
    const unknown = await broker.executeMain('operation.verify', { operationId: 'missing-operation' }, context, 10_000, snapshot);
    expect(unknown).toMatchObject({ ok: true, data: { status: 'commit_unknown', journalStatus: 'unknown', nextAction: 'verify_receipt' } });
    expect(readLibraryMetadata).not.toHaveBeenCalled();
    await expect(broker.executeMain('operation.verify', { operationId: identity.operationId, nodeId: 9 }, context, 10_000, snapshot))
      .rejects.toThrow('参数不符合输入约束');
    expect(await changes.list(identity, [identity.runId])).toMatchObject({ changes: [], coverage: 'structured-file-writes' });
    expect((await sessions.getSession(identity.sessionId, OWNER, 3))?.toolActivities[0].result).toEqual(result);
  });

  it.each(['file.write', 'file.patch'])('does not reconcile another session\'s durable %s from current node metadata', async toolName => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-cross-session-verify-')); directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    await bootstrapAgentPersistenceDatabase(databasePath);
    let sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    for (const name of ['previous', 'current']) {
      await sessions.createSession({ id: `session-${name}`, ownerScope: OWNER, title: `Synthetic ${name}`, appContext: APP_CONTEXT, now: NOW });
      await sessions.createRun({ id: `run-${name}`, sessionId: `session-${name}`, model: 'fixture-model',
        profileId: 'fixture-profile', reasoningEffort: 'auto', userPrompt: 'fixture', now: NOW });
    }
    for (const state of ['committed', 'commit_unknown'] as const) {
      await sessions.createToolRun({ id: `previous-tool-${state}`, runId: 'run-previous', callId: `previous-call-${state}`,
        toolName, input: {}, permissionBehavior: 'allow', status: 'running', now: NOW });
      await sessions.completeToolRun(`previous-tool-${state}`, { ok: false, data: {
        operationId: `previous-operation-${state}`, mutationCommitState: state, writeCommitState: state,
      } }, NOW);
    }
    const renameResult = { ok: false, data: { operationId: 'current-rename-operation', mutationCommitState: 'commit_unknown' } };
    await sessions.createToolRun({ id: 'current-rename-tool', runId: 'run-current', callId: 'current-rename-call',
      toolName: 'file.rename', input: { nodeId: 9, name: 'target.txt' }, permissionBehavior: 'allow', status: 'running', now: NOW });
    await sessions.completeToolRun('current-rename-tool', renameResult, NOW);
    await sessions.close(); stores.splice(stores.indexOf(sessions), 1);
    sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    const readLibraryMetadata = vi.fn(async () => ({ libraryId: 3,
      node: { id: 9, libraryId: 3, parentId: 8, name: 'target', ext: 'txt', type: 'file' as const } }));
    const context: AgentToolDispatchContext = {
      appContext: APP_CONTEXT, onProgress: vi.fn(), signal: new AbortController().signal, readLibraryMetadata,
      readOperationJournal: (operationId, signal) => readAgentOperationJournal({ operationId, signal,
        readSession: () => sessions.getSession('session-current', OWNER, 3) }),
    };
    const registry = createAgentToolRegistry([operationVerifyTool]);
    const snapshot = registry.createSnapshot();
    const broker = createAgentToolBroker({ toolRegistry: registry });
    for (const state of ['committed', 'commit_unknown'] as const) {
      const operationId = `previous-operation-${state}`;
      expect(await readAgentOperationJournal({ operationId, signal: context.signal,
        readSession: () => sessions.getSession('session-previous', OWNER, 3) })).toMatchObject({ toolName, status: state });
      for (const id of [operationId, `previous-tool-${state}`]) {
        for (const expectedExists of [true, false]) {
          expect(await broker.executeMain('operation.verify', { operationId: id, nodeId: 9, expectedExists,
            expectedParentId: 8, expectedName: 'target.txt' }, context, 10_000, snapshot)).toMatchObject({
            ok: true, data: { operationId: id, status: 'commit_unknown', journalStatus: 'unknown', node: null,
              nextAction: 'verify_receipt', retryAllowed: false },
          });
        }
      }
    }
    expect(readLibraryMetadata).not.toHaveBeenCalled();
    expect(await broker.executeMain('operation.verify', { operationId: 'current-rename-operation', nodeId: 9,
      expectedExists: true, expectedParentId: 8, expectedName: 'target.txt' }, context, 10_000, snapshot))
      .toMatchObject({ ok: true, data: { status: 'committed', journalStatus: 'commit_unknown', node: { id: 9 } } });
    expect(readLibraryMetadata).toHaveBeenCalledTimes(1);
    expect((await sessions.getSession('session-current', OWNER, 3))?.toolActivities[0].result).toEqual(renameResult);
    expect((await sessions.getSession('session-previous', OWNER, 3))?.toolActivities.map(activity => activity.result?.data))
      .toEqual(['committed', 'commit_unknown'].map(state => ({ operationId: `previous-operation-${state}`,
        mutationCommitState: state, writeCommitState: state })));
  });

  it.each(['file.write', 'file.patch'])('persists an actual host %s no-op cancelled during handle close without inventing a commit or Diff', async toolName => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-cancelled-noop-')); directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    await bootstrapAgentPersistenceDatabase(databasePath);
    let sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    const changes = await createAgentFileChangeStore(databasePath, path.join(directory, 'snapshots')); stores.push(changes);
    const identity = { ownerScope: OWNER, libraryId: 3, sessionId: 'session-1', runId: 'run-1', toolRunId: 'tool-run-1',
      operationId: '83fc584b-037d-4c82-8883-a609846ea0d4' };
    await sessions.createSession({ id: identity.sessionId, ownerScope: OWNER, title: 'Synthetic cancelled no-op', appContext: APP_CONTEXT, now: NOW });
    await sessions.createRun({ id: identity.runId, sessionId: identity.sessionId, model: 'fixture-model',
      profileId: 'fixture-profile', reasoningEffort: 'auto', userPrompt: 'fixture', now: NOW });
    const targetPath = path.join(directory, 'target.txt');
    const input = { scope: 'host', path: targetPath, revision: REVISION, ...(toolName === 'file.patch'
      ? { format: 'context-v1', patch: '@@\n-old\n+old\n' } : { content: SOURCE }) };
    await sessions.createToolRun({ id: identity.toolRunId, runId: identity.runId, callId: 'call-1', toolName,
      input, permissionBehavior: 'allow', status: 'running', now: NOW });
    await writeFile(targetPath, SOURCE);
    const before = await stat(targetPath);
    const controller = new AbortController();
    const prepare = vi.fn(async (...args: Parameters<AgentFileChangeStore['prepare']>) => changes.prepare(...args));
    const settle = vi.fn(async (...args: Parameters<AgentFileChangeStore['settle']>) => changes.settle(...args));
    const registry = createAgentToolRegistry([fileWriteTool, filePatchTool, operationVerifyTool]);
    const snapshot = registry.createSnapshot();
    const broker = createAgentToolBroker({ toolRegistry: registry });
    const readLibraryMetadata = vi.fn();
    const context: AgentToolDispatchContext = { appContext: APP_CONTEXT, onProgress: vi.fn(), signal: controller.signal,
      fileMutation: { operationId: identity.operationId,
        prepare: (mutation, signal) => prepare(identity, mutation, signal), settle: result => settle(identity, result) },
      runCapabilitySnapshot: { getTool: (name: string) => snapshot.get(name) } as unknown as AgentToolDispatchContext['runCapabilitySnapshot'],
      readLibraryMetadata, readOperationJournal: (operationId, signal) => readAgentOperationJournal({ operationId, signal,
        readSession: () => sessions.getSession(identity.sessionId, OWNER, 3) }),
    };
    const originalOpen = localFile.openAgentLocalFile;
    let closeCount = 0;
    const openedFile = vi.spyOn(localFile, 'openAgentLocalFile').mockImplementation(async (...args) => {
      const opened = await originalOpen(...args);
      const originalClose = opened.fileHandle.close.bind(opened.fileHandle);
      opened.fileHandle.close = async () => { closeCount++; controller.abort(); return originalClose(); };
      return opened;
    });
    try {
      const result = await broker.executeMain(toolName, input, context, 10_000, snapshot);
      expect(controller.signal.aborted).toBe(true);
      expect(closeCount).toBe(1);
      expect(result).toMatchObject({ ok: true, data: { operationId: identity.operationId, changed: false, outcome: 'unchanged',
        revision: REVISION, beforeRevision: REVISION, afterRevision: REVISION,
        writeCommitState: 'uncommitted', mutationCommitState: 'uncommitted' } });
      expect(prepare).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
      expect(await readFile(targetPath, 'utf8')).toBe(SOURCE);
      expect(await stat(targetPath)).toMatchObject({ ino: before.ino, mtimeMs: before.mtimeMs });
      await sessions.completeToolRun(identity.toolRunId, result, NOW);
      await sessions.close(); stores.splice(stores.indexOf(sessions), 1);
      sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
      const persisted = (await sessions.getSession(identity.sessionId, OWNER, 3))!.toolActivities[0];
      expect(persisted).toMatchObject({ status: 'completed', result });
      expect(buildAgentToolSummary(persisted, 3)).toEqual({ label: '未修改', subject: 'target.txt' });
      for (const operationId of [identity.operationId, identity.toolRunId]) {
        expect(await broker.executeMain('operation.verify', { operationId }, { ...context, signal: new AbortController().signal }, 10_000, snapshot))
          .toMatchObject({ ok: true, data: { operationId, status: 'not_committed', journalStatus: 'uncommitted',
            changed: false, outcome: 'unchanged', node: null } });
      }
      expect(readLibraryMetadata).not.toHaveBeenCalled();
      expect(await changes.list(identity, [identity.runId])).toMatchObject({ changes: [], coverage: 'structured-file-writes' });
    } finally { openedFile.mockRestore(); }
  });

  it.each([
    { toolName: 'file.write', status: 'failed' }, { toolName: 'file.patch', status: 'failed' },
    { toolName: 'file.write', status: 'cancelled' }, { toolName: 'file.patch', status: 'cancelled' },
  ] as const)('projects durable $status $toolName receipts independently of the ToolRun outcome', async ({ toolName, status }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-file-summary-')); directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    await bootstrapAgentPersistenceDatabase(databasePath);
    let sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    await sessions.createSession({ id: 'session-1', ownerScope: OWNER, title: 'Synthetic terminal receipts', appContext: APP_CONTEXT, now: NOW });
    await sessions.createRun({ id: 'run-1', sessionId: 'session-1', model: 'fixture-model',
      profileId: 'fixture-profile', reasoningEffort: 'auto', userPrompt: 'fixture', now: NOW });
    const receipts = [
      { label: '已保存', data: { mutationCommitState: 'committed', writeCommitState: 'committed' } },
      { label: '文件未保存', data: { mutationCommitState: 'uncommitted', writeCommitState: 'uncommitted' } },
      { label: '保存待核对', data: { mutationCommitState: 'commit_unknown', writeCommitState: 'commit_unknown' } },
      { label: '保存待核对', data: { mutationCommitState: 'committed', writeCommitState: 'uncommitted' } },
      { label: '保存待核对', data: {} },
    ];
    for (const [index, receipt] of receipts.entries()) {
      const toolRunId = `tool-run-${index}`;
      await sessions.createToolRun({ id: toolRunId, runId: 'run-1', callId: `call-${index}`, toolName,
        input: {}, permissionBehavior: 'allow', status: 'running', now: NOW });
      await sessions.completeToolRun(toolRunId, { ok: false, message: '保存后续处理已停止',
        data: { fileName: 'result.txt', ...receipt.data } }, NOW, status === 'cancelled' ? 'cancelled' : undefined);
    }
    await sessions.close(); stores.splice(stores.indexOf(sessions), 1);
    sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    const persisted = await sessions.getSession('session-1', OWNER, 3);
    expect(persisted?.toolActivities).toHaveLength(receipts.length);
    for (const [index, activity] of persisted!.toolActivities.entries()) {
      expect(activity).toMatchObject({ status, result: { ok: false, message: '保存后续处理已停止' } });
      expect(buildAgentToolSummary(activity, 3)).toEqual({ label: receipts[index].label, subject: 'result.txt' });
    }
  });
});

import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import { PluginManager } from '../../electron/service/extensions/plugin-manager';
import { PluginDevelopmentHost } from '../../electron/service/extensions/isolated-view';
import { PluginToolRuntime } from '../../electron/service/extensions/plugin-tool-runtime';
import { createAgentPluginRenameService } from '../../electron/service/agent/agent-plugin-rename';
import { createPluginRenameTransport, type ConditionalRenameRequest, type ConditionalRenameReceipt } from '../../electron/service/agent/plugin-rename-transport';
import { createAgentOrchestrator } from '../../electron/service/agent/agent-orchestrator';
import { createSQLiteAgentSessionStore } from '../../electron/service/agent/agent-session-store';
import { createAIServiceRunSessionRegistry } from '../../electron/service/aiServiceRunSession';
import { createAgentCapabilitySnapshot } from '../../electron/service/agent/capabilities/agent-capability-registry';
import { sanitizeAgentSensitiveText } from '../../electron/service/agent/agent-sensitive-data';
import { toAgentProviderToolName } from '../../electron/service/agent/agent-provider-tool-name';
import type { AgentLibraryNode } from '../../src/shared/agent/agent-library-query';
import type { AgentChatStreamEvent, AgentFileAuthorityResultV1, AgentPluginRenamePreparedActionPublicV1, AgentToolApprovalSnapshot } from '../../src/shared/agent/agent.types';

const work = process.env.OMNIFLOW_RENAME_WORK!;
const pluginId = 'example.batch-rename', toolId = `${pluginId}.propose`;
const SCENARIOS = ['approve', 'deny', 'lost-response', 'full-access', 'cancel-committed', 'cancel-unknown'] as const;
type Scenario = typeof SCENARIOS[number];
type FileState = { id: number; name: string; ext: string; updatedAt: string };
type Stats = { model: number; actor: number; dryRun: number; commit: number; status: number; mutations: number; authorities: number; approvals: number };
const initialFiles = (): FileState[] => [11, 12].map((id, index) => ({ id, name: index ? 'second' : 'first', ext: 'txt', updatedAt: '2026-09-22T10:00:00.000001Z' }));
const emptyStats = (): Stats => ({ model: 0, actor: 0, dryRun: 0, commit: 0, status: 0, mutations: 0, authorities: 0, approvals: 0 });
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function readPersistedTool(databasePath: string, toolRunId: string) {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(db));
  });
  try {
    return await new Promise<{ status: string; result_json: string }>((resolve, reject) => database.get(
      'SELECT status, result_json FROM agent_tool_runs WHERE id = ?', [toolRunId], (error, row) => error ? reject(error) : resolve(row as { status: string; result_json: string }),
    ));
  } finally { await new Promise<void>((resolve, reject) => database.close(error => error ? reject(error) : resolve())); }
}
app.on('window-all-closed', () => undefined);

async function main() {
  await app.whenReady();
  let scenario: Scenario = 'approve', files = initialFiles(), stats = emptyStats(), serverFailure: unknown;
  let commitReceived = gate(), releaseCommit = gate();
  const losesCommitReplies = () => scenario === 'lost-response' || scenario === 'cancel-unknown';
  const cancellingCommit = () => scenario === 'cancel-committed' || scenario === 'cancel-unknown';
  const receipts = new Map<string, ConditionalRenameReceipt>();
  const requests: ConditionalRenameRequest[] = [];
  const accountId = 900000001;
  const server = createServer(async (request, response) => {
    const json = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: '0', message: 'OK', request_id: 'rename-lab', data })); };
    try {
      const url = new URL(request.url ?? '/', 'http://lab.invalid');
      let body = ''; for await (const chunk of request) body += chunk;
      if (url.pathname === '/model/v1/chat/completions') {
        stats.model++;
        const payload = JSON.parse(body);
        const advertised = payload.tools?.some((tool: { function?: { name?: string } }) => tool.function?.name === toAgentProviderToolName(toolId));
        assert(advertised, 'Rename Tool must be advertised from the installed package');
        const resultSeen = payload.messages.some((message: { role: string }) => message.role === 'tool');
        const delta = resultSeen ? { content: scenario === 'deny' ? '用户拒绝提案，文件未改动。' : '已完成两个文件的重命名。' }
          : { tool_calls: [{ index: 0, id: `rename-${scenario}`, type: 'function', function: { name: toAgentProviderToolName(toolId), arguments: JSON.stringify({ resources: [11, 12], prefix: 'renamed_' }) } }] };
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: resultSeen ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`); return;
      }
      assert(request.headers.authorization === 'Bearer synthetic-rename-token' && request.headers.username === 'synthetic-rename-user', 'Only synthetic scoped credentials may reach the fixture');
      if (url.pathname === '/api/v1/user/me') { stats.actor++; json({ id: accountId }); return; }
      if (url.pathname === '/api/v1/nodes/rename/batch/status') {
        stats.status++; assert.equal(url.searchParams.get('libraryId'), '3');
        if (scenario === 'cancel-unknown') { response.writeHead(503); response.end(); return; }
        const operationId = url.searchParams.get('operationId')!; const receipt = receipts.get(operationId);
        json({ libraryId: 3, operationId, state: receipt ? 'committed' : 'not_found', ...(receipt ? { result: receipt } : {}) }); return;
      }
      if (url.pathname !== '/api/v1/nodes/rename/batch/conditional') { response.writeHead(404); response.end(); return; }
      const input = JSON.parse(body) as ConditionalRenameRequest;
      assert.equal(input.libraryId, 3); assert.deepEqual(input.items.map(item => item.nodeId), [11, 12]);
      requests.push(structuredClone(input));
      const dryRun = url.searchParams.get('dryRun') === 'true';
      if (dryRun) stats.dryRun++; else stats.commit++;
      if (!dryRun && receipts.has(input.operationId)) {
        // Chromium can replay a connection failure internally. Keep every commit reply lost,
        // while the operation receipt ensures that only one mutation can take place.
        if (losesCommitReplies()) response.destroy();
        else json({ ...receipts.get(input.operationId), replayed: true });
        return;
      }
      for (const item of input.items) {
        const file = files.find(file => file.id === item.nodeId)!;
        if (item.expected.parentId !== 10 || item.expected.name !== file.name || item.expected.ext !== file.ext || item.expected.updatedAt !== file.updatedAt) {
          response.writeHead(409); response.end(JSON.stringify({ error: 'conditional conflict' })); return;
        }
      }
      if (!dryRun && cancellingCommit()) {
        // The request is already in flight. Cancellation is issued before this fixture
        // commits or replies, exercising the production bounded settlement path.
        commitReceived.resolve(); await releaseCommit.promise;
      }
      const state = dryRun ? 'validated' : 'committed';
      const receipt: ConditionalRenameReceipt = { operationId: input.operationId, libraryId: 3, atomic: true, state, replayed: false,
        affectedParentIds: [10], items: input.items.map(item => ({ nodeId: item.nodeId, parentId: 10, status: state,
          previous: { name: item.expected.name, ext: item.expected.ext, updatedAt: item.expected.updatedAt },
          current: { name: item.name, ext: item.expected.ext, updatedAt: dryRun ? item.expected.updatedAt : '2026-09-22T10:00:00.000002Z' } })) };
      if (dryRun) { json({ dryRun: true, result: receipt }); return; }
      stats.mutations++;
      files = receipt.items.map(item => ({ id: item.nodeId, ...item.current })); receipts.set(input.operationId, receipt);
      if (losesCommitReplies()) { response.destroy(); return; }
      json(receipt);
    } catch (error) { serverFailure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ownerScope = { accountScope: `user:${accountId}`, backendScope: `${origin}/api` };
  const metadataNodes = (): AgentLibraryNode[] => [
    { id: 1, libraryId: 3, parentId: 0, type: 'dir', name: 'root', path: '/' },
    { id: 10, libraryId: 3, parentId: 1, type: 'dir', name: 'rename', path: '/rename' },
    ...files.map(file => ({ ...file, libraryId: 3, parentId: 10, type: 'file' as const, fileSize: 10, path: `/rename/${file.name}.${file.ext}` })),
  ];
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await parent.loadURL('data:text/html,<h1>Synthetic plugin rename lab</h1>');
  const manager = new PluginManager(path.join(work, 'plugins'), path.join(work, 'no-bundled'));
  await manager.initialize(); const review = await manager.prepare(process.env.OMNIFLOW_RENAME_PACKAGE!); await manager.commit(review.ticket);
  await manager.action(pluginId, 'enable');
  assert.equal(manager.toolSnapshot().length, 0, 'Enable must not approve proposal capabilities');
  await manager.action(pluginId, 'approve-tools');
  assert.equal(manager.toolSnapshot().length, 0, 'Agent Tool approval must not imply metadata proposal approval');
  await manager.action(pluginId, 'approve-rename');
  assert.equal(manager.toolSnapshot().length, 1); assert.equal(manager.catalog().plugins.find(plugin => plugin.id === pluginId)?.readApproved, false);
  const host = new PluginDevelopmentHost(parent, path.join(work, 'plugin-preload.cjs'));
  const runtime = new PluginToolRuntime(manager, host);
  const service = createAgentPluginRenameService({ manager, runtimeFor: () => runtime,
    transport: createPluginRenameTransport({ apiBaseUrl: ownerScope.backendScope }),
    request: async request => {
      request.signal.throwIfAborted(); stats.authorities++;
      assert.deepEqual(request.ownerScope, ownerScope); assert.equal(request.libraryId, 3); assert.equal(request.sender, parent.webContents);
      assert.equal(request.operation.operation, 'rename-library-files');
      if (request.operation.operation !== 'rename-library-files') throw new Error('Unexpected authority operation');
      const nodes = request.operation.nodeIds.map(id => {
        const file = files.find(file => file.id === id); assert(file, 'Only explicitly selected fixture files are exposed');
        return { ...file, libraryId: 3, parentId: 10, type: 'file' as const, fileSize: 10, version: 1 as const };
      });
      return { operation: 'rename-library-files', version: 1, nodes,
        ...(request.operation.includeCredentials ? { credentials: { token: 'synthetic-rename-token', username: 'synthetic-rename-user' } } : {}) } satisfies AgentFileAuthorityResultV1;
    },
  });
  const store = await createSQLiteAgentSessionStore(path.join(work, 'agent.sqlite3'));
  const group = await store.saveGroup(ownerScope, 3, { name: 'Synthetic rename group', access: 'read-write', directories: [{ nodeId: 10, name: '/rename' }] }, new Date().toISOString());
  const orchestrator = createAgentOrchestrator({
    getSessionStore: async () => store, getRuntimeProfile: () => ({ apiKey: '', baseUrl: `${origin}/model/v1`, providerType: 'openai' }),
    generateSessionTitle: async () => null, getModelMetadata: async () => undefined, contextBudget: { contextWindowTokens: 32000 },
    runSessionRegistry: createAIServiceRunSessionRegistry(), getPluginTools: names => manager.toolSnapshot(names),
    preparePluginRename: request => service.prepare(request), executePluginRename: (request, preparation, commit) => service.execute(request, preparation, commit),
    resolveCapabilitySnapshot: async ({ capabilityIds }) => createAgentCapabilitySnapshot({ registryRevision: 1, entries: capabilityIds.map(id => ({ id, definitionRevision: 'synthetic', scopeIdentity: 'synthetic', checkedAt: 1, state: 'unavailable' as const })) }),
    readLibraryMetadata: async input => {
      assert.equal(input.operation.operation, 'query-library-metadata');
      if (input.operation.operation !== 'query-library-metadata') throw new Error('Unexpected metadata operation');
      const query = input.operation.query; const nodes = metadataNodes();
      const node = nodes.find(item => query.path ? item.path === query.path : item.id === (query.nodeId ?? query.directoryId));
      assert(node, 'Metadata scope may not escape the synthetic hierarchy');
      return query.kind === 'list' ? { libraryId: 3, directory: node, entries: nodes.filter(item => item.parentId === node.id) } : { libraryId: 3, node };
    },
  });
  const approvals: AgentToolApprovalSnapshot[] = [];
  const originalSend = parent.webContents.send.bind(parent.webContents);
  parent.webContents.send = (channel: string, ...args: unknown[]) => {
    if (channel === 'agent:chat:event') {
      const event = args[0] as AgentChatStreamEvent;
      if (event.type === 'tool-approval-required') { stats.approvals++; approvals.push(event.approval); }
    }
    originalSend(channel, ...args);
  };
  const results: unknown[] = [];
  try {
    const selected = process.env.OMNIFLOW_RENAME_CASES ? process.env.OMNIFLOW_RENAME_CASES.split(',') : [...SCENARIOS];
    assert(selected.length > 0 && selected.every(value => SCENARIOS.includes(value as Scenario)) && new Set(selected).size === selected.length, 'Invalid or duplicate lab scenario');
    for (const nextScenario of selected as Scenario[]) {
      scenario = nextScenario; files = initialFiles(); stats = emptyStats(); approvals.length = 0; requests.length = 0;
      commitReceived = gate(); releaseCommit = gate();
      const permissionMode = scenario === 'full-access' ? 'full-access' as const : 'group' as const;
      const started = await orchestrator.start(parent.webContents, { ownerScope, profileId: 'rename-synthetic', model: 'rename-fixture', reasoningEffort: 'medium',
        ...(permissionMode === 'group' ? { groupId: group.id } : {}), permissionMode,
        appContext: { libraryId: 3, platform: 'darwin', currentDirectory: { id: 10, name: 'rename' }, selectedNodeIds: [11, 12] },
        perception: { collectedAt: new Date().toISOString(), selectedNodes: metadataNodes().slice(2), currentDirectory: { id: 10, name: 'rename', entryCount: 2, entries: metadataNodes().slice(2) } },
        userPrompt: 'Use the installed batch rename plugin to add renamed_ to both selected filenames. Keep extensions. Prepare a preview and wait for approval.' });
      const deadline = Date.now() + 35000;
      let session = await store.getSession(started.sessionId, ownerScope, 3);
      while (!approvals.length) {
        if (serverFailure) throw serverFailure;
        const run = session?.runs.find(run => run.id === started.runId);
        if (run && ['failed', 'completed', 'cancelled'].includes(run.status)) throw new Error(`Run ended before proposal approval: ${run.error ?? JSON.stringify(session?.toolActivities)}`);
        if (Date.now() > deadline) throw new Error('Rename proposal approval deadline');
        await delay(30); session = await store.getSession(started.sessionId, ownerScope, 3);
      }
      assert.equal(approvals.length, 1); const approval = approvals[0];
      assert.equal(approval.call.name, toolId); assert.equal(approval.preparation?.action.kind, 'plugin.rename');
      assert.equal(stats.commit, 0); assert.equal(stats.mutations, 0); assert.equal(stats.dryRun, 1);
      assert.deepEqual(files, initialFiles());
      const action = approval.preparation!.action as AgentPluginRenamePreparedActionPublicV1;
      assert.deepEqual(action.items.map(item => [item.oldName, item.newName]), [['first.txt', 'renamed_first.txt'], ['second.txt', 'renamed_second.txt']]);
      assert.equal(action.packageFingerprint, review.fingerprint);
      if (scenario === 'full-access') {
        // Leave the event genuinely pending briefly: full access must not dispatch
        // the prepared write while the user has not accepted its exact names.
        await delay(150);
        assert.equal(stats.commit, 0); assert.equal(stats.approvals, 1);
        const waiting = await store.getSession(started.sessionId, ownerScope, 3);
        assert.equal(waiting?.permissionMode, 'full-access');
        assert.equal(waiting?.toolActivities.find(item => item.call.name === toolId)?.status, 'awaiting_approval');
      }
      const resolution = await orchestrator.resolveToolApproval(parent.webContents.id, { approvalId: approval.approvalId,
        sessionId: started.sessionId, runId: started.runId, ownerScope, libraryId: 3, approved: scenario !== 'deny',
        preparedActionId: approval.preparation!.preparedActionId, preparedAction: approval.preparation!.action });
      assert.equal(resolution.reapprovalRequired, undefined, 'Fresh opaque IDs must not invalidate an unchanged logical proposal');
      if (cancellingCommit()) {
        await Promise.race([commitReceived.promise, delay(10000).then(() => { throw new Error('Commit request was never received before cancellation'); })]);
        assert.equal(stats.commit, 1); assert.equal(stats.mutations, 0);
        assert(orchestrator.stop(started.sessionId, parent.webContents.id), 'The real active Run must be cancelled');
        await delay(80);
        const settling = await store.getSession(started.sessionId, ownerScope, 3);
        assert.equal(settling?.toolActivities.find(item => item.call.name === toolId)?.status, 'running', 'In-flight commit must settle before its ToolRun becomes terminal');
        releaseCommit.resolve();
      }
      while (!session?.runs.some(run => run.id === started.runId && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status))) {
        if (serverFailure) throw serverFailure;
        if (Date.now() > deadline) throw new Error('Rename completion deadline');
        await delay(30); session = await store.getSession(started.sessionId, ownerScope, 3);
      }
      const activity = session.toolActivities.find(item => item.call.name === toolId)!;
      const completedRun = session.runs.find(run => run.id === started.runId)!;
      assert(activity); assert.equal(activity.pluginSource?.packageFingerprint, review.fingerprint);
      assert.equal(activity.preparation?.action.kind, 'plugin.rename');
      assert.equal(stats.approvals, 1); assert.equal(parent.contentView.children.length, 0); assert.equal(runtime.size, 0); assert.equal(host.size, 0);
      const data = activity.result?.data as { mutationCommitState?: string; operationId?: string; items?: Array<{ status?: string }> } | undefined;
      if (scenario === 'deny') {
        assert.equal(stats.commit, 0); assert.equal(stats.mutations, 0); assert.deepEqual(files, initialFiles());
        assert.equal(activity.approval?.status, 'denied');
      } else if (scenario === 'cancel-unknown') {
        assert.equal(completedRun.status, 'cancelled');
        assert.equal(activity.status, 'failed'); assert.equal(data?.mutationCommitState, 'commit_unknown');
        assert.equal(data?.operationId, action.operationId); assert.equal(stats.mutations, 1); assert.equal(stats.status, 1);
        assert.equal(activity.approval?.status, 'approved'); assert.equal(stats.model, 1);
        assert.deepEqual(files.map(file => `${file.name}.${file.ext}`), ['renamed_first.txt', 'renamed_second.txt']);
      } else {
        assert.equal(activity.status, 'completed'); assert.equal(data?.mutationCommitState, 'committed'); assert.equal(data?.operationId, action.operationId);
        assert.equal(stats.mutations, 1); assert.equal(stats.dryRun, 2); assert.equal(new Set(requests.map(request => request.operationId)).size, 1);
        assert.deepEqual(data?.items?.map(item => item.status), ['committed', 'committed']);
        assert.deepEqual(files.map(file => `${file.name}.${file.ext}`), ['renamed_first.txt', 'renamed_second.txt']);
        if (scenario === 'lost-response') assert.equal(stats.status, 1); else assert.equal(stats.status, 0);
        if (scenario === 'cancel-committed') { assert.equal(completedRun.status, 'cancelled'); assert.equal(stats.model, 1); }
      }
      const persisted = await readPersistedTool(path.join(work, 'agent.sqlite3'), activity.id);
      const persistedResult = JSON.parse(persisted.result_json);
      assert.equal(persisted.status, activity.status);
      assert.deepEqual(persistedResult, activity.result);
      if (cancellingCommit()) assert.notEqual(persisted.status, 'cancelled', 'Cancelling the Run must not overwrite the authoritative Tool result');
      results.push({ scenario, passed: true, sessionId: started.sessionId, runId: started.runId, toolRunId: activity.id,
        permissionMode, runStatus: completedRun.status, activityStatus: activity.status, persistedToolStatus: persisted.status,
        persistedCommitState: persistedResult.data?.mutationCommitState, approvalStatus: activity.approval?.status, source: activity.pluginSource, action: activity.preparation?.action,
        result: activity.result, counters: { ...stats }, viewerCount: parent.contentView.children.length });
    }
    const summary = { passed: true, syntheticBackend: true, syntheticModel: true, syntheticLibrary: true, libraryId: 3, realElectron: true, realPluginRuntime: true, realAgentOrchestrator: true, realSQLite: true, cases: results };
    await writeFile(path.join(work, 'results.json'), JSON.stringify(summary, null, 2)); console.log('RENAME_RESULT=' + JSON.stringify(summary));
  } finally {
    releaseCommit.resolve();
    parent.webContents.send = originalSend;
    await orchestrator.shutdown(); runtime.dispose(); host.dispose(); await store.close(); parent.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().then(() => app.exit(0), error => { console.error('RENAME_RESULT=' + JSON.stringify({ passed: false, error: sanitizeAgentSensitiveText(String(error?.stack ?? error?.message ?? 'Rename lab failed')).slice(0, 3000) })); app.exit(1); });

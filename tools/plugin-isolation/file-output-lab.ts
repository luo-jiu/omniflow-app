import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readdir, writeFile } from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import { PluginManager } from '../../electron/service/extensions/plugin-manager';
import { PluginDevelopmentHost } from '../../electron/service/extensions/isolated-view';
import { PluginToolRuntime } from '../../electron/service/extensions/plugin-tool-runtime';
import { createAgentPluginFileOutputService } from '../../electron/service/agent/agent-plugin-file-output';
import { createAgentMediaArtifactStore } from '../../electron/service/agent/agent-media-artifact-store';
import { createAgentMediaUploadControlPlane, type AgentMediaUploadInitInput } from '../../electron/service/agent/agent-media-upload-control-plane';
import { openAgentPluginResource } from '../../electron/service/agent/agent-plugin-resource';
import { createAgentOrchestrator } from '../../electron/service/agent/agent-orchestrator';
import { createSQLiteAgentSessionStore } from '../../electron/service/agent/agent-session-store';
import { createAIServiceRunSessionRegistry } from '../../electron/service/aiServiceRunSession';
import { createAgentCapabilitySnapshot } from '../../electron/service/agent/capabilities/agent-capability-registry';
import { sanitizeAgentSensitiveText } from '../../electron/service/agent/agent-sensitive-data';
import { toAgentProviderToolName } from '../../electron/service/agent/agent-provider-tool-name';
import type { AgentLibraryNode } from '../../src/shared/agent/agent-library-query';
import type { AgentFileAuthorityBrokerRequestInput } from '../../electron/service/agent/agent-file-authority-broker';
import type { AgentChatStreamEvent, AgentFileAuthorityResultV1, AgentPluginFileOutputPreparedActionPublicV1, AgentToolApprovalSnapshot } from '../../src/shared/agent/agent.types';

const work = process.env.OMNIFLOW_OUTPUT_WORK!;
const pluginId = 'example.csv-export', toolId = `${pluginId}.export`;
const SCENARIOS = ['full-access-json', 'deny', 'lost-response-csv', 'source-drift', 'name-conflict'] as const;
type Scenario = typeof SCENARIOS[number];
const marker = 'private-csv-export-marker';
const sourceText = `name,group,note\r\n${marker},keep,"comma, quote ""ok"""\r\nskip-private,drop,omit\r\nanother,keep,"multi\r\nline"\r\n`;
const expectedOutput = (format: string) => format === 'json'
  ? JSON.stringify({ headers: ['name', 'group', 'note'], rows: [[marker, 'keep', 'comma, quote "ok"'], ['another', 'keep', 'multi\r\nline']] })
  : `name,group,note\r\n${marker},keep,"comma, quote ""ok"""\r\nanother,keep,"multi\r\nline"\r\n`;
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const initialStats = () => ({ model: 0, range: 0, plugin: 0, init: 0, put: 0, complete: 0, status: 0, mutations: 0, abort: 0, approvals: 0 });
async function persistedText(databasePath: string) {
  const db = await new Promise<sqlite3.Database>((resolve, reject) => { const opened = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(opened)); });
  try {
    const all = (sql: string) => new Promise<unknown[]>((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
    return JSON.stringify([await all('SELECT input_json, result_json, prepared_action_json, plugin_source_json FROM agent_tool_runs'), await all('SELECT content FROM agent_messages')]);
  } finally { await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
app.on('window-all-closed', () => undefined);

async function main() {
  await app.whenReady();
  let scenario: Scenario = 'full-access-json', format = 'json', sourceVersion = 1, bytes = Buffer.from(sourceText), stats = initialStats(), failure: unknown;
  let origin = '';
  const uploads = new Map<string, { input: AgentMediaUploadInitInput; bytes?: Buffer; node?: Record<string, unknown> }>();
  const receipts = new Map<string, Record<string, unknown>>();
  let uploadSequence = 0;
  const server = createServer(async (request, response) => {
    const json = (data: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: '0', message: 'OK', data, request_id: 'output-lab' })); };
    try {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid');
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
      if (url.pathname === '/bucket/source.csv') {
        stats.range++; const range = /^bytes=(\d+)-(\d+)$/u.exec(String(request.headers.range)); assert(range);
        const start = Number(range[1]), end = Number(range[2]);
        response.writeHead(206, { ETag: `"source-v${sourceVersion}"`, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Type': 'text/csv' }); response.end(bytes.subarray(start, end + 1)); return;
      }
      if (url.pathname.startsWith('/put/')) {
        stats.put++; const upload = uploads.get(url.pathname.slice('/put/'.length)); assert(upload);
        assert.equal(body.toString('utf8'), expectedOutput(format), 'Actual PUT must contain the complete correctly escaped output');
        assert.equal(body.length, upload.input.fileSize); upload.bytes = body;
        response.writeHead(200, { ETag: '"uploaded-output"' }); response.end(); return;
      }
      if (url.pathname === '/model/v1/chat/completions') {
        stats.model++; assert(!body.toString().includes(marker), 'Private source/output bytes must never reach the model');
        const payload = JSON.parse(body.toString()); assert(payload.tools.some((tool: { function: { name: string } }) => tool.function.name === toAgentProviderToolName(toolId)));
        const done = payload.messages.some((message: { role: string }) => message.role === 'tool');
        const delta = done ? { content: '处理已结束，依据宿主回执显示结果。' } : { tool_calls: [{ index: 0, id: `output-${scenario}`, type: 'function', function: {
          name: toAgentProviderToolName(toolId), arguments: JSON.stringify({ resource: { nodeId: 11 }, destination: { parentId: 10, fileName: `processed.${format}` }, format, column: 1, equals: 'keep' }),
        } }] };
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: done ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`); return;
      }
      assert(request.headers.authorization === 'Bearer synthetic-output-token' && request.headers.username === 'synthetic-output-user');
      if (url.pathname === '/api/v1/user/me') { json({ id: 900000001 }); return; }
      if (url.pathname === '/api/v1/upload/init') {
        stats.init++; const input = JSON.parse(body.toString()) as AgentMediaUploadInitInput;
        assert.equal(input.libraryId, 3); assert.equal(input.parentId, 10); assert.equal(input.fileName, `processed.${format}`); assert.equal(input.storageProvider, 'fixture');
        const uploadId = `upload-${++uploadSequence}`; uploads.set(uploadId, { input }); json({ uploadId, mode: 'single', partSize: input.fileSize, totalParts: 1 }); return;
      }
      if (url.pathname === '/api/v1/upload/parts/sign') {
        const input = JSON.parse(body.toString()); assert(uploads.has(input.uploadId)); assert.deepEqual(input.partNumbers, [1]);
        json({ parts: [{ partNumber: 1, url: `${origin}/put/${input.uploadId}` }] }); return;
      }
      if (url.pathname === '/api/v1/upload/complete') {
        stats.complete++; const input = JSON.parse(body.toString()); assert.equal(input.conflictPolicy, 'error');
        const upload = uploads.get(input.uploadId); assert(upload?.bytes);
        if (scenario === 'name-conflict') { response.writeHead(409); response.end(JSON.stringify({ code: 'conflict' })); return; }
        if (!receipts.has(input.clientOperationId)) {
          const node = { id: 100 + uploadSequence, libraryId: 3, parentId: 10, type: 'file', name: 'processed', ext: format,
            fileSize: upload.bytes.length, mimeType: format === 'json' ? 'application/json' : 'text/csv', storageProvider: 'fixture', updatedAt: '2026-09-22T12:00:00Z' };
          upload.node = node; receipts.set(input.clientOperationId, node); stats.mutations++;
        }
        if (scenario === 'lost-response-csv') { response.destroy(); return; }
        json(receipts.get(input.clientOperationId)); return;
      }
      if (url.pathname === '/api/v1/upload/complete/status') {
        stats.status++; const node = receipts.get(url.searchParams.get('clientOperationId')!);
        json(node ? { state: 'committed', node } : { state: 'unknown' }); return;
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/v1/upload/')) { stats.abort++; json(null); return; }
      response.writeHead(404); response.end();
    } catch (error) { failure = error; if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ownerScope = { accountScope: 'user:900000001', backendScope: `${origin}/api` };
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } }); await parent.loadURL('data:text/html,<h1>File output synthetic lab</h1>');
  const manager = new PluginManager(path.join(work, 'plugins'), path.join(work, 'missing-bundled')); await manager.initialize();
  const review = await manager.prepare(process.env.OMNIFLOW_OUTPUT_PACKAGE!); await manager.commit(review.ticket);
  for (const action of ['enable', 'approve-read', 'approve-tools'] as const) await manager.action(pluginId, action);
  assert.equal(manager.toolSnapshot().length, 0); await manager.action(pluginId, 'approve-output'); assert.equal(manager.toolSnapshot().length, 1);
  const host = new PluginDevelopmentHost(parent, path.join(work, 'plugin-preload.cjs')); const runtime = new PluginToolRuntime(manager, host);
  const execute = runtime.executeFileOutput.bind(runtime); runtime.executeFileOutput = (...args) => { stats.plugin++; return execute(...args); };
  const artifactRoot = path.join(work, 'artifacts'); const artifactStore = createAgentMediaArtifactStore({ rootPath: artifactRoot });
  const metadataNodes = (): AgentLibraryNode[] => [
    { id: 1, libraryId: 3, parentId: 0, type: 'dir', name: 'root', path: '/' },
    { id: 10, libraryId: 3, parentId: 1, type: 'dir', name: 'output', path: '/output' },
    { id: 11, libraryId: 3, parentId: 10, type: 'file', name: 'source', ext: 'csv', fileSize: bytes.length, path: '/output/source.csv' },
  ];
  const authority = async (request: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> => {
    request.signal.throwIfAborted(); assert.deepEqual(request.ownerScope, ownerScope); assert.equal(request.libraryId, 3); assert.equal(request.sender.id, parent.webContents.id);
    if (request.operation.operation === 'stage-library-node') {
      assert.equal(request.operation.nodeId, 11);
      return { operation: 'stage-library-node', version: 1, node: { version: 1, id: 11, parentId: 10, libraryId: 3, type: 'file', name: 'source', ext: 'csv',
        fileSize: bytes.length, mimeType: 'text/csv', storageKey: 'source.csv', storageProvider: 'fixture', updatedAt: `2026-09-22T10:00:0${sourceVersion}Z` },
        ...(request.operation.includeDownloadUrl ? { downloadUrl: `${origin}/bucket/source.csv` } : {}) };
    }
    assert.equal(request.operation.operation, 'publish-library-file');
    if (request.operation.operation !== 'publish-library-file') throw new Error('Unexpected authority operation');
    assert.equal(request.operation.parentId, 10);
    return { operation: 'publish-library-file', version: 1, parent: { version: 1, id: 10, parentId: 1, libraryId: 3, type: 'dir', name: 'output', fileSize: 0, updatedAt: '2026-09-22T10:00:00Z' },
      providerId: 'fixture', providerLabel: 'Synthetic storage', ...(request.operation.includeCredentials ? { credentials: { token: 'synthetic-output-token', username: 'synthetic-output-user' } } : {}) };
  };
  const service = createAgentPluginFileOutputService({ manager, runtimeFor: () => runtime, artifactStore,
    request: authority, openResource: (input, guard) => openAgentPluginResource(input, guard, { request: authority, storageOrigins: [origin] }),
    controlPlane: createAgentMediaUploadControlPlane({ apiBaseUrl: ownerScope.backendScope }) });
  const detach = manager.attachRuntime(id => service.revoke(id));
  const databasePath = path.join(work, 'agent.sqlite3'); const store = await createSQLiteAgentSessionStore(databasePath);
  const group = await store.saveGroup(ownerScope, 3, { name: 'Synthetic output group', access: 'read-write', directories: [{ nodeId: 10, name: '/output' }] }, new Date().toISOString());
  const orchestrator = createAgentOrchestrator({ getSessionStore: async () => store,
    getRuntimeProfile: () => ({ apiKey: '', baseUrl: `${origin}/model/v1`, providerType: 'openai' }), generateSessionTitle: async () => null, getModelMetadata: async () => undefined,
    contextBudget: { contextWindowTokens: 32000 }, runSessionRegistry: createAIServiceRunSessionRegistry(), getPluginTools: names => manager.toolSnapshot(names),
    preparePluginFileOutput: request => service.prepare(request), executePluginFileOutput: (request, preparation, commit) => service.execute(request, preparation, commit),
    releasePluginOutputs: (runId, toolRunId) => service.releaseRun(runId, toolRunId), mediaArtifactStore: artifactStore,
    resolveCapabilitySnapshot: async ({ capabilityIds }) => createAgentCapabilitySnapshot({ registryRevision: 1, entries: capabilityIds.map(id => ({ id, definitionRevision: 'synthetic', scopeIdentity: 'synthetic', checkedAt: 1, state: 'unavailable' as const })) }),
    readLibraryMetadata: async request => {
      if (request.operation.operation !== 'query-library-metadata') throw new Error('Unexpected metadata query');
      const query = request.operation.query, nodes = metadataNodes(); const node = nodes.find(item => query.path ? item.path === query.path : item.id === (query.nodeId ?? query.directoryId)); assert(node);
      return query.kind === 'list' ? { libraryId: 3, directory: node, entries: nodes.filter(item => item.parentId === node.id) } : { libraryId: 3, node };
    },
  });
  const approvals: AgentToolApprovalSnapshot[] = [];
  const send = parent.webContents.send.bind(parent.webContents);
  parent.webContents.send = (channel: string, ...args: unknown[]) => {
    if (channel === 'agent:chat:event') { const event = args[0] as AgentChatStreamEvent; assert(!JSON.stringify(event).includes(marker), 'Generic renderer events must not contain output text');
      if (event.type === 'tool-approval-required') { stats.approvals++; approvals.push(event.approval); } }
    send(channel, ...args);
  };
  const results: unknown[] = [];
  try {
    const selected = process.env.OMNIFLOW_OUTPUT_CASES?.split(',') ?? [...SCENARIOS]; assert(selected.every(value => SCENARIOS.includes(value as Scenario)));
    for (const next of selected as Scenario[]) {
      scenario = next; format = scenario === 'full-access-json' ? 'json' : 'csv'; bytes = Buffer.from(sourceText); sourceVersion = 1; stats = initialStats(); approvals.length = 0;
      const fullAccess = scenario === 'full-access-json';
      const started = await orchestrator.start(parent.webContents, { ownerScope, profileId: 'output-fixture', model: 'synthetic', reasoningEffort: 'medium',
        permissionMode: fullAccess ? 'full-access' : 'group', ...(fullAccess ? {} : { groupId: group.id }),
        appContext: { libraryId: 3, platform: 'darwin', currentDirectory: { id: 10, name: 'output' }, selectedNodeIds: [11] },
        perception: { collectedAt: new Date().toISOString(), selectedNodes: metadataNodes().slice(2), currentDirectory: { id: 10, name: 'output', entryCount: 1, entries: metadataNodes().slice(2) } },
        userPrompt: 'Use the CSV export plugin to save all selected rows into a new file. Prepare an output and wait for my approval.' });
      const deadline = Date.now() + 40000;
      let session = await store.getSession(started.sessionId, ownerScope, 3);
      while (!approvals.length) {
        if (failure) throw failure;
        if (Date.now() > deadline || session?.runs.some(run => run.id === started.runId && ['failed', 'completed', 'cancelled'].includes(run.status))) throw new Error(`No output approval: ${JSON.stringify(session?.toolActivities)}`);
        await delay(30); session = await store.getSession(started.sessionId, ownerScope, 3);
      }
      let approval = approvals[0]; const action = approval.preparation!.action as AgentPluginFileOutputPreparedActionPublicV1;
      assert.equal(action.kind, 'plugin.file-output'); assert.equal(action.sha256, digest(expectedOutput(format))); assert.equal(stats.plugin, 1);
      assert.equal(stats.init, 0); assert.equal(stats.put, 0); assert.equal(stats.complete, 0); assert.equal(stats.approvals, 1);
      assert.equal((await readdir(artifactRoot)).filter(name => name.startsWith('agent-media-')).length, 1);
      const decide = (approved: boolean) => orchestrator.resolveToolApproval(parent.webContents.id, { approvalId: approval.approvalId, runId: started.runId, sessionId: started.sessionId,
        libraryId: 3, ownerScope, approved, preparedActionId: approval.preparation!.preparedActionId, preparedAction: approval.preparation!.action });
      if (fullAccess) { await delay(100); assert.equal(stats.init, 0); assert.equal(stats.approvals, 1); }
      if (scenario === 'source-drift') {
        bytes = Buffer.from(sourceText.replace('another,keep', 'changed-source,keep')); sourceVersion++;
        const staleApproval = await decide(true); assert.equal(staleApproval.reapprovalRequired, true);
        assert.equal(stats.plugin, 2); assert.equal(stats.init, 0); assert.equal(stats.approvals, 2);
        approval = approvals[1]; assert.notEqual((approval.preparation!.action as AgentPluginFileOutputPreparedActionPublicV1).operationId, action.operationId);
        await decide(false);
      } else {
        const decision = await decide(scenario !== 'deny'); assert.equal(decision.reapprovalRequired, undefined);
      }
      while (!session?.runs.some(run => run.id === started.runId && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status))) {
        if (failure) throw failure; if (Date.now() > deadline) throw new Error('Output completion deadline');
        await delay(30); session = await store.getSession(started.sessionId, ownerScope, 3);
      }
      const activity = session.toolActivities.find(item => item.call.name === toolId)!; assert(activity);
      const result = activity.result?.data as { mutationCommitState?: string; operationId?: string; sha256?: string } | undefined;
      assert.equal(activity.pluginSource?.packageFingerprint, review.fingerprint);
      if (scenario === 'deny' || scenario === 'source-drift') {
        assert.equal(activity.approval?.status, 'denied'); assert.equal(stats.init, 0); assert.equal(stats.put, 0); assert.equal(stats.complete, 0); assert.equal(stats.mutations, 0);
      } else if (scenario === 'name-conflict') {
        assert.equal(result?.mutationCommitState, 'uncommitted'); assert.equal(stats.mutations, 0); assert.equal(stats.abort, 1); assert.equal(stats.status, 0);
      } else {
        assert.equal(activity.status, 'completed'); assert.equal(result?.mutationCommitState, 'committed'); assert.equal(result?.operationId, action.operationId);
        assert.equal(result?.sha256, digest(expectedOutput(format))); assert.equal(stats.mutations, 1); assert.equal(stats.init, 1); assert.equal(stats.put, 1);
        assert.equal(stats.plugin, 1, 'Approval revalidation must reuse the exact private artifact');
        assert.equal(stats.status, scenario === 'lost-response-csv' ? 1 : 0);
      }
      while ((await readdir(artifactRoot)).some(name => name.startsWith('agent-media-'))) {
        if (Date.now() > deadline) throw new Error('Prepared artifact was not released at Run end'); await delay(30);
      }
      assert.equal(parent.contentView.children.length, 0); assert.equal(host.size, 0); assert.equal(runtime.size, 0);
      const persisted = await persistedText(databasePath); assert(!persisted.includes(marker)); assert(!persisted.includes('skip-private')); assert(!persisted.includes('synthetic-output-token'));
      assert(!persisted.includes(artifactRoot));
      results.push({ scenario, passed: true, sessionId: started.sessionId, runId: started.runId, toolRunId: activity.id, activityStatus: activity.status,
        source: activity.pluginSource, action: activity.preparation?.action, result: activity.result, counters: { ...stats }, artifactCount: 0, viewerCount: 0, privateBodyExcludedFromSQLiteAndModel: true });
    }
    const summary = { passed: true, realElectron: true, realAgentOrchestrator: true, realPluginRuntime: true, realArtifactStore: true, realUploadManager: true, realSQLite: true,
      syntheticBackendAndModel: true, libraryId: 3, cases: results };
    await writeFile(path.join(work, 'results.json'), JSON.stringify(summary, null, 2)); console.log('FILE_OUTPUT_RESULT=' + JSON.stringify(summary));
  } finally {
    parent.webContents.send = send; await orchestrator.shutdown(); detach(); service.revoke(); runtime.dispose(); host.dispose(); await store.close(); parent.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().then(() => app.exit(0), error => { console.error('FILE_OUTPUT_RESULT=' + JSON.stringify({ passed: false, error: sanitizeAgentSensitiveText(String(error?.stack ?? error?.message ?? 'Output lab failed')).slice(0, 3000) })); app.exit(1); });

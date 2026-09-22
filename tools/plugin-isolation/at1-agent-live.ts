import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { getActiveAIServiceRuntimeProfile } from '../../electron/service/aiServiceStore';
import { PluginManager } from '../../electron/service/extensions/plugin-manager';
import { createAgentPluginService } from '../../electron/service/agent/agent-plugin-service';
import { openAgentPluginResource } from '../../electron/service/agent/agent-plugin-resource';
import { createAgentOrchestrator } from '../../electron/service/agent/agent-orchestrator';
import { createSQLiteAgentSessionStore } from '../../electron/service/agent/agent-session-store';
import { createAIServiceRunSessionRegistry } from '../../electron/service/aiServiceRunSession';
import { createAgentCapabilitySnapshot } from '../../electron/service/agent/capabilities/agent-capability-registry';
import { sanitizeAgentSensitiveText } from '../../electron/service/agent/agent-sensitive-data';
import type { AgentLibraryNode } from '../../src/shared/agent/agent-library-query';
import type { AgentFileAuthorityResultV1 } from '../../src/shared/agent/agent.types';

const work = process.env.OMNIFLOW_AT1_WORK!;
const live = process.env.OMNIFLOW_AT1_LIVE === '1';
app.setName('OmniFlow');
app.on('window-all-closed', () => undefined);
async function main() {
  await app.whenReady();
  // 仅通过现有安全存储API获取测试连接；不输出凭据，也不修改用户配置。
  app.setPath('userData', path.join(app.getPath('appData'), 'omniflow-app'));
  const connection = live ? getActiveAIServiceRuntimeProfile() : undefined;
  app.setPath('userData', path.join(work, 'profile'));
  const bytes = Buffer.from('item,region,amount\n茶,华东,10\n咖啡,华北,20\n牛奶,华东,30\n水,华南,40\n');
  const ownerScope = { accountScope: 'user:900000001', backendScope: 'https://fixture.invalid/api' };
  const nodes: AgentLibraryNode[] = [
    { id: 1, parentId: 0, libraryId: 3, type: 'dir', name: 'root', path: '/' },
    { id: 10, parentId: 1, libraryId: 3, type: 'dir', name: 'csv', path: '/csv' },
    { id: 11, parentId: 10, libraryId: 3, type: 'file', name: 'at1-sales.csv', path: '/csv/at1-sales.csv', fileSize: bytes.length },
  ];
  let modelRequests = 0, rangeRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/bucket/')) {
      rangeRequests++;
      const match = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range));
      if (!match) { response.writeHead(400); response.end(); return; }
      const start = Number(match[1]), end = Number(match[2]);
      response.writeHead(206, { ETag: '"csv-v1"', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }); response.end(bytes.subarray(start, end + 1)); return;
    }
    if (live) { response.writeHead(404); response.end(); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body); modelRequests++;
    const resultSeen = payload.messages.some((message: { role: string }) => message.role === 'tool');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = resultSeen ? { content: '匹配2行：茶、牛奶。' } : { tool_calls: [{ index: 0, id: 'csv-call', type: 'function', function: { name: 'example_csv-tools_query', arguments: JSON.stringify({ resource: { nodeId: 11 }, column: 1, equals: '华东', limit: 10 }) } }] };
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: resultSeen ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await parent.loadURL('data:text/html,<h1>AT1 isolated Agent host</h1>');
  const sample = process.env.OMNIFLOW_AT1_SAMPLE!;
  execFileSync(process.execPath, ['pack.mjs'], { cwd: path.dirname(sample), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' });
  const manager = new PluginManager(path.join(work, 'plugins'), path.join(work, 'no-bundled'));
  await manager.initialize(); const review = await manager.prepare(path.join(path.dirname(sample), 'plugin.zip')); await manager.commit(review.ticket);
  for (const action of ['enable', 'approve-read', 'approve-tools'] as const) await manager.action('example.csv-tools', action);
  const service = createAgentPluginService({ manager, getMainWindow: () => parent, preloadPath: path.join(work, 'plugin-preload.cjs'),
    openResource: (input, guard) => openAgentPluginResource(input, guard, { storageOrigins: [origin], request: async request => {
      request.signal.throwIfAborted(); assert.equal(request.libraryId, 3); assert.equal(request.ownerScope.accountScope, ownerScope.accountScope);
      assert.equal(request.operation.operation, 'stage-library-node');
      if (request.operation.operation !== 'stage-library-node') throw new Error('Wrong operation');
      assert.equal(request.operation.nodeId, 11);
      return { version: 1, operation: 'stage-library-node', node: { version: 1, id: 11, parentId: 10, libraryId: 3, type: 'file', name: 'at1-sales', ext: 'csv', fileSize: bytes.length, storageKey: 'at1.csv', storageProvider: 'fixture', updatedAt: 'v1' },
        ...(request.operation.includeDownloadUrl ? { downloadUrl: origin + '/bucket/at1.csv' } : {}) } satisfies AgentFileAuthorityResultV1;
    } }),
  });
  const store = await createSQLiteAgentSessionStore(path.join(work, 'agent.sqlite3'));
  const group = await store.saveGroup(ownerScope, 3, { name: 'AT1 合成只读组', access: 'read', directories: [{ nodeId: 10, name: '/csv' }] }, new Date().toISOString());
  const runtimeConnection = connection ?? { apiKey: '', baseUrl: origin + '/v1', providerType: 'openai' as const };
  const profileId = 'id' in runtimeConnection && typeof runtimeConnection.id === 'string' ? runtimeConnection.id : 'at1-profile';
  const orchestrator = createAgentOrchestrator({
    getSessionStore: async () => store, getRuntimeProfile: () => runtimeConnection,
    generateSessionTitle: async () => null, getModelMetadata: async () => undefined,
    contextBudget: { contextWindowTokens: 32000 }, runSessionRegistry: createAIServiceRunSessionRegistry(),
    getPluginTools: names => service.snapshot(names), executePluginTool: request => service.execute(request),
    resolveCapabilitySnapshot: async ({ capabilityIds }) => createAgentCapabilitySnapshot({ registryRevision: 1, entries: capabilityIds.map(id => ({ id, definitionRevision: 'synthetic', scopeIdentity: 'synthetic', checkedAt: 1, state: 'unavailable' as const })) }),
    readLibraryMetadata: async input => {
      if (input.operation.operation !== 'query-library-metadata') throw new Error('Unexpected metadata operation');
      const query = input.operation.query;
      const node = nodes.find(item => query.path ? item.path === query.path : item.id === (query.nodeId ?? query.directoryId));
      if (!node) throw new Error('Unknown synthetic node');
      return query.kind === 'list' ? { libraryId: 3, directory: node, entries: nodes.filter(item => item.parentId === node.id) } : { libraryId: 3, node };
    },
  });
  let started: { sessionId: string; runId: string } | undefined;
  try {
    started = await orchestrator.start(parent.webContents, { ownerScope, profileId, model: live ? process.env.OMNIFLOW_AT1_MODEL || 'gpt-5.5' : 'at1-synthetic', reasoningEffort: 'medium', groupId: group.id, permissionMode: 'group',
      appContext: { libraryId: 3, platform: 'darwin', currentDirectory: { id: 10, name: 'csv' }, selectedNodeIds: [11] },
      perception: { collectedAt: new Date().toISOString(), selectedNodes: [nodes[2]], currentDirectory: { id: 10, name: 'csv', entryCount: 1, entries: [nodes[2]] } },
      userPrompt: '验证已安装的 CSV 插件：请使用 example.csv-tools.query 查询 /csv/at1-sales.csv，按从0开始的第1列精确等于“华东”筛选，limit=10。只报告匹配行数和商品名。节点ID必须来自当前资料库上下文或元数据工具，不打开查看器，不使用Shell或file.read，不要猜测内容。',
    });
    const deadline = Date.now() + 150000;
    let session = await store.getSession(started.sessionId, ownerScope, 3);
    while (!session?.runs.some(run => run.id === started!.runId && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status))) {
      if (Date.now() > deadline) throw new Error('AT1 model deadline');
      await new Promise(resolve => setTimeout(resolve, 250)); session = await store.getSession(started.sessionId, ownerScope, 3);
    }
    const completedRun = session.runs.find(run => run.id === started!.runId);
    if (completedRun?.status !== 'completed') throw new Error(completedRun?.error || 'Agent Run did not complete');
    const activity = session.toolActivities.find(item => item.call.name === 'example.csv-tools.query');
    if (!activity) throw new Error('Model did not call the CSV plugin Tool');
    const result = activity?.result?.data as { output?: { matchedRows?: number; rows?: string[][] } } | undefined;
    assert.equal(activity?.status, 'completed'); assert.equal(activity?.pluginSource?.packageFingerprint, review.fingerprint);
    assert.equal(result?.output?.matchedRows, 2); assert.deepEqual(result?.output?.rows?.map(row => row[0]), ['茶', '牛奶']);
    assert.equal(parent.contentView.children.length, 0); assert(rangeRequests > 0);
    const answer = session.messages.filter(message => message.role === 'assistant' && message.runId === started!.runId).map(message => message.content).join('\n');
    assert(answer.includes('茶') && answer.includes('牛奶'));
    const summary = { passed: true, liveModel: live, syntheticLibrary: true, libraryId: 3, model: live ? process.env.OMNIFLOW_AT1_MODEL || 'gpt-5.5' : 'at1-synthetic', sessionId: started.sessionId, runId: started.runId, toolRunId: activity!.id, calls: session.toolActivities.map(item => ({ name: item.call.name, status: item.status })), source: activity!.pluginSource, rangeRequests, modelRequests: live ? undefined : modelRequests, viewerCount: parent.contentView.children.length, answer };
    await writeFile(path.join(work, 'results.json'), JSON.stringify(summary, null, 2)); console.log('AT1_RESULT=' + JSON.stringify(summary));
  } finally {
    await orchestrator.shutdown(); service.dispose(); await store.close(); parent.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().then(() => app.exit(0), error => { console.error('AT1_RESULT=' + JSON.stringify({ passed: false, error: sanitizeAgentSensitiveText(String(error?.message ?? 'AT1 failed')).slice(0, 2000) })); app.exit(1); });

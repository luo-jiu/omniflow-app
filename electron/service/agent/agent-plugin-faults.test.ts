import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import baseManifest from '../../../samples/csv-viewer/manifest.json';
import type { AgentLibraryNode, AgentLibraryReadResult } from '../../../src/shared/agent/agent-library-query';
import type { AgentChatRequest, AgentToolActivitySnapshot } from '../../../src/shared/agent/agent.types';
import type { PluginManagementAction } from '../../../src/shared/plugin-management';

const mocks = vi.hoisted(() => ({ streamAgentProviderTurn: vi.fn(), execute: vi.fn(), dispose: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, net: { fetch: vi.fn() } }));
vi.mock('./agent-provider-client', () => ({ streamAgentProviderTurn: mocks.streamAgentProviderTurn }));
vi.mock('./agent-session-title', async importOriginal => ({
  ...await importOriginal<typeof import('./agent-session-title')>(),
  generateAgentSessionTitle: vi.fn(async () => null),
}));
vi.mock('../extensions/isolated-view', () => ({ PluginDevelopmentHost: class { dispose() {} } }));
vi.mock('../extensions/plugin-tool-runtime', async importOriginal => ({
  ...await importOriginal<typeof import('../extensions/plugin-tool-runtime')>(),
  // The manager, service, access guard and Agent settlement remain production code.
  // Only the isolated process is controlled, including deliberately late responses.
  PluginToolRuntime: class {
    execute(...args: unknown[]) { return mocks.execute(...args); }
    dispose() { mocks.dispose(); }
  },
}));

import { createAIServiceRunSessionRegistry } from '../aiServiceRunSession';
import { PluginManager } from '../extensions/plugin-manager';
import { PluginFault, type OpenedResourceAuthority } from '../extensions/resource-broker';
import { createAgentOrchestrator } from './agent-orchestrator';
import { createAgentPluginService } from './agent-plugin-service';
import { createAgentCapabilitySnapshot } from './capabilities/agent-capability-registry';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const OWNER_SCOPE = { accountScope: 'user:7', backendScope: 'https://backend.example/api' };
const PLUGIN_ID = 'test.faults';
const TOOL_NAME = `${PLUGIN_ID}.query`;
const contribution: PluginToolContribution = {
  id: TOOL_NAME, title: 'CSV 查询', description: '读取已授权 CSV', entry: 'tool.html',
  inputSchema: { type: 'object', properties: {
    resource: { type: 'object', properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } },
      required: ['nodeId'], additionalProperties: false },
  }, required: ['resource'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 0, maximum: 100 } },
    required: ['count'], additionalProperties: false },
  resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }], timeoutMs: 1000, maxResultBytes: 1024,
};
const NODES: AgentLibraryNode[] = [
  { id: 1, parentId: 0, libraryId: 3, type: 'dir', name: 'root', path: '/' },
  { id: 10, parentId: 1, libraryId: 3, type: 'dir', name: 'csv', path: '/csv' },
  { id: 11, parentId: 10, libraryId: 3, type: 'file', name: 'test.csv', path: '/csv/test.csv' },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function toolTurn(name = TOOL_NAME) {
  return { content: '', toolCalls: [{ id: 'fault-call', name, input: { resource: { nodeId: 11 } } }] };
}
type Options = NonNullable<Parameters<typeof createAgentOrchestrator>[0]>;

describe('AT2 plugin faults through Agent, admission, access and SQLite settlement', () => {
  let root: string;
  let store: AgentSessionStore;
  let manager: PluginManager;
  let groupId: string;
  let source: NonNullable<AgentToolActivitySnapshot['pluginSource']>;
  const services: ReturnType<typeof createAgentPluginService>[] = [];
  const orchestrators: ReturnType<typeof createAgentOrchestrator>[] = [];

  async function install(version: string) {
    const archive = new JSZip();
    archive.file('manifest.json', JSON.stringify({ ...baseManifest, formatVersion: 2, id: PLUGIN_ID, version,
      viewers: [], agentTools: [contribution], permissions: ['resource.read', 'agent.tools'], activation: [`tool:${TOOL_NAME}`] }));
    archive.file('index.html', '<p>unused viewer</p>');
    archive.file('tool.html', `<p>controlled runtime ${version}</p>`);
    const filename = path.join(root, `plugin-${version}.zip`);
    await writeFile(filename, await archive.generateAsync({ type: 'nodebuffer' }));
    await manager.commit((await manager.prepare(filename)).ticket);
    for (const action of ['enable', 'approve-read', 'approve-tools'] as const) await manager.action(PLUGIN_ID, action);
  }

  beforeEach(async () => {
    vi.clearAllMocks(); mocks.streamAgentProviderTurn.mockReset(); mocks.execute.mockReset();
    root = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-plugin-faults-'));
    manager = new PluginManager(path.join(root, 'plugins'), path.join(root, 'no-bundled-package'));
    await manager.initialize(); await install('1.0.0');
    const registration = manager.toolSnapshot()[0];
    source = { pluginId: registration.pluginId, pluginVersion: registration.pluginVersion,
      packageFingerprint: registration.fingerprint, toolId: registration.contribution.id, registrationId: registration.registrationId };
    store = await createSQLiteAgentSessionStore(':memory:');
    groupId = (await store.saveGroup(OWNER_SCOPE, 3,
      { name: '合成 CSV', access: 'read', directories: [{ nodeId: 10, name: '/csv' }] }, new Date().toISOString())).id;
  });

  afterEach(async () => {
    services.splice(0).forEach(service => service.dispose());
    await Promise.all(orchestrators.splice(0).map(orchestrator => orchestrator.shutdown()));
    await store.close(); await rm(root, { recursive: true, force: true });
  });

  function fixture(options: Options = {}) {
    const sender = { id: 77, isDestroyed: () => false, send: vi.fn() };
    const parent = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow;
    const resource: OpenedResourceAuthority = { accountScope: OWNER_SCOPE.accountScope, libraryId: 3, nodeId: 11,
      name: 'test.csv', size: 4, revision: 'revision-1', authorize: async () => true,
      currentRevision: async () => 'revision-1', readRange: async () => new Uint8Array() };
    const openResource = vi.fn(async () => resource);
    const service = createAgentPluginService({ manager, getMainWindow: () => parent, openResource,
      preloadPath: '/synthetic/plugin-preload.cjs' });
    services.push(service);
    const executePluginTool = vi.fn(service.execute);
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 32_000 }, getModelMetadata: async () => undefined,
      getRuntimeProfile: () => ({ apiKey: 'synthetic-key', baseUrl: 'https://ai.example/v1', providerType: 'openai' }),
      getSessionStore: async () => store, runSessionRegistry: createAIServiceRunSessionRegistry(),
      resolveCapabilitySnapshot: async ({ capabilityIds }) => createAgentCapabilitySnapshot({
        entries: capabilityIds.map(id => ({ id, definitionRevision: `test:${id}@1`, state: 'available' as const,
          checkedAt: 1, scopeIdentity: 'synthetic-machine' })), registryRevision: 1,
      }),
      readLibraryMetadata: async input => {
        if (input.operation.operation !== 'query-library-metadata') throw new Error('Unexpected metadata operation');
        const query = input.operation.query;
        const node = NODES.find(item => query.path ? item.path === query.path : item.id === (query.nodeId ?? query.directoryId));
        if (!node) throw new Error('Missing synthetic node');
        return (query.kind === 'list'
          ? { libraryId: 3, directory: node, entries: NODES.filter(item => item.parentId === node.id) }
          : { libraryId: 3, node }) satisfies AgentLibraryReadResult;
      },
      getPluginTools: reservedNames => service.snapshot(reservedNames), executePluginTool, ...options,
    });
    orchestrators.push(orchestrator);
    const input: AgentChatRequest = {
      appContext: { currentDirectory: { id: 10, name: 'csv' }, libraryId: 3, platform: 'darwin', selectedNodeIds: [11] },
      model: 'synthetic-model', profileId: 'synthetic-profile', ownerScope: OWNER_SCOPE, reasoningEffort: 'auto',
      groupId, permissionMode: 'group', userPrompt: '查询CSV',
      perception: { collectedAt: new Date().toISOString(), selectedNodes: [NODES[2]],
        currentDirectory: { id: 10, name: 'csv', entries: [NODES[2]], entryCount: 1 } },
    };
    const successfulResult = { output: { count: 2 }, source: { pluginId: source.pluginId, version: source.pluginVersion,
      fingerprint: source.packageFingerprint, toolId: source.toolId, registrationId: source.registrationId,
      nodeId: 11, resourceRevision: resource.revision } };
    mocks.execute.mockResolvedValue(successfulResult);
    return { orchestrator, sender, service, openResource, executePluginTool, successfulResult,
      start: () => orchestrator.start(sender as unknown as WebContents, input) };
  }

  function finalTurn(expectedFailure?: string) {
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, delta) => {
      if (expectedFailure) {
        const toolMessage = input.messages.findLast((message: { role: string }) => message.role === 'tool');
        expect(toolMessage).toBeDefined();
        expect(toolMessage.content).toContain('"ok":false');
        expect(toolMessage.content).toContain(expectedFailure);
      }
      delta('已核对工具结果。'); return { content: '已核对工具结果。', toolCalls: [] };
    });
  }

  async function settled(f: ReturnType<typeof fixture>, started: { sessionId: string; runId: string }, type = 'completed') {
    await vi.waitFor(() => expect(f.sender.send).toHaveBeenCalledWith('agent:chat:event',
      expect.objectContaining({ type, runId: started.runId })), { timeout: 3000 });
    const session = (await store.getSession(started.sessionId, OWNER_SCOPE, 3))!;
    const activities = session.toolActivities.filter(activity => activity.runId === started.runId);
    expect(activities.every(activity => ['completed', 'failed', 'cancelled', 'interrupted'].includes(activity.status))).toBe(true);
    expect(session.runs.find(run => run.id === started.runId)?.status).toBe(type);
    return activities;
  }

  it.each(['disable', 'revoke-read', 'revoke-tools', 'upgrade'] as const)(
    'keeps old package provenance and refuses %s between catalog publication and dispatch', async action => {
      const f = fixture();
      mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input) => {
        expect(input.tools.map((tool: { name: string }) => tool.name)).toContain(TOOL_NAME);
        if (action === 'upgrade') await install('1.0.1');
        else await manager.action(PLUGIN_ID, action);
        return toolTurn();
      });
      finalTurn(action === 'upgrade' ? 'PLUGIN_VERSION_CHANGED' : 'PLUGIN_BLOCKED');
      const started = await f.start();
      expect(await settled(f, started)).toEqual([expect.objectContaining({ status: 'failed', pluginSource: source,
        result: expect.objectContaining({ ok: false }) })]);
      expect(f.executePluginTool).toHaveBeenCalledOnce();
      expect(f.openResource).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['disable', 'revoke-read', 'revoke-tools', 'upgrade'] as const)(
    'settles an in-flight Tool after %s and ignores a later sandbox success', async action => {
      const f = fixture(); const pending = deferred<typeof f.successfulResult>();
      mocks.execute.mockReturnValue(pending.promise);
      mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn()); finalTurn('Plugin Agent call cancelled');
      const started = await f.start();
      await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
      if (action === 'upgrade') await install('1.0.1');
      else await manager.action(PLUGIN_ID, action as PluginManagementAction);
      const before = await settled(f, started);
      expect(before).toEqual([expect.objectContaining({ status: 'failed', pluginSource: source,
        result: expect.objectContaining({ ok: false }) })]);
      pending.resolve(f.successfulResult); await pending.promise;
      expect(await settled(f, started)).toEqual(before);
      expect(f.sender.send.mock.calls.filter(call => call[1]?.type === 'tool-completed')).toHaveLength(1);
      expect(JSON.stringify(mocks.streamAgentProviderTurn.mock.calls)).not.toContain('"count":2');
    },
  );

  it.each(['CONTENT_CHANGED', 'RENDERER_GONE'] as const)('delivers %s as a failed model result with immutable source', async code => {
    const f = fixture();
    const message = code === 'CONTENT_CHANGED' ? 'Resource changed during Tool execution' : 'Plugin renderer exited';
    mocks.execute.mockRejectedValue(new PluginFault(code === 'CONTENT_CHANGED' ? code : 'UNAVAILABLE', message));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn()); finalTurn(message);
    const started = await f.start();
    expect(await settled(f, started)).toEqual([expect.objectContaining({ status: 'failed', pluginSource: source,
      result: { ok: false, message } })]);
  });

  it('times out a non-cooperating sandbox and cannot change the failed audit when it answers late', async () => {
    const f = fixture(); const pending = deferred<typeof f.successfulResult>();
    mocks.execute.mockReturnValue(pending.promise);
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn()); finalTurn('执行超时');
    const started = await f.start();
    const before = await settled(f, started);
    expect(before).toEqual([expect.objectContaining({ status: 'failed', pluginSource: source,
      result: expect.objectContaining({ ok: false, message: expect.stringContaining('执行超时') }) })]);
    expect(f.executePluginTool.mock.calls[0][0].authority.signal.aborted).toBe(true);
    pending.resolve(f.successfulResult); await pending.promise;
    expect(await settled(f, started)).toEqual(before);
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledTimes(2);
  });

  it.each(['stop', 'owner-release'] as const)('seals cancellation on %s while the sandbox ignores its signal', async reason => {
    const f = fixture(); const pending = deferred<typeof f.successfulResult>();
    mocks.execute.mockReturnValue(pending.promise); mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn());
    const started = await f.start();
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    if (reason === 'stop') f.orchestrator.stop(started.sessionId, f.sender.id);
    else f.orchestrator.releaseOwner(f.sender.id);
    const before = await settled(f, started, 'cancelled');
    expect(before).toEqual([expect.objectContaining({ status: 'cancelled', pluginSource: source,
      result: expect.objectContaining({ ok: false }) })]);
    expect(f.executePluginTool.mock.calls[0][0].authority.signal.aborted).toBe(true);
    pending.resolve(f.successfulResult); await pending.promise;
    expect(await settled(f, started, 'cancelled')).toEqual(before);
    expect(mocks.streamAgentProviderTurn).toHaveBeenCalledOnce();
    expect(f.sender.send.mock.calls.filter(call => call[1]?.type === 'tool-completed')).toHaveLength(0);
  });

  it('releases the owner while resource acquisition is pending without launching late sandbox work', async () => {
    const f = fixture(); const opened = await f.openResource(); f.openResource.mockClear();
    const opening = deferred<OpenedResourceAuthority>(); f.openResource.mockReturnValue(opening.promise);
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn());
    const started = await f.start();
    await vi.waitFor(() => expect(f.openResource).toHaveBeenCalledOnce());
    f.orchestrator.releaseOwner(f.sender.id);
    const before = await settled(f, started, 'cancelled');
    expect(before).toEqual([expect.objectContaining({ status: 'cancelled', pluginSource: source })]);
    opening.resolve(opened); await opening.promise;
    expect(await settled(f, started, 'cancelled')).toEqual(before);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.streamAgentProviderTurn).toHaveBeenCalledOnce();
  });

  it('retains failed and owner-cancelled plugin audit identities after reopening the actual session database', async () => {
    await store.close();
    const filename = path.join(root, 'fault-restart.sqlite');
    store = await createSQLiteAgentSessionStore(filename);
    groupId = (await store.saveGroup(OWNER_SCOPE, 3,
      { name: '故障恢复', access: 'read', directories: [{ nodeId: 10, name: '/csv' }] }, new Date().toISOString())).id;
    const f = fixture();
    mocks.execute.mockRejectedValueOnce(new PluginFault('CONTENT_CHANGED', 'Resource revision changed'));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn()); finalTurn('Resource revision changed');
    const failed = await f.start(); const failedBefore = await settled(f, failed);

    const pending = deferred<typeof f.successfulResult>(); mocks.execute.mockReturnValueOnce(pending.promise);
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn());
    const cancelled = await f.start();
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    f.orchestrator.releaseOwner(f.sender.id);
    const cancelledBefore = await settled(f, cancelled, 'cancelled');
    pending.resolve(f.successfulResult); await pending.promise;
    expect(await f.orchestrator.shutdown()).toBe(true);
    await store.close(); store = await createSQLiteAgentSessionStore(filename);

    for (const [started, before, status] of [
      [failed, failedBefore, 'failed'], [cancelled, cancelledBefore, 'cancelled'],
    ] as const) {
      const restored = (await store.getSession(started.sessionId, OWNER_SCOPE, 3))!;
      expect(restored.toolActivities).toEqual(before);
      expect(restored.toolActivities).toEqual([expect.objectContaining({ status, pluginSource: source,
        result: expect.objectContaining({ ok: false }) })]);
      expect(restored.toolActivities.some(activity => ['preparing', 'running'].includes(activity.status))).toBe(false);
    }
  });

  it('rejects a model call to a removed catalog tool without inventing source, execution or success', async () => {
    await manager.action(PLUGIN_ID, 'disable'); const f = fixture();
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input) => {
      expect(input.tools.map((tool: { name: string }) => tool.name)).not.toContain(TOOL_NAME);
      return toolTurn();
    }); finalTurn();
    const started = await f.start();
    const activities = await settled(f, started);
    expect(activities.every(activity => activity.status !== 'completed')).toBe(true);
    expect(activities.every(activity => activity.pluginSource === undefined)).toBe(true);
    expect(f.executePluginTool).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    const providerMessages = JSON.stringify(mocks.streamAgentProviderTurn.mock.calls[1][1].messages);
    expect(providerMessages).toContain('\\"ok\\":false');
    expect(providerMessages).not.toContain('\\"ok\\":true');
    expect(f.sender.send.mock.calls.some(call => call[1]?.type === 'tool-approval-required')).toBe(false);
  });
});

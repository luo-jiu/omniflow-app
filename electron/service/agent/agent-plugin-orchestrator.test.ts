import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import type { AgentLibraryNode, AgentLibraryReadResult } from '../../../src/shared/agent/agent-library-query';
import type { AgentChatRequest, AgentToolActivitySnapshot, AgentToolResult } from '../../../src/shared/agent/agent.types';
import type { ManagedPlugin } from '../../../src/shared/plugin-management';

const mocks = vi.hoisted(() => ({ streamAgentProviderTurn: vi.fn() }));
vi.mock('./agent-provider-client', () => ({ streamAgentProviderTurn: mocks.streamAgentProviderTurn }));
vi.mock('./agent-session-title', async importOriginal => ({
  ...await importOriginal<typeof import('./agent-session-title')>(),
  generateAgentSessionTitle: vi.fn(async () => null),
}));

import { createAIServiceRunSessionRegistry } from '../aiServiceRunSession';
import { createPluginToolSnapshot } from '../extensions/plugin-tool-catalog';
import { createAgentOrchestrator } from './agent-orchestrator';
import type { AgentPluginToolRequest } from './agent-plugin-service';
import { createAgentCapabilitySnapshot } from './capabilities/agent-capability-registry';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

const OWNER_SCOPE = { accountScope: 'user:7', backendScope: 'https://example.com/api' };
const TOOL_NAME = 'test.csv.query';
const SOURCE = { pluginId: 'test.csv', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: TOOL_NAME };
const contribution: PluginToolContribution = {
  id: TOOL_NAME, title: 'CSV 查询', description: '按值读取已授权 CSV 文件', entry: 'tool.html',
  inputSchema: { type: 'object', properties: {
    resource: { type: 'object', properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, required: ['nodeId'], additionalProperties: false },
    filter: { type: 'string', maxLength: 32 },
  }, required: ['resource'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['count'], additionalProperties: false },
  resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }], timeoutMs: 3000, maxResultBytes: 1024,
};
function plugin(overrides: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { id: 'test.csv', version: '1.0.0', fingerprint: 'a'.repeat(64), enabled: true, readApproved: true,
    toolApproved: true, source: 'local', installedAt: '2026-09-22T00:00:00Z', viewers: [],
    agentTools: [structuredClone(contribution)], permissions: ['resource.read', 'agent.tools'], running: 0, ...overrides };
}
const NODES: AgentLibraryNode[] = [
  { id: 1, parentId: 0, libraryId: 3, type: 'dir', name: 'root', path: '/' },
  { id: 10, parentId: 1, libraryId: 3, type: 'dir', name: 'csv', path: '/csv' },
  { id: 11, parentId: 10, libraryId: 3, type: 'file', name: 'inside.csv', path: '/csv/inside.csv' },
  { id: 20, parentId: 1, libraryId: 3, type: 'dir', name: 'outside', path: '/outside' },
  { id: 21, parentId: 20, libraryId: 3, type: 'file', name: 'outside.csv', path: '/outside/outside.csv' },
];
function sender() { return { id: 77, isDestroyed: () => false, send: vi.fn() }; }
function request(groupId: string): AgentChatRequest {
  return { appContext: { currentDirectory: { id: 10, name: 'csv' }, libraryId: 3, platform: 'darwin', selectedNodeIds: [11] },
    model: 'test-model', profileId: 'profile-1', ownerScope: OWNER_SCOPE, reasoningEffort: 'auto',
    groupId, permissionMode: 'group', userPrompt: '查询当前CSV中的中文行',
    perception: { collectedAt: '2026-09-22T00:00:00Z', selectedNodes: [NODES[2]],
      currentDirectory: { id: 10, name: 'csv', entries: [NODES[2]], entryCount: 1 } } };
}
function toolTurn(nodeId: number | string = 11, id = 'csv-call') {
  return { content: '', toolCalls: [{ id, name: TOOL_NAME, input: { resource: { nodeId }, filter: '中文' } }] };
}
function finalTurn() {
  mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, _input, delta) => {
    delta('查询完成。'); return { content: '查询完成。', toolCalls: [] };
  });
}
async function waitForTerminal(webContents: ReturnType<typeof sender>, runId: string, type = 'completed') {
  await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledWith('agent:chat:event',
    expect.objectContaining({ type, runId })), { timeout: 3000 });
}

type Options = NonNullable<Parameters<typeof createAgentOrchestrator>[0]>;
describe('Agent plugin orchestration with the real library access guard', () => {
  let store: AgentSessionStore;
  let groupId: string;
  const orchestrators: ReturnType<typeof createAgentOrchestrator>[] = [];
  beforeEach(async () => {
    mocks.streamAgentProviderTurn.mockReset();
    store = await createSQLiteAgentSessionStore(':memory:');
    groupId = (await store.saveGroup(OWNER_SCOPE, 3,
      { name: 'CSV 组', access: 'read', directories: [{ nodeId: 10, name: '/csv' }] }, new Date().toISOString())).id;
  });
  afterEach(async () => {
    await Promise.all(orchestrators.splice(0).map(orchestrator => orchestrator.shutdown()));
    await store.close();
  });
  function createOrchestrator(options: Options = {}) {
    const orchestrator = createAgentOrchestrator({
      contextBudget: { contextWindowTokens: 32_000 }, getModelMetadata: async () => undefined,
      getRuntimeProfile: () => ({ apiKey: 'test-key', baseUrl: 'https://ai.example.com/v1', providerType: 'openai' }),
      getSessionStore: async () => store, runSessionRegistry: createAIServiceRunSessionRegistry(),
      resolveCapabilitySnapshot: async ({ capabilityIds }) => createAgentCapabilitySnapshot({
        entries: capabilityIds.map(id => ({ id, definitionRevision: `test:${id}@1`, state: 'available' as const, checkedAt: 1, scopeIdentity: 'test-machine' })), registryRevision: 1,
      }),
      readLibraryMetadata: async input => {
        if (input.operation.operation !== 'query-library-metadata') throw new Error('Unexpected metadata operation');
        const query = input.operation.query;
        const node = NODES.find(item => query.path ? item.path === query.path : item.id === (query.nodeId ?? query.directoryId));
        if (!node) throw new Error('Missing node');
        return (query.kind === 'list'
          ? { libraryId: 3, directory: node, entries: NODES.filter(item => item.parentId === node.id) }
          : { libraryId: 3, node }) satisfies AgentLibraryReadResult;
      },
      getPluginTools: reservedNames => createPluginToolSnapshot([plugin()], reservedNames),
      ...options,
    });
    orchestrators.push(orchestrator); return orchestrator;
  }
  async function pluginActivity(sessionId: string): Promise<AgentToolActivitySnapshot | undefined> {
    return (await store.getSession(sessionId, OWNER_SCOPE, 3))?.toolActivities.find(item => item.call.name === TOOL_NAME);
  }

  it('publishes only approved enabled plugins and runs a CSV Tool without any Viewer session', async () => {
    const omitted = plugin({ id: 'test.disabled', enabled: false,
      agentTools: [{ ...contribution, id: 'test.disabled.query' }] });
    const unapproved = plugin({ id: 'test.unapproved', toolApproved: false,
      agentTools: [{ ...contribution, id: 'test.unapproved.query' }] });
    const getPluginTools = vi.fn((reservedNames: readonly string[]) => createPluginToolSnapshot([plugin(), omitted, unapproved], reservedNames));
    const executePluginTool = vi.fn(async (call: AgentPluginToolRequest): Promise<AgentToolResult> => {
      expect((await pluginActivity(call.authority.sessionId))?.pluginSource).toMatchObject(SOURCE);
      expect((await pluginActivity(call.authority.sessionId))?.status).toBe('running');
      await call.assertCurrent(call.authority.signal);
      expect(call.authority).toMatchObject({ libraryId: 3, ownerScope: OWNER_SCOPE,
        operation: { operation: 'stage-library-node', nodeId: 11 } });
      expect(call.aiDestinationId).toMatch(/^v1:[a-f0-9]{64}$/);
      return { ok: true, data: { output: { count: 2 } }, message: '匹配2条中文行' };
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input) => {
      expect(input.tools.map((tool: { name: string }) => tool.name)).toContain(TOOL_NAME);
      expect(input.tools.map((tool: { name: string }) => tool.name)).not.toContain('test.disabled.query');
      expect(input.tools.map((tool: { name: string }) => tool.name)).not.toContain('test.unapproved.query');
      return toolTurn();
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async (_connection, input, delta) => {
      expect(JSON.stringify(input.messages)).toContain('匹配2条中文行');
      delta('查询完成。'); return { content: '查询完成。', toolCalls: [] };
    });
    const webContents = sender();
    const started = await createOrchestrator({ getPluginTools, executePluginTool }).start(webContents as never, request(groupId));
    await waitForTerminal(webContents, started.runId);
    expect(getPluginTools).toHaveBeenCalledWith(expect.arrayContaining(['file.list', 'file.read']));
    expect(executePluginTool).toHaveBeenCalledOnce();
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: 'completed', pluginSource: SOURCE });
    expect(webContents.send.mock.calls.some(call => call[1]?.type === 'tool-approval-required')).toBe(false);
  });

  it.each([true, false])('holds an out-of-group CSV until exact file approval (approved=%s)', async approved => {
    const executePluginTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: { count: 1 } }));
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn(21)); finalTurn();
    const webContents = sender();
    const orchestrator = createOrchestrator({ executePluginTool });
    const started = await orchestrator.start(webContents as never, request(groupId));
    await vi.waitFor(() => expect(webContents.send.mock.calls.some(call => call[1]?.type === 'tool-approval-required')).toBe(true));
    expect(executePluginTool).not.toHaveBeenCalled();
    const approval = webContents.send.mock.calls.map(call => call[1]).find(event => event.type === 'tool-approval-required').approval;
    expect(approval.call.name).toBe('agent.access.request');
    expect(JSON.stringify(approval)).toContain('outside.csv');
    await orchestrator.resolveToolApproval(webContents.id, { approvalId: approval.approvalId, approved,
      libraryId: 3, ownerScope: OWNER_SCOPE, runId: started.runId, sessionId: started.sessionId });
    await waitForTerminal(webContents, started.runId);
    expect(executePluginTool).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: approved ? 'completed' : 'failed', pluginSource: SOURCE });
  });

  it('audits invalid plugin schema input as failed without exposing it to the executor', async () => {
    const executePluginTool = vi.fn();
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn('not-a-node')); finalTurn();
    const webContents = sender();
    const started = await createOrchestrator({ executePluginTool }).start(webContents as never, request(groupId));
    await waitForTerminal(webContents, started.runId);
    expect(executePluginTool).not.toHaveBeenCalled();
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: 'failed', pluginSource: SOURCE,
      call: { input: { _omniflowAudit: 'invalid Tool input omitted' } }, result: { ok: false } });
  });

  it('retains plugin source when stopped while waiting for out-of-group file access', async () => {
    const executePluginTool = vi.fn();
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn(21));
    const webContents = sender();
    const orchestrator = createOrchestrator({ executePluginTool });
    const started = await orchestrator.start(webContents as never, request(groupId));
    await vi.waitFor(() => expect(webContents.send.mock.calls.some(call => call[1]?.type === 'tool-approval-required')).toBe(true));
    expect(await pluginActivity(started.sessionId)).toMatchObject({ pluginSource: SOURCE });
    orchestrator.stop(started.sessionId, webContents.id);
    await waitForTerminal(webContents, started.runId, 'cancelled');
    expect(executePluginTool).not.toHaveBeenCalled();
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: 'cancelled', pluginSource: SOURCE });
  });

  it('retains package provenance when a running plugin Tool is cancelled', async () => {
    const executePluginTool = vi.fn(async (call: AgentPluginToolRequest): Promise<AgentToolResult> => {
      expect(await pluginActivity(call.authority.sessionId)).toMatchObject({ status: 'running', pluginSource: SOURCE });
      call.authority.signal.throwIfAborted();
      return new Promise((_, reject) => call.authority.signal.addEventListener('abort', () => {
        const error = new Error('Cancelled'); error.name = 'AbortError'; reject(error);
      }, { once: true }));
    });
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn());
    const webContents = sender();
    const orchestrator = createOrchestrator({ executePluginTool });
    const started = await orchestrator.start(webContents as never, request(groupId));
    await vi.waitFor(() => expect(executePluginTool).toHaveBeenCalledOnce());
    orchestrator.stop(started.sessionId, webContents.id);
    await waitForTerminal(webContents, started.runId, 'cancelled');
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: 'cancelled', pluginSource: SOURCE });
  });

  it('rejects a plugin result if the AI destination changes during execution', async () => {
    const runtimeProfile = { apiKey: 'test-key', baseUrl: 'https://ai.example.com/v1', providerType: 'openai' as const, configurationRevision: 'r1' };
    const executePluginTool = vi.fn(async (): Promise<AgentToolResult> => {
      runtimeProfile.configurationRevision = 'r2';
      return { ok: true, data: { forbidden: 'result-from-drifted-destination' } };
    });
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn()); finalTurn();
    const webContents = sender();
    const started = await createOrchestrator({ executePluginTool, getRuntimeProfile: () => runtimeProfile })
      .start(webContents as never, request(groupId));
    await waitForTerminal(webContents, started.runId);
    expect(await pluginActivity(started.sessionId)).toMatchObject({ status: 'failed', pluginSource: SOURCE, result: { ok: false } });
    expect(JSON.stringify((await pluginActivity(started.sessionId))?.result)).not.toContain('result-from-drifted-destination');
    expect((await pluginActivity(started.sessionId))?.result?.message).toContain('AI 目的地已变化');
  });

  it('keeps a Run package snapshot stable and uses changed registrations only for the next Run', async () => {
    let packages = [plugin()];
    const getPluginTools = vi.fn((reservedNames: readonly string[]) => createPluginToolSnapshot(packages, reservedNames));
    const executePluginTool = vi.fn(async (call: AgentPluginToolRequest): Promise<AgentToolResult> => {
      await call.assertCurrent(call.authority.signal);
      return { ok: true, data: { count: 2 } };
    });
    mocks.streamAgentProviderTurn.mockImplementationOnce(async () => {
      packages = [plugin({ version: '1.0.1', fingerprint: 'b'.repeat(64) })]; return toolTurn();
    }); finalTurn();
    const webContents = sender();
    const orchestrator = createOrchestrator({ getPluginTools, executePluginTool });
    const first = await orchestrator.start(webContents as never, request(groupId));
    await waitForTerminal(webContents, first.runId);
    expect(executePluginTool.mock.calls[0][0].source).toMatchObject(SOURCE);
    expect(getPluginTools).toHaveBeenCalledOnce();
    mocks.streamAgentProviderTurn.mockResolvedValueOnce(toolTurn(11, 'next-csv-call')); finalTurn();
    const next = await orchestrator.start(webContents as never, { ...request(groupId), sessionId: first.sessionId });
    await waitForTerminal(webContents, next.runId);
    expect(getPluginTools).toHaveBeenCalledTimes(2);
    expect(executePluginTool.mock.calls[1][0].source).toMatchObject({ ...SOURCE, pluginVersion: '1.0.1', packageFingerprint: 'b'.repeat(64) });
    const history = (await store.getSession(first.sessionId, OWNER_SCOPE, 3))!.toolActivities;
    expect(history.filter(item => item.call.name === TOOL_NAME).map(item => item.pluginSource?.pluginVersion)).toEqual(['1.0.0', '1.0.1']);
  });
});

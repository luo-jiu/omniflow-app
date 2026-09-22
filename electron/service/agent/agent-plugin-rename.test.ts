import { createHash } from 'node:crypto';
import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFileAuthorityNodeSnapshotV1, AgentFileAuthorityResultV1, AgentPluginToolSource } from '../../../src/shared/agent/agent.types';
import manifestJson from '../../../samples/batch-rename/manifest.json';
import { parsePluginManifest } from '../extensions/manifest';
import type { PluginManager } from '../extensions/plugin-manager';
import type { MetadataResourceAuthority } from '../extensions/resource-broker';
import type { PluginToolRuntime } from '../extensions/plugin-tool-runtime';
import type { AgentToolMainPreparationIdentity, AgentToolMainPreparedExecution, AgentToolMainPreparationResult } from './agent-tool-registry';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import type { ConditionalRenameRequest, ConditionalRenameReceipt, createPluginRenameTransport } from './plugin-rename-transport';

const mocks = vi.hoisted(() => ({ authority: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
vi.mock('../extensions/plugin-tool-runtime', () => ({ createPluginMetadataCallAuthority: mocks.authority }));
import { createAgentPluginRenameService, type AgentPluginRenameRequest } from './agent-plugin-rename';
import { RenameTransportError } from './plugin-rename-transport';
import { hashAgentToolInputForPreparation } from './agent-tool-registry';

const manifest = parsePluginManifest(manifestJson, 'darwin');
const fingerprint = 'a'.repeat(64);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sourceFor(): AgentPluginToolSource {
  const source = { pluginId: manifest.id, pluginVersion: manifest.version, packageFingerprint: fingerprint,
    toolId: manifest.agentTools![0].id, registrationId: '' };
  source.registrationId = `plugin-tool:${sha(['omniflow-agent-tool-v1', source.pluginId, source.pluginVersion, fingerprint, source.toolId])}`;
  return source;
}
function receiptFor(request: ConditionalRenameRequest, state: 'committed' | 'validated' = 'committed'): ConditionalRenameReceipt {
  return { operationId: request.operationId, libraryId: request.libraryId, atomic: true, state, replayed: false,
    items: request.items.map(item => ({ nodeId: item.nodeId, parentId: item.expected.parentId, status: state,
      previous: { name: item.expected.name, ext: item.expected.ext, updatedAt: item.expected.updatedAt },
      current: { name: item.name, ext: item.expected.ext, updatedAt: state === 'validated' ? item.expected.updatedAt : '2026-09-22T01:03:03.123456Z' } })),
    affectedParentIds: [...new Set(request.items.map(item => item.expected.parentId))],
  };
}
function fixture() {
  const source = sourceFor(); const controller = new AbortController();
  const sender = { id: 9, isDestroyed: () => false } as WebContents;
  const nodes: AgentFileAuthorityNodeSnapshotV1[] = [9, 10].map(id => ({ version: 1, id, libraryId: 3, parentId: 8,
    type: 'file', name: `file-${id}`, ext: 'jpg', fileSize: 5, storageKey: `private-storage-key-${id}`, storageProvider: 'private-provider',
    updatedAt: '2026-09-22T01:02:03.123456Z' }));
  const credentials = { token: 'private-token', username: 'private-user' };
  const authority: AgentFileAuthorityBrokerRequestInput = { sender, ownerScope: { accountScope: 'user:42', backendScope: 'https://backend.test/api' },
    libraryId: 3, sessionId: 'session', runId: 'run', toolRunId: 'tool-run', signal: controller.signal,
    operation: { operation: 'rename-library-files', nodeIds: [9, 10], includeCredentials: false } };
  const assertCurrent = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); });
  const request: AgentPluginRenameRequest = { source, input: { resources: [9, 10], prefix: 'renamed-' }, authority,
    aiDestinationId: 'destination', assertCurrent };
  const spec = { plugin: { id: source.pluginId, version: source.pluginVersion, fingerprint },
    tool: manifest.agentTools![0], registrationId: source.registrationId, directory: '/virtual/plugin', providerName: 'example_batch_rename_propose' };
  const manager = { resolveTool: vi.fn(() => spec), stillToolAllowed: vi.fn(() => true) };
  const readAuthority = vi.fn(async (input: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> => {
    input.signal.throwIfAborted();
    if (input.operation.operation !== 'rename-library-files') throw new Error('unexpected operation');
    return { operation: 'rename-library-files', version: 1,
      nodes: input.operation.nodeIds.flatMap(id => nodes.filter(node => node.id === id).map(node => ({ ...node }))),
      ...(input.operation.includeCredentials ? { credentials } : {}),
    };
  });
  const runtime = { executeRenameProposal: vi.fn<PluginToolRuntime['executeRenameProposal']>(async () => {
    const resource = mocks.authority.mock.lastCall![1] as MetadataResourceAuthority;
    return { output: { changes: resource.files.map(file => ({ id: file.id, name: 'renamed-' + file.name })) },
      source: { pluginId: source.pluginId, version: source.pluginVersion, fingerprint, toolId: source.toolId,
        registrationId: source.registrationId, nodeIds: [9, 10], resourceRevision: resource.revision } };
  }) };
  const transport = {
    verifyActor: vi.fn(async () => undefined),
    dryRun: vi.fn(async (body: ConditionalRenameRequest) => receiptFor(body, 'validated')),
    commit: vi.fn(async (body: ConditionalRenameRequest) => receiptFor(body)),
    status: vi.fn(async (body: ConditionalRenameRequest): Promise<ConditionalRenameReceipt | null> => { void body; return null; }),
  };
  const settlement = { begin: vi.fn(), settle: vi.fn() };
  const service = createAgentPluginRenameService({ manager: manager as unknown as PluginManager,
    runtimeFor: () => runtime as unknown as PluginToolRuntime, request: readAuthority,
    transport: transport as unknown as ReturnType<typeof createPluginRenameTransport> });
  function execution(prepared: AgentToolMainPreparationResult): AgentToolMainPreparedExecution {
    return { binding: structuredClone(prepared.binding), publicAction: structuredClone(prepared.publicAction),
      preparedActionId: 'prepared-action', snapshotHash: 'v1:' + 'c'.repeat(64),
      identity: { aiDestinationIdentity: request.aiDestinationId, callId: 'call', libraryId: authority.libraryId,
        ownerScope: { ...authority.ownerScope }, ownerWebContentsId: sender.id, preparedActionId: 'prepared-action',
        runCapabilityIdentity: 'v1:' + 'b'.repeat(64), runId: authority.runId, sessionId: authority.sessionId,
        toolInputHash: hashAgentToolInputForPreparation(request.input), toolName: source.toolId, toolRegistrationId: source.registrationId,
        toolRunId: authority.toolRunId } };
  }
  return { service, manager, spec, request, nodes, source, credentials, readAuthority, runtime, transport, settlement,
    controller, assertCurrent, execution, prepare: () => service.prepare(request) };
}

beforeEach(() => { mocks.authority.mockReset(); mocks.authority.mockImplementation(() => Object.freeze({})); });

describe('Agent controlled plugin rename service', () => {
  it('prepares opaque metadata, a standard preview and a dry-run without submitting', async () => {
    const f = fixture(); const prepared = await f.prepare();
    expect(prepared.publicAction).toMatchObject({ kind: 'plugin.rename', libraryId: 3, pluginId: f.source.pluginId,
      items: [{ nodeId: 9, parentId: 8, oldName: 'file-9.jpg', newName: 'renamed-file-9.jpg' },
        { nodeId: 10, parentId: 8, oldName: 'file-10.jpg', newName: 'renamed-file-10.jpg' }] });
    expect(prepared.decision).toMatchObject({ behavior: 'ask', risk: 'write' });
    expect(f.transport.dryRun).toHaveBeenCalledTimes(1); expect(f.transport.commit).not.toHaveBeenCalled();
    expect(f.settlement.begin).not.toHaveBeenCalled();
    const [binding, resource] = mocks.authority.mock.calls[0] as [Record<string, unknown>, MetadataResourceAuthority];
    expect(binding).toMatchObject({ nodeIds: [9, 10], accountScope: 'user:42', libraryId: 3, toolRunId: 'tool-run', aiDestinationId: 'destination' });
    expect(resource.kind).toBe('metadata');
    expect(resource.files.map(file => Object.keys(file).sort())).toEqual([['id', 'name'], ['id', 'name']]);
    expect(resource.files.every(file => /^[a-f0-9-]{36}$/u.test(file.id))).toBe(true);
    expect(new Set(resource.files.map(file => file.id)).size).toBe(2);
    expect(JSON.stringify(resource)).not.toMatch(/storageKey|private-storage|private-token|private-provider|nodeId/u);
    expect(JSON.stringify(prepared)).not.toMatch(/private-token|private-user|storageKey|private-storage/u);
    expect(f.readAuthority.mock.calls.map(([input]) => input.operation)).toEqual([
      { operation: 'rename-library-files', nodeIds: [9, 10], includeCredentials: false },
      { operation: 'rename-library-files', nodeIds: [9, 10], includeCredentials: true },
    ]);
    expect(await resource.currentRevision(f.request.authority.signal)).toBe(resource.revision);
  });

  it('keeps the semantic operation ID stable across reprepare despite new opaque resource IDs', async () => {
    const f = fixture(); const first = await f.prepare(); const firstIds = (mocks.authority.mock.lastCall![1] as MetadataResourceAuthority).files.map(file => file.id);
    const second = await f.prepare(); const secondIds = (mocks.authority.mock.lastCall![1] as MetadataResourceAuthority).files.map(file => file.id);
    expect(second.publicAction).toEqual(first.publicAction); expect(second.snapshotMaterial).toEqual(first.snapshotMaterial);
    expect(firstIds).not.toEqual(secondIds); expect(f.transport.commit).not.toHaveBeenCalled();
    f.nodes[0].updatedAt = '2026-09-22T01:02:03.123457Z';
    const changed = await f.prepare(); expect(changed.publicAction).not.toEqual(first.publicAction);
  });

  it.each(['changed.exe', '../escape.jpg', 'bad/name.jpg', 'new.jpg.', 'new\u0000.jpg', 'new.jpg:stream'])('rejects invalid or extension-changing proposal %s', async name => {
    const f = fixture();
    f.runtime.executeRenameProposal.mockImplementationOnce(async () => {
      const resource = mocks.authority.mock.lastCall![1] as MetadataResourceAuthority;
      return { output: { changes: [{ id: resource.files[0].id, name }] }, source: {} } as never;
    });
    await expect(f.prepare()).rejects.toThrow(); expect(f.transport.dryRun).not.toHaveBeenCalled();
  });

  it('rejects an opaque target that was not supplied to this proposal', async () => {
    const f = fixture();
    f.runtime.executeRenameProposal.mockResolvedValueOnce({ output: { changes: [{ id: 'another-file', name: 'new.jpg' }] }, source: {} } as never);
    await expect(f.prepare()).rejects.toThrow('未授权目标'); expect(f.transport.commit).not.toHaveBeenCalled();
  });

  it('requires fresh preparation when metadata changes while the plugin computes its proposal', async () => {
    const f = fixture(); const original = f.runtime.executeRenameProposal.getMockImplementation()!;
    f.runtime.executeRenameProposal.mockImplementationOnce(async (...args) => {
      const result = await original(...args); f.nodes[0].updatedAt = '2026-09-22T01:02:03.123457Z'; return result;
    });
    await expect(f.prepare()).rejects.toThrow('重新准备'); expect(f.transport.dryRun).not.toHaveBeenCalled();
  });

  it.each([{ libraryId: 4 }, { type: 'dir' }, { parentId: 0 }, { updatedAt: '' }])('rejects substituted authoritative metadata %j', async patch => {
    const f = fixture(); Object.assign(f.nodes[0], patch);
    await expect(f.prepare()).rejects.toThrow(); expect(f.runtime.executeRenameProposal).not.toHaveBeenCalled();
  });

  it('rejects forged source versions even when registration ID is copied from the real plugin', async () => {
    const f = fixture(); f.request.source = { ...f.source, pluginVersion: '9.9.9' };
    await expect(f.prepare()).rejects.toThrow(); expect(f.readAuthority).not.toHaveBeenCalled();
  });

  it('does not let input resources silently expand the host authority target set', async () => {
    const f = fixture(); f.request.authority.operation = { operation: 'rename-library-files', nodeIds: [9], includeCredentials: false };
    await expect(f.prepare()).rejects.toThrow(); expect(f.readAuthority).not.toHaveBeenCalled();
  });

  it('submits only the approved body after fresh metadata and actor checks', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed', atomic: true, libraryId: 3 } });
    expect(f.transport.commit).toHaveBeenCalledTimes(1); expect(f.transport.status).not.toHaveBeenCalled();
    expect(f.transport.commit.mock.calls[0][0]).toEqual(prepared.binding.request);
    expect(f.settlement.begin).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mutationCommitState: 'commit_unknown' }) }));
    expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it.each<Partial<AgentToolMainPreparationIdentity>>([
    { toolRunId: 'other' }, { runId: 'other' }, { sessionId: 'other' }, { aiDestinationIdentity: 'other' },
    { libraryId: 4 }, { ownerWebContentsId: 99 }, { ownerScope: { accountScope: 'user:43', backendScope: 'https://backend.test/api' } },
    { ownerScope: { accountScope: 'user:42', backendScope: 'https://other.test/api' } },
    { toolRegistrationId: 'plugin-tool:' + 'f'.repeat(64) }, { toolName: 'other.rename' },
  ])('rejects prepared execution identity substitution %j', async patch => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    const substituted = { ...prepared, identity: { ...prepared.identity, ...patch } };
    await expect(f.service.execute(f.request, substituted, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('rejects approved-body targets and names that differ from the visible confirmation', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    const body = prepared.binding.request as ConditionalRenameRequest;
    body.items[0].name = 'unapproved';
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled();
  });

  it('rejects same-library input target substitution after preparation', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.request.input = { resources: [9], prefix: 'renamed-' };
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled();
  });

  it('rejects stale metadata and disabled plugins before crossing the commit boundary', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.nodes[0].updatedAt = '2026-09-22T01:02:03.123457Z';
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    f.nodes[0].updatedAt = '2026-09-22T01:02:03.123456Z'; f.manager.stillToolAllowed.mockReturnValue(false);
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('does not submit when cancelled before execution', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare()); f.controller.abort();
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('rechecks cancellation immediately after the final actor check', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.verifyActor.mockImplementationOnce(async () => { f.controller.abort(); });
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow();
    expect(f.transport.commit).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('does not expose an approval after dry-run rejection or package revocation', async () => {
    const f = fixture();
    f.transport.dryRun.mockRejectedValueOnce(new RenameTransportError('HTTP_409', 'uncommitted', 409));
    await expect(f.prepare()).rejects.toMatchObject({ code: 'HTTP_409' });
    f.manager.stillToolAllowed.mockReturnValue(false);
    await expect(f.prepare()).rejects.toThrow('撤销');
    expect(f.transport.commit).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('preserves a committed outcome when the Run is cancelled after commit begins', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.commit.mockImplementationOnce(async body => { f.controller.abort(); return receiptFor(body); });
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed' } });
    expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it('reconciles uncertain commits by querying the same operation with a separate signal', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.commit.mockImplementationOnce(async () => { f.controller.abort(); throw new RenameTransportError('NETWORK', 'commit_unknown'); });
    f.transport.status.mockImplementationOnce(async body => receiptFor(body));
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed' } });
    expect(f.transport.commit).toHaveBeenCalledTimes(1); expect(f.transport.status).toHaveBeenCalledTimes(1);
    expect(f.transport.status.mock.calls[0][0]).toEqual(f.transport.commit.mock.calls[0][0]);
    const statusSignal = (f.transport.status.mock.calls[0] as unknown as [unknown, unknown, AbortSignal])[2];
    expect(statusSignal).not.toBe(f.request.authority.signal); expect(statusSignal.aborted).toBe(false);
  });

  it('retains unknown for not_found and never retries with a newly generated operation ID', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.commit.mockRejectedValueOnce(new RenameTransportError('NETWORK', 'commit_unknown'));
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'commit_unknown', operationId: (prepared.binding.request as ConditionalRenameRequest).operationId } });
    expect(f.transport.commit).toHaveBeenCalledTimes(1); expect(f.transport.status).toHaveBeenCalledTimes(1);
    expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it('keeps failed reconciliation unknown without returning unsafe transport details', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.commit.mockRejectedValueOnce(new Error('private-token https://secret.test/path'));
    f.transport.status.mockRejectedValueOnce(new RenameTransportError('HTTP_403', 'commit_unknown', 403));
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'commit_unknown' } });
    expect(JSON.stringify(result)).not.toMatch(/private-token|secret\.test/u);
    expect(f.transport.commit).toHaveBeenCalledTimes(1); expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it('reports explicit backend refusal as uncommitted without blind status retries', async () => {
    const f = fixture(); const prepared = f.execution(await f.prepare());
    f.transport.commit.mockRejectedValueOnce(new RenameTransportError('HTTP_409', 'uncommitted', 409));
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'uncommitted' } });
    expect(f.transport.status).not.toHaveBeenCalled(); expect(f.transport.commit).toHaveBeenCalledTimes(1);
  });
});

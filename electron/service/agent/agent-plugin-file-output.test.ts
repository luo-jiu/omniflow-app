import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifestJson from '../../../samples/csv-export/manifest.json';
import type { AgentFileAuthorityResultV1, AgentPluginToolSource } from '../../../src/shared/agent/agent.types';
import { parsePluginManifest } from '../extensions/manifest';
import type { PluginManager } from '../extensions/plugin-manager';
import type { PluginToolRuntime } from '../extensions/plugin-tool-runtime';
import type { OpenedResourceAuthority } from '../extensions/resource-broker';
import type { openAgentPluginResource } from './agent-plugin-resource';
import { createAgentMediaArtifactStore } from './agent-media-artifact-store';
import { createAgentMediaArtifactUploadManager } from './agent-media-artifact-upload';
import { AgentMediaUploadControlPlaneError, type AgentMediaUploadControlPlane } from './agent-media-upload-control-plane';
import type { AgentFileAuthorityBrokerRequestInput } from './agent-file-authority-broker';
import { hashAgentToolInputForPreparation, type AgentToolMainPreparationResult, type AgentToolMainPreparedExecution } from './agent-tool-registry';

const mocks = vi.hoisted(() => ({ authority: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/unavailable' }, net: { fetch: vi.fn() } }));
vi.mock('../extensions/plugin-tool-runtime', () => ({ createPluginToolCallAuthority: mocks.authority }));
import { createAgentPluginFileOutputService, type AgentPluginFileOutputRequest } from './agent-plugin-file-output';

const manifest = parsePluginManifest(manifestJson, 'darwin');
const fingerprint = 'a'.repeat(64);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contentHash = (value: string) => createHash('sha256').update(value).digest('hex');
const cleanups: Array<() => Promise<void>> = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-plugin-output-service-'));
  const store = createAgentMediaArtifactStore({ rootPath: root });
  const create = vi.spyOn(store, 'create');
  const source: AgentPluginToolSource = { pluginId: manifest.id, pluginVersion: manifest.version,
    packageFingerprint: fingerprint, toolId: manifest.agentTools![0].id,
    registrationId: `plugin-tool:${sha(['omniflow-agent-tool-v1', manifest.id, manifest.version, fingerprint, manifest.agentTools![0].id])}` };
  const controller = new AbortController(); const lifetime = new AbortController();
  const state = { sourceRevision: 'source-revision', parentRevision: '2026-09-22T01:02:03.123456Z',
    output: 'name,value\nprivate-output-marker,42\n', mimeType: 'text/csv' as 'text/csv' | 'application/json', nodePatch: {} as Record<string, unknown> };
  const sender = { id: 77, isDestroyed: () => false } as WebContents;
  const input = { resource: { nodeId: 9 }, destination: { parentId: 8, fileName: 'processed.csv' }, format: 'csv' };
  const authority: AgentFileAuthorityBrokerRequestInput = { sender, ownerScope: { accountScope: 'user:42', backendScope: 'https://backend.test/api' },
    libraryId: 3, sessionId: 'session', runId: 'run', toolRunId: 'tool-run', signal: controller.signal,
    operation: { operation: 'stage-library-node', nodeId: 9, includeDownloadUrl: true } };
  const request: AgentPluginFileOutputRequest = { source, input, authority, aiDestinationId: 'destination', lifetimeSignal: lifetime.signal,
    assertCurrent: vi.fn(async signal => { signal.throwIfAborted(); lifetime.signal.throwIfAborted(); }) };
  const manager = { resolveTool: vi.fn(() => ({ plugin: { id: source.pluginId, version: source.pluginVersion, fingerprint },
    tool: manifest.agentTools![0], registrationId: source.registrationId, providerName: 'example_csv_export_export', directory: '/virtual/plugin' })),
    stillToolAllowed: vi.fn(() => true) };
  const openResource = vi.fn<typeof openAgentPluginResource>(async () => ({ accountScope: authority.ownerScope.accountScope,
    libraryId: 3, nodeId: 9, name: 'original.csv', size: 20, revision: state.sourceRevision,
    authorize: async () => true, currentRevision: async () => state.sourceRevision,
    readRange: async () => Buffer.from('private-source-marker'),
  } satisfies OpenedResourceAuthority));
  const runtime = { executeFileOutput: vi.fn<PluginToolRuntime['executeFileOutput']>(async () => ({
    output: { mediaType: state.mimeType, text: state.output }, source: { pluginId: source.pluginId, version: source.pluginVersion,
      fingerprint, toolId: source.toolId, registrationId: source.registrationId, nodeId: 9, resourceRevision: state.sourceRevision },
  })) };
  const requestAuthority = vi.fn(async (input: AgentFileAuthorityBrokerRequestInput): Promise<AgentFileAuthorityResultV1> => {
    if (input.operation.operation !== 'publish-library-file') throw new Error('unexpected authority');
    return { operation: 'publish-library-file', version: 1, providerId: 'local-minio', providerLabel: 'Local test',
      parent: { version: 1, id: 8, parentId: 7, libraryId: 3, type: 'dir', name: 'output', fileSize: 0,
        storageKey: '', updatedAt: state.parentRevision },
      ...(input.operation.includeCredentials ? { credentials: { token: 'private-token', username: 'private-user' } } : {}),
    };
  });
  const node = () => ({ id: 90, type: 'file', name: 'processed', ext: 'csv', libraryId: 3, parentId: 8,
    fileSize: Buffer.byteLength(state.output), mimeType: state.mimeType, storageProvider: 'local-minio', ...state.nodePatch });
  const controlPlane: AgentMediaUploadControlPlane = { apiBaseUrl: 'https://backend.test/api',
    verifyAccount: vi.fn(async () => undefined), abort: vi.fn(async () => undefined),
    init: vi.fn<AgentMediaUploadControlPlane['init']>(async (_credentials, value) => ({ mode: 'single', partSize: value.fileSize, totalParts: 1, uploadId: 'upload-fixture' })),
    sign: vi.fn(async () => [{ partNumber: 1, url: 'https://storage.test/bucket/fixture?private-signature' }]),
    complete: vi.fn(async () => node()), reconcile: vi.fn<AgentMediaUploadControlPlane['reconcile']>(async () => ({ state: 'unknown' })),
  };
  const uploaded: Buffer[] = [];
  const uploadFactory = vi.fn<typeof createAgentMediaArtifactUploadManager>(options => createAgentMediaArtifactUploadManager({ ...options,
    transport: { put: vi.fn(async value => {
      const bytes = Buffer.alloc(value.byteLength); const read = await value.fileHandle.read(bytes, 0, bytes.length, value.byteOffset);
      uploaded.push(bytes.subarray(0, read.bytesRead));
      return { etag: 'fixture-etag', sentBytes: read.bytesRead, status: 200 };
    }) },
  }));
  const service = createAgentPluginFileOutputService({ manager: manager as unknown as PluginManager,
    runtimeFor: () => runtime as unknown as PluginToolRuntime, openResource, request: requestAuthority, artifactStore: store, controlPlane, uploadFactory });
  cleanups.push(async () => { lifetime.abort(); await store.releaseRun('run'); await rm(root, { force: true, recursive: true }); });
  const settlement = { begin: vi.fn(), settle: vi.fn() };
  function execution(prepared: AgentToolMainPreparationResult): AgentToolMainPreparedExecution {
    return { binding: structuredClone(prepared.binding), publicAction: structuredClone(prepared.publicAction),
      preparedActionId: 'prepared', snapshotHash: 'v1:' + 'a'.repeat(64), identity: {
        aiDestinationIdentity: request.aiDestinationId, callId: 'call', libraryId: 3, ownerScope: { ...authority.ownerScope },
        ownerWebContentsId: sender.id, preparedActionId: 'prepared', runCapabilityIdentity: 'v1:' + 'b'.repeat(64),
        runId: authority.runId, sessionId: authority.sessionId, toolInputHash: hashAgentToolInputForPreparation(request.input),
        toolName: source.toolId, toolRegistrationId: source.registrationId, toolRunId: authority.toolRunId,
      } };
  }
  return { root, store, create, service, request, state, manager, runtime, openResource, requestAuthority,
    controlPlane, uploadFactory, uploaded, controller, lifetime, settlement, execution, prepare: () => service.prepare(request) };
}

beforeEach(() => { mocks.authority.mockReset(); mocks.authority.mockImplementation(() => Object.freeze({})); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe('Agent plugin file output service', () => {
  it('prepares a sealed private artifact and only publishes its digest and destination', async () => {
    const f = await fixture(); const prepared = await f.prepare();
    expect(prepared.publicAction).toMatchObject({ kind: 'plugin.file-output', libraryId: 3, sourceNodeId: 9, parentId: 8,
      fileName: 'processed.csv', sizeBytes: Buffer.byteLength(f.state.output), sha256: contentHash(f.state.output), mediaType: 'text/csv' });
    expect(prepared.decision.behavior).toBe('ask');
    expect(f.create).toHaveBeenCalledWith('processed.csv', expect.objectContaining({ executionId: 'tool-run', runId: 'run' }), { maxBytes: 1024 * 1024 });
    const artifact = await f.create.mock.results[0].value;
    expect(await readFile(artifact.filePath, 'utf8')).toBe(f.state.output);
    expect(JSON.stringify(prepared)).not.toMatch(/private-output-marker|private-source-marker|private-token|filePath|directoryPath/u);
    expect(f.controlPlane.init).not.toHaveBeenCalled(); expect(f.controlPlane.complete).not.toHaveBeenCalled();
  });

  it('reuses the same artifact and operation during reprepare without rerunning plugin code', async () => {
    const f = await fixture(); const first = await f.prepare(); const second = await f.prepare();
    expect(second.publicAction).toEqual(first.publicAction); expect(second.binding).toEqual(first.binding);
    expect(f.runtime.executeFileOutput).toHaveBeenCalledOnce(); expect(f.create).toHaveBeenCalledOnce();
  });

  it('releases a cached artifact after reprepare fails and the host ends that ToolRun', async () => {
    const f = await fixture(); await f.prepare(); const original = await f.create.mock.results[0].value;
    f.requestAuthority.mockRejectedValueOnce(new Error('temporary authority unavailable'));
    await expect(f.prepare()).rejects.toThrow();
    await f.service.releaseRun('run', 'tool-run');
    await expect(access(original.filePath)).rejects.toThrow();
    await f.prepare();
    expect(f.runtime.executeFileOutput).toHaveBeenCalledTimes(2);
  });

  it('releases a declined prepared Tool without cancelling or releasing another Run', async () => {
    const f = await fixture(); const prepared = await f.prepare(); const artifact = await f.create.mock.results[0].value;
    await f.service.releaseRun('another-run', 'tool-run');
    await expect(access(artifact.filePath)).resolves.toBeUndefined();
    await f.service.releaseRun('run', 'tool-run'); await f.service.releaseRun('run', 'tool-run');
    await expect(access(artifact.filePath)).rejects.toThrow();
    await expect(f.service.execute(f.request, f.execution(prepared), f.settlement)).rejects.toThrow('批准身份');
    expect(f.controlPlane.init).not.toHaveBeenCalled();
  });

  it.each(['create', 'finalize'] as const)('does not expose private artifact paths when %s fails', async operation => {
    const f = await fixture();
    vi.spyOn(f.store, operation).mockRejectedValueOnce(new Error(`EACCES: denied '${f.root}/private-output.csv'`));
    const error = await f.prepare().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(f.root);
    expect(error.message).not.toContain('private-output.csv');
    expect(f.controlPlane.init).not.toHaveBeenCalled();
    if (operation === 'finalize') {
      const artifact = await f.create.mock.results[0].value;
      await expect(access(artifact.directoryPath)).rejects.toThrow();
    }
  });

  it('regenerates after source revision drift and discards the old artifact', async () => {
    const f = await fixture(); const first = await f.prepare(); const old = await f.create.mock.results[0].value;
    f.state.sourceRevision = 'new-revision'; const second = await f.prepare();
    expect(second.publicAction).not.toEqual(first.publicAction); expect(f.runtime.executeFileOutput).toHaveBeenCalledTimes(2);
    await expect(access(old.filePath)).rejects.toThrow();
  });

  it('rejects an output over 1 MiB before creating an artifact', async () => {
    const f = await fixture(); f.state.output = 'x'.repeat(1024 * 1024 + 1);
    await expect(f.prepare()).rejects.toThrow('大小'); expect(f.create).not.toHaveBeenCalled();
  });

  it('accepts an output exactly at 1 MiB without exposing its plaintext to approval', async () => {
    const f = await fixture(); f.state.output = 'x'.repeat(1024 * 1024);
    const prepared = await f.prepare(); expect(prepared.publicAction).toMatchObject({ sizeBytes: 1024 * 1024, sha256: contentHash(f.state.output) });
    expect(JSON.stringify(prepared).length).toBeLessThan(6000); expect(f.controlPlane.init).not.toHaveBeenCalled();
  });

  it('requires new preparation after the target directory changes', async () => {
    const f = await fixture(); await f.prepare(); f.state.parentRevision = '2026-09-22T01:02:03.123457Z';
    await expect(f.prepare()).rejects.toThrow('重新准备');
    await expect(f.prepare()).resolves.toMatchObject({ publicAction: { kind: 'plugin.file-output' } });
    expect(f.runtime.executeFileOutput).toHaveBeenCalledTimes(2);
  });

  it('rejects source identities outside the host-authorized file', async () => {
    const f = await fixture(); f.request.authority.operation = { operation: 'stage-library-node', nodeId: 10, includeDownloadUrl: true };
    await expect(f.prepare()).rejects.toThrow('授权范围'); expect(f.openResource).not.toHaveBeenCalled();
  });

  it('uploads only the sealed bytes using conflict error and the approved operation ID', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed', fileName: 'processed.csv',
      node: { id: 90, name: 'processed', ext: 'csv' }, sha256: contentHash(f.state.output) } });
    expect(Buffer.concat(f.uploaded).toString()).toBe(f.state.output);
    expect(f.controlPlane.complete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ conflictPolicy: 'error',
      clientOperationId: (prepared.publicAction as { operationId: string }).operationId }), expect.any(AbortSignal));
    expect(f.settlement.settle).toHaveBeenCalledWith(result); expect(f.runtime.executeFileOutput).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/private-output-marker|private-source-marker|private-token|storage\.test/u);
  });

  it('rejects a preparation from another owner even within the same library', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    const changed = { ...prepared, identity: { ...prepared.identity, ownerScope: { ...prepared.identity.ownerScope, accountScope: 'user:99' } } };
    await expect(f.service.execute(f.request, changed, f.settlement)).rejects.toThrow('批准身份');
    expect(f.controlPlane.init).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it.each(['source', 'target'] as const)('rejects approved %s drift before upload initialization', async kind => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    if (kind === 'source') f.state.sourceRevision = 'changed'; else f.state.parentRevision = 'changed';
    await expect(f.service.execute(f.request, prepared, f.settlement)).rejects.toThrow('提交前验证或上传失败');
    expect(f.controlPlane.init).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
  });

  it('rechecks the destination after uploading bytes and before beginning the commit', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    vi.mocked(f.controlPlane.sign).mockImplementationOnce(async () => {
      f.state.parentRevision = '2026-09-22T01:02:03.123457Z';
      return [{ partNumber: 1, url: 'https://storage.test/bucket/fixture?private-signature' }];
    });
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(f.uploaded.length).toBe(1);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'uncommitted' } });
    expect(f.controlPlane.complete).not.toHaveBeenCalled(); expect(f.settlement.begin).not.toHaveBeenCalled();
    expect(f.controlPlane.abort).toHaveBeenCalledOnce();
  });

  it.each([{ libraryId: 4 }, { id: 9 }, { mimeType: 'application/json' }, { fileSize: 1 }])('keeps a substituted committed receipt unknown: %j', async patch => {
    const f = await fixture(); const prepared = f.execution(await f.prepare()); f.state.nodePatch = patch;
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'commit_unknown' } });
    expect(f.controlPlane.reconcile).toHaveBeenCalledOnce(); expect(f.controlPlane.abort).not.toHaveBeenCalled();
  });

  it('retains committed evidence when cancellation occurs after the upload completes', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    const complete = vi.mocked(f.controlPlane.complete).getMockImplementation()!;
    vi.mocked(f.controlPlane.complete).mockImplementationOnce(async (...args) => { const result = await complete(...args); f.controller.abort(); return result; });
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: true, data: { mutationCommitState: 'committed' } });
    expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it('retains commit_unknown and the same operation when cancellation also prevents reconciliation', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare());
    vi.mocked(f.controlPlane.complete).mockImplementationOnce(async () => { f.controller.abort(); throw new Error('private connection details'); });
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'commit_unknown',
      operationId: (prepared.publicAction as { operationId: string }).operationId } });
    expect(f.controlPlane.complete).toHaveBeenCalledOnce(); expect(f.controlPlane.abort).not.toHaveBeenCalled();
    expect(f.settlement.settle).toHaveBeenCalledWith(result);
  });

  it('reports an explicit same-name conflict as uncommitted and cleans its private artifact', async () => {
    const f = await fixture(); const prepared = f.execution(await f.prepare()); const artifact = await f.create.mock.results[0].value;
    vi.mocked(f.controlPlane.complete).mockRejectedValueOnce(new AgentMediaUploadControlPlaneError('invalid_request', 409));
    const result = await f.service.execute(f.request, prepared, f.settlement);
    expect(result).toMatchObject({ ok: false, data: { mutationCommitState: 'uncommitted' } });
    expect(f.controlPlane.reconcile).not.toHaveBeenCalled(); await expect(access(artifact.filePath)).rejects.toThrow();
  });

  it('discards a pending private artifact when its Run lifetime ends', async () => {
    const f = await fixture(); const prepared = await f.prepare(); const artifact = await f.create.mock.results[0].value;
    f.lifetime.abort(); await f.store.releaseRun('run');
    await expect(access(artifact.filePath)).rejects.toThrow();
    await expect(f.service.execute(f.request, f.execution(prepared), f.settlement)).rejects.toThrow();
    expect(f.controlPlane.init).not.toHaveBeenCalled();
  });
});

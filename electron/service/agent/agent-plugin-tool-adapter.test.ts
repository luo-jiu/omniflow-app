import { describe, expect, it, vi } from 'vitest';
import type { PluginToolContribution } from '../../../packages/plugin-sdk/index.js';
import type { AgentPluginRenamePreparedActionPublicV1, AgentPluginToolSource } from '../../../src/shared/agent/agent.types';
import type { ManagedPlugin } from '../../../src/shared/plugin-management';
import { createPluginToolSnapshot } from '../extensions/plugin-tool-catalog';
import { parsePluginManifest } from '../extensions/manifest';
import renameManifest from '../../../samples/batch-rename/manifest.json';
import outputManifest from '../../../samples/csv-export/manifest.json';
import { createAgentPluginToolSnapshot } from './agent-plugin-tool-adapter';
import { createAgentToolRegistry, hashAgentToolInputForPreparation, type AgentToolExecutionContext,
  type AgentToolMainPreparationContext, type AgentToolMainPreparationResult, type AgentToolMainPreparationSealInput,
} from './agent-tool-registry';

const contribution: PluginToolContribution = {
  id: 'test.csv.query', title: 'CSV 查询', description: '分析本次授权 CSV 文件', entry: 'tool.html',
  inputSchema: { type: 'object', properties: {
    resource: { type: 'object', properties: { nodeId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }, required: ['nodeId'], additionalProperties: false },
    label: { type: 'string', maxLength: 4096 },
  }, required: ['resource'], additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  resourceAccess: [{ parameter: 'resource', mode: 'read', kind: 'file' }], timeoutMs: 1000, maxResultBytes: 1024,
};
function plugin(overrides: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { id: 'test.csv', version: '1.0.0', fingerprint: 'a'.repeat(64), enabled: true, readApproved: true,
    toolApproved: true, source: 'local', installedAt: 'now', viewers: [], agentTools: [structuredClone(contribution)],
    permissions: ['resource.read', 'agent.tools'], running: 0, ...overrides };
}
function context(): AgentToolExecutionContext {
  return { appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] }, onProgress: vi.fn(), signal: new AbortController().signal };
}

describe('Agent per-Run plugin Tool adapter', () => {
  it('combines read-only package Tools and passes only host-fixed source into the Run executor', async () => {
    const base = createAgentToolRegistry().createSnapshot();
    const registrations = createPluginToolSnapshot([plugin()]);
    const snapshot = createAgentPluginToolSnapshot(base, registrations);
    const tool = snapshot.get(contribution.id)!;
    expect(tool).toMatchObject({ kind: 'business', risk: 'read', executor: 'main', registrationId: registrations[0].registrationId,
      pluginSource: { pluginId: 'test.csv', pluginVersion: '1.0.0', packageFingerprint: 'a'.repeat(64), toolId: contribution.id },
      presentation: { groupKind: 'resource-read', operationKind: 'read' } });
    const executePluginTool = vi.fn(async () => ({ ok: true, data: { count: 2 } }));
    const ctx = { ...context(), executePluginTool };
    const input = { resource: { nodeId: 11 } };
    await expect(snapshot.execute(contribution.id, input, ctx, tool.registrationId)).resolves.toEqual({ ok: true, data: { count: 2 } });
    expect(executePluginTool).toHaveBeenCalledWith(tool.pluginSource, input, ctx.signal);
    expect(Object.isFrozen(tool.pluginSource)).toBe(true);
    expect(base.get(contribution.id)).toBeNull();
  });

  it('fails closed without a Run executor and rejects spoofed input identity and unsupported resource values', async () => {
    const snapshot = createAgentPluginToolSnapshot(createAgentToolRegistry().createSnapshot(), createPluginToolSnapshot([plugin()]));
    await expect(snapshot.execute(contribution.id, { resource: { nodeId: 11 } }, context())).rejects.toThrow('执行能力未配置');
    const executePluginTool = vi.fn(async () => ({ ok: true }));
    for (const input of [{ resource: { nodeId: '11' } }, { resource: { nodeId: 11, path: '/secret' } },
      { nodeId: 11 }, { resource: { nodeId: 11 }, pluginSource: snapshot.get(contribution.id)!.pluginSource }]) {
      expect(snapshot.validateInput(contribution.id, input).ok).toBe(false);
      await expect(snapshot.execute(contribution.id, input, { ...context(), executePluginTool })).rejects.toThrow();
    }
    expect(executePluginTool).not.toHaveBeenCalled();
  });

  it('enforces the shared Tool input byte budget in addition to provider schema checks', async () => {
    const sample = plugin();
    sample.agentTools![0].inputSchema.properties!.other = { type: 'string', maxLength: 4096 };
    const snapshot = createAgentPluginToolSnapshot(createAgentToolRegistry().createSnapshot(), createPluginToolSnapshot([sample]));
    const input = { resource: { nodeId: 11 }, label: '字'.repeat(4096), other: '字'.repeat(4096) };
    expect(snapshot.validateInput(contribution.id, input).ok).toBe(false);
    await expect(snapshot.execute(contribution.id, input, context())).rejects.toThrow('byte budget');
  });

  it('keeps previous snapshots immutable when packages are updated or disabled', () => {
    const registry = createAgentToolRegistry();
    const base = registry.createSnapshot();
    const mutable = structuredClone(createPluginToolSnapshot([plugin()]));
    const old = createAgentPluginToolSnapshot(base, mutable);
    mutable[0].contribution.description = 'Changed after snapshot';
    mutable[0].contribution.inputSchema.required!.push('label');
    const updated = createAgentPluginToolSnapshot(base, createPluginToolSnapshot([plugin({ version: '1.0.1', fingerprint: 'b'.repeat(64) })]));
    const disabled = createAgentPluginToolSnapshot(base, createPluginToolSnapshot([plugin({ enabled: false })]));
    expect(disabled.get(contribution.id)).toBeNull();
    expect(old.get(contribution.id)?.pluginSource?.pluginVersion).toBe('1.0.0');
    expect(old.get(contribution.id)?.description).not.toContain('Changed');
    expect(old.validateInput(contribution.id, { resource: { nodeId: 11 } }).ok).toBe(true);
    expect(old.get(contribution.id)?.registrationId).not.toBe(updated.get(contribution.id)?.registrationId);
    expect(registry.list()).toEqual([]);
  });

  it('rejects canonical/provider conflicts and metadata that does not match the frozen package identity', () => {
    const registrations = createPluginToolSnapshot([plugin()]);
    for (const name of ['test.csv.query', 'test_csv_query']) {
      const base = createAgentToolRegistry([{ name, description: '', inputSchema: { type: 'object' }, risk: 'read' }]).createSnapshot();
      expect(() => createAgentPluginToolSnapshot(base, registrations)).toThrow();
    }
    const base = createAgentToolRegistry().createSnapshot();
    for (const change of [{ fingerprint: 'b'.repeat(64) }, { registrationId: `plugin-tool:${'0'.repeat(64)}` }, { providerName: 'file_read' }]) {
      expect(() => createAgentPluginToolSnapshot(base, [{ ...registrations[0], ...change }])).toThrow();
    }
  });

  it('normalizes provenance at registration and rejects extra fields, source mutation and write classification', () => {
    const snapshot = createAgentPluginToolSnapshot(createAgentToolRegistry().createSnapshot(), createPluginToolSnapshot([plugin()]));
    const tool = snapshot.get(contribution.id)!;
    const source = { ...tool.pluginSource! };
    const registry = createAgentToolRegistry([{ ...tool, pluginSource: source }]);
    source.pluginVersion = '2.0.0';
    expect(registry.get(tool.name)?.pluginSource?.pluginVersion).toBe('1.0.0');
    expect(() => createAgentToolRegistry([{ ...tool, presentation: undefined, risk: 'write' }])).toThrow('插件 Tool 契约');
    expect(() => createAgentToolRegistry([{ ...tool, pluginSource: { ...tool.pluginSource!, extra: 'untrusted' } as AgentPluginToolSource }])).toThrow('来源无效');
    expect(() => createAgentToolRegistry([{ ...tool, registrationId: 'another-implementation' }])).toThrow('插件 Tool 契约');
  });

  it('preserves the original base snapshot ownership for sealed main preparations', async () => {
    const name = 'media.extractAudio'; const registrationId = 'media.extractAudio@prepared-test';
    const base = createAgentToolRegistry([{ name, registrationId, description: '', inputSchema: { type: 'object', additionalProperties: false }, risk: 'write',
      prepareMain: async () => { throw new Error('unused'); }, execute: async (_input, ctx) => ({ ok: Boolean(ctx.preparation) }),
    }]).createSnapshot();
    const input = {};
    const sealed = base.sealMainPreparedExecution(name, {
      approvalSemantics: { behavior: 'allow' }, binding: { sourceRevision: 'revision' },
      identity: { aiDestinationIdentity: `v1:${'a'.repeat(64)}`, callId: 'call', libraryId: 3,
        ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' }, ownerWebContentsId: 17,
        preparedActionId: 'prepared', runCapabilityIdentity: `v2:${'b'.repeat(64)}`, runId: 'run', sessionId: 'session',
        toolInputHash: hashAgentToolInputForPreparation(input), toolName: name, toolRegistrationId: registrationId, toolRunId: 'tool-run' },
      publicAction: { conflictPolicy: 'auto_rename', destination: 'library', fallbackPolicy: 'prompt_local', kind: name,
        libraryId: 3, outputFileName: 'audio.m4a', outputFormat: 'm4a', parentId: 10, sourceNodeId: 11, targetLabel: '视频', version: 1 },
    });
    const combined = createAgentPluginToolSnapshot(base, createPluginToolSnapshot([plugin()]));
    const ctx = { ...context(), mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity };
    await expect(combined.execute(name, input, ctx, registrationId)).resolves.toEqual({ ok: true });
    await expect(base.execute(name, input, ctx, registrationId)).rejects.toThrow('已使用');
  });
});

function renameSnapshot() {
  const manifest = parsePluginManifest(renameManifest, 'darwin');
  const registrations = createPluginToolSnapshot([plugin({
    id: manifest.id, version: manifest.version, readApproved: false, renameApproved: true,
    permissions: manifest.permissions, agentTools: manifest.agentTools,
  })]);
  const snapshot = createAgentPluginToolSnapshot(createAgentToolRegistry().createSnapshot(), registrations);
  return { snapshot, tool: snapshot.get(manifest.agentTools![0].id)! };
}

function renamePreparation(source: AgentPluginToolSource, input: unknown): AgentToolMainPreparationSealInput {
  const publicAction: AgentPluginRenamePreparedActionPublicV1 = {
    kind: 'plugin.rename', version: 1, libraryId: 3, operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68',
    pluginId: source.pluginId, pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint,
    items: [{ nodeId: 11, parentId: 10, oldName: 'file.txt', newName: 'new-file.txt' }],
  };
  return {
    approvalSemantics: { behavior: 'ask', risk: 'write' }, binding: { proposalId: 'main-only-proposal' }, publicAction,
    identity: { aiDestinationIdentity: `v1:${'a'.repeat(64)}`, callId: 'call', libraryId: 3,
      ownerScope: { accountScope: 'user:7', backendScope: 'http://localhost:9000' }, ownerWebContentsId: 17,
      preparedActionId: 'prepared', runCapabilityIdentity: `v2:${'b'.repeat(64)}`, runId: 'run', sessionId: 'session',
      toolInputHash: hashAgentToolInputForPreparation(input), toolName: source.toolId, toolRegistrationId: source.registrationId, toolRunId: 'rename-run' },
  };
}

describe('Agent plugin rename proposal adapter', () => {
  it('maps rename to main-prepared write semantics without resource-read presentation', async () => {
    const { tool } = renameSnapshot();
    expect(tool).toMatchObject({ pluginOperation: 'rename', kind: 'business', risk: 'write', executor: 'main', cancellationSettleTimeoutMs: 45_000 });
    expect(tool.presentation).toBeUndefined(); expect(Object.isFrozen(tool)).toBe(true);
    const input = { resources: [11], prefix: 'new-' };
    const { publicAction, binding } = renamePreparation(tool.pluginSource!, input);
    const prepared: AgentToolMainPreparationResult = { binding, publicAction,
      decision: { behavior: 'ask', risk: 'write', preview: { title: '确认改名', description: '旧名到新名', risk: 'write' } } };
    const preparePluginRename = vi.fn(async () => prepared); const signal = new AbortController().signal;
    const ctx = { preparePluginRename, signal } as unknown as AgentToolMainPreparationContext;
    await expect(tool.prepareMain!(input, undefined, ctx)).resolves.toBe(prepared);
    expect(preparePluginRename).toHaveBeenCalledWith(tool.pluginSource, input, signal);
    await expect(tool.prepareMain!(input, undefined, { signal } as AgentToolMainPreparationContext)).rejects.toThrow('准备能力未配置');
    await expect(tool.prepareMain!({ resources: [11, 11] }, undefined, ctx)).rejects.toThrow();
    expect(preparePluginRename).toHaveBeenCalledOnce();
  });

  it('requires the exact one-use sealed preparation plus the host commit closure before execution', async () => {
    const { snapshot, tool } = renameSnapshot(); const input = { resources: [11], prefix: 'new-' };
    const executePluginTool = vi.fn(async () => ({ ok: true }));
    const executePluginRename = vi.fn(async () => ({ ok: true, data: { renamed: 1 } }));
    const commitSettlement = { begin: vi.fn(), settle: vi.fn() };
    await expect(snapshot.execute(tool.name, input, { ...context(), executePluginRename, commitSettlement })).rejects.toThrow('缺少 main prepared');
    const sealed = snapshot.sealMainPreparedExecution(tool.name, renamePreparation(tool.pluginSource!, input));
    const ctx = { ...context(), executePluginTool, executePluginRename, commitSettlement,
      mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity };
    await expect(snapshot.execute(tool.name, input, ctx, tool.registrationId)).resolves.toEqual({ ok: true, data: { renamed: 1 } });
    expect(executePluginRename).toHaveBeenCalledWith(tool.pluginSource, input,
      expect.objectContaining({ publicAction: sealed.publicAction, snapshotHash: sealed.snapshotHash }), commitSettlement, ctx.signal);
    expect(executePluginTool).not.toHaveBeenCalled();
    await expect(snapshot.execute(tool.name, input, ctx)).rejects.toThrow('已使用');
    const missingCommit = snapshot.sealMainPreparedExecution(tool.name, renamePreparation(tool.pluginSource!, input));
    await expect(snapshot.execute(tool.name, input, { ...context(), executePluginRename,
      mainPreparationCapability: missingCommit.capability, mainPreparationIdentity: missingCommit.identity })).rejects.toThrow('宿主提交能力');
  });

  it('rejects rename classification without prepared write provenance and rejects read reclassification', () => {
    const { tool } = renameSnapshot();
    for (const change of [
      { pluginSource: undefined }, { risk: 'read' as const }, { executor: 'renderer' as const },
      { prepareMain: undefined }, { pluginOperation: undefined }, { registrationId: 'different' },
    ]) expect(() => createAgentToolRegistry([{ ...tool, ...change }])).toThrow('插件 Tool 契约');
    expect(() => createAgentToolRegistry([{ ...tool, pluginOperation: 'write' as 'rename' }])).toThrow('插件 Tool 契约');
  });

  it('seals plugin.rename only for the matching frozen plugin code identity', () => {
    const { snapshot, tool } = renameSnapshot(); const input = { resources: [11] };
    const preparation = renamePreparation(tool.pluginSource!, input);
    for (const change of [{ pluginId: 'other.plugin' }, { pluginVersion: '9.0.0' }, { packageFingerprint: 'b'.repeat(64) }]) {
      expect(() => snapshot.sealMainPreparedExecution(tool.name, {
        ...preparation, publicAction: { ...preparation.publicAction, ...change },
      })).toThrow('seal 无效');
    }
    const ordinary = createAgentToolRegistry([{ name: 'plugin.rename', description: '', risk: 'write', inputSchema: { type: 'object' },
      prepareMain: async () => { throw new Error('unused'); }, execute: async () => ({ ok: true }),
    }]).createSnapshot();
    const ordinaryTool = ordinary.get('plugin.rename')!;
    expect(() => ordinary.sealMainPreparedExecution(ordinaryTool.name, { ...preparation,
      identity: { ...preparation.identity, toolName: ordinaryTool.name, toolRegistrationId: ordinaryTool.registrationId },
    })).toThrow('seal 无效');
    expect(snapshot.sealMainPreparedExecution(tool.name, preparation).publicAction).toEqual(preparation.publicAction);
  });

  it('rejects a tampered input file set after a valid proposal was sealed', async () => {
    const { snapshot, tool } = renameSnapshot(); const input = { resources: [11] };
    const sealed = snapshot.sealMainPreparedExecution(tool.name, renamePreparation(tool.pluginSource!, input));
    const executePluginRename = vi.fn(async () => ({ ok: true }));
    const ctx = { ...context(), executePluginRename, commitSettlement: { begin: vi.fn(), settle: vi.fn() },
      mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity };
    await expect(snapshot.execute(tool.name, { resources: [13] }, ctx)).rejects.toThrow('identity 不匹配');
    expect(executePluginRename).not.toHaveBeenCalled();
  });
});

describe('Agent plugin file-output adapter', () => {
  function outputSnapshot() {
    const manifest = parsePluginManifest(outputManifest, 'darwin');
    const registrations = createPluginToolSnapshot([plugin({ id: manifest.id, version: manifest.version,
      outputApproved: true, permissions: manifest.permissions, agentTools: manifest.agentTools })]);
    const snapshot = createAgentPluginToolSnapshot(createAgentToolRegistry().createSnapshot(), registrations);
    return { snapshot, tool: snapshot.get(manifest.agentTools![0].id)! };
  }
  it('requires a sealed source-bound file-output preparation and never dispatches through the read callback', async () => {
    const { snapshot, tool } = outputSnapshot();
    const input = { resource: { nodeId: 11 }, destination: { parentId: 10, fileName: 'processed.csv' }, format: 'csv' };
    expect(tool).toMatchObject({ pluginOperation: 'file-output', risk: 'write', executor: 'main', cancellationSettleTimeoutMs: 45_000 });
    const source = tool.pluginSource!;
    const base = renamePreparation(source, input);
    const prepared: AgentToolMainPreparationSealInput = { ...base, publicAction: { kind: 'plugin.file-output', version: 1,
      libraryId: 3, operationId: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68', sourceNodeId: 11, parentId: 10,
      fileName: 'processed.csv', providerId: 'local-minio', mediaType: 'text/csv', sizeBytes: 12, sha256: 'c'.repeat(64),
      pluginId: source.pluginId, pluginVersion: source.pluginVersion, packageFingerprint: source.packageFingerprint } };
    const preparationResult: AgentToolMainPreparationResult = { binding: prepared.binding, publicAction: prepared.publicAction,
      decision: { behavior: 'ask', risk: 'write', preview: { title: '保存产物', description: '', risk: 'write' } } };
    const preparePluginFileOutput = vi.fn(async () => preparationResult);
    await expect(tool.prepareMain!(input, undefined, { preparePluginFileOutput } as unknown as AgentToolMainPreparationContext)).resolves.toBe(preparationResult);
    const executePluginFileOutput = vi.fn(async () => ({ ok: true }));
    const executePluginTool = vi.fn();
    await expect(snapshot.execute(tool.name, input, { ...context(), executePluginFileOutput })).rejects.toThrow('main prepared');
    const sealed = snapshot.sealMainPreparedExecution(tool.name, prepared);
    const ctx = { ...context(), executePluginFileOutput, executePluginTool, commitSettlement: { begin: vi.fn(), settle: vi.fn() },
      mainPreparationCapability: sealed.capability, mainPreparationIdentity: sealed.identity };
    await expect(snapshot.execute(tool.name, input, ctx)).resolves.toEqual({ ok: true });
    expect(executePluginTool).not.toHaveBeenCalled(); expect(executePluginFileOutput).toHaveBeenCalledOnce();
    await expect(snapshot.execute(tool.name, input, ctx)).rejects.toThrow('已使用');
    expect(() => snapshot.sealMainPreparedExecution(tool.name, renamePreparation(source, input))).toThrow();
  });
});

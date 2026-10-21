import { describe, expect, it, vi } from 'vitest';

import {
  createAgentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentToolMainPreparedExecution,
} from '../agent-tool-registry';
import type { AgentShellPreparedActionPublicV1 } from '../../../../src/shared/agent/shell/agent-shell.types';
import { createAgentShellExecutionLeaseManager } from './agent-shell-execution-lease';
import { createAgentShellCommandAnalyzer, createAgentShellExecutionIdentity } from './agent-shell-command-analyzer';
import { createAgentShellCommandHash } from './agent-shell-prepared-action';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

const OWNER: AgentShellWorkspaceOwner = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

function workspace(): AgentShellWorkspacePreparationContext {
  return Object.freeze({
    generation: 3,
    logicalCwd: 'work',
    owner: OWNER,
    physicalCwdPath: '/private/agent/workspace/work',
    physicalHomePath: '/private/agent/workspace/home',
    physicalTempPath: '/private/agent/workspace/tmp',
    runId: 'run-1',
    workspaceContentIdentity: `v3:${'1'.repeat(64)}`,
    workspaceContentScannerRevision: 'workspace-content-scanner-v3',
    workspaceEntryCount: 5,
    workspaceId: 'workspace-1',
    workspaceMetadataIdentity: `v2:${'2'.repeat(64)}`,
    workspaceTotalBytes: 0,
  });
}

function prepared(workspaceContext = workspace()): AgentToolMainPreparedExecution & {
  readonly publicAction: AgentShellPreparedActionPublicV1;
} {
  const command = 'printf hello';
  const commandHash = createAgentShellCommandHash(command);
  const preparation: AgentToolMainPreparedExecution & { readonly publicAction: AgentShellPreparedActionPublicV1 } = {
    binding: {
      aiDestination: { identity: `v1:${'3'.repeat(64)}` },
      analysis: {
        analysisIdentity: `v1:${'4'.repeat(64)}`,
        analyzerRevision: 'test-analyzer-v1',
        providerAnalyzerRevision: 'test-provider-analyzer-v1',
        authorizationIdentity: `v1:${'5'.repeat(64)}`,
        workspaceBoundaryVerified: true,
      },
      commandHash,
      effectiveEnvironment: {
        entries: [{ name: 'PATH', value: '/usr/bin' }],
      },
      invocation: { argv: ['-f', '-c', command], executable: '/bin/zsh', shell: false },
      provider: {
        executable: 'zsh',
        executableContentIdentity: { sha256: 'b'.repeat(64), sizeBytes: 100 },
        fixedArgs: ['-f', '-c'],
        registrationIdentity: `v1:${'6'.repeat(64)}`,
        resolvedExecutable: '/bin/zsh',
      },
      workspace: workspaceContext,
    },
    identity: {
      aiDestinationIdentity: `v1:${'3'.repeat(64)}`,
      callId: 'call-1',
      libraryId: 3,
      ownerScope: OWNER,
      ownerWebContentsId: 1,
      preparedActionId: 'prepared-1',
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      runId: 'run-1',
      sessionId: 'session-1',
      toolInputHash: '8'.repeat(64),
      toolName: 'shell.run',
      toolRegistrationId: 'shell.run@1',
      toolRunId: 'tool-run-1',
    },
    preparedActionId: 'prepared-1',
    publicAction: {
      aiDestination: {
        identityHash: `v1:${'3'.repeat(64)}`,
        profileLabel: 'Local',
        providerType: 'openai-compatible',
      },
      assessment: {
        facets: ['process_launch'],
        operations: [{ argvPrefix: ['hello'], effects: ['process_launch'], executable: 'printf' }],
        persistentRuleEligible: false,
        risk: 'write',
        unresolved: [],
      },
      command,
      commandHash,
      cwd: { kind: 'run-workspace', path: 'work' },
      dataScope: { stagedInputs: [], unresolvedWorkspaceRead: false },
      environment: [],
      kind: 'shell.run',
      provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
      timeoutMs: 10_000,
      version: 1,
    },
    snapshotHash: '9'.repeat(64),
  };
  const analysis = preparation.binding.analysis as { analysisIdentity: string; analyzerRevision: string;
    providerAnalyzerRevision: string; workspaceBoundaryVerified: boolean; executionIdentity?: string };
  analysis.executionIdentity = createAgentShellExecutionIdentity({
    command,
    dialect: preparation.publicAction.provider.dialect,
    logicalCwd: workspaceContext.logicalCwd,
    providerAnalyzerRevision: analysis.providerAnalyzerRevision,
    analysis: { ...analysis, assessment: preparation.publicAction.assessment },
  });
  return preparation;
}

function storeFixture(current: () => AgentShellWorkspacePreparationContext = workspace) {
  const resolvePreparationContext = vi.fn(async () => current());
  return { resolvePreparationContext };
}

async function unknownPrepared() {
  const source = prepared();
  const command = 'g++ -std=c++17 ../input/main.cpp -o test && ./test';
  const providerAnalyzerRevision = 'test-provider-analyzer-v1';
  const analysis = await createAgentShellCommandAnalyzer().analyze({
    command, dialect: 'zsh', logicalCwd: 'work', hasEnvironmentOverrides: false,
    persistentRuleEligible: true, providerAnalyzerRevision,
  });
  const executionIdentity = createAgentShellExecutionIdentity({
    command, dialect: 'zsh', logicalCwd: 'work', providerAnalyzerRevision, analysis,
  });
  const commandHash = createAgentShellCommandHash(command);
  return {
    ...source,
    binding: { ...source.binding, commandHash,
      analysis: { analysisIdentity: analysis.analysisIdentity, analyzerRevision: analysis.analyzerRevision,
        authorizationIdentity: null, executionIdentity, providerAnalyzerRevision,
        workspaceBoundaryVerified: analysis.workspaceBoundaryVerified },
      invocation: { argv: ['-f', '-c', command], executable: '/bin/zsh', shell: false },
    },
    publicAction: { ...source.publicAction, command, commandHash, assessment: analysis.assessment,
      dataScope: { stagedInputs: [], unresolvedWorkspaceRead: true } },
  };
}

describe('Agent Shell execution lease', () => {
  it('carries an unresolved compiler command through a one-shot lease without a rule identity', async () => {
    const source = await unknownPrepared();
    expect(source.binding.analysis.analysisIdentity).toBeNull();
    expect(source.binding.analysis.authorizationIdentity).toBeNull();
    const store = storeFixture();
    const manager = createAgentShellExecutionLeaseManager({ workspaceStore: store });
    const lease = await manager.acquire({ owner: OWNER, preparation: source,
      runCapabilityIdentity: source.identity.runCapabilityIdentity, toolRunId: source.identity.toolRunId,
      workspaceId: 'workspace-1' });
    const grant = await manager.consume(lease, OWNER);
    expect(grant.executionIdentity).toBe(source.binding.analysis.executionIdentity);
    expect(grant.command).toBe(source.publicAction.command);
    expect(store.resolvePreparationContext).toHaveBeenCalledTimes(2);
    await expect(manager.consume(lease, OWNER)).rejects.toThrow('不存在或已失效');
  });

  it.each([undefined, null, 'broken', `v1:${'0'.repeat(64)}`])('rejects a missing, malformed or tampered execution identity: %s', async value => {
    for (const source of [prepared(), await unknownPrepared()]) {
      Object.assign(source.binding.analysis as object, { executionIdentity: value });
      const manager = createAgentShellExecutionLeaseManager({ workspaceStore: storeFixture() });
      await expect(manager.acquire({ owner: OWNER, preparation: source,
        runCapabilityIdentity: source.identity.runCapabilityIdentity, toolRunId: source.identity.toolRunId,
        workspaceId: 'workspace-1' })).rejects.toThrow('execution identity');
      expect(manager.getActiveCount()).toBe(0);
    }
  });

  it('rejects command replacement even when its command hash and invocation are updated', async () => {
    const source = await unknownPrepared();
    const command = `${source.publicAction.command} --changed`;
    const commandHash = createAgentShellCommandHash(command);
    const replaced = { ...source,
      publicAction: { ...source.publicAction, command, commandHash },
      binding: { ...source.binding, commandHash,
        invocation: { ...source.binding.invocation, argv: ['-f', '-c', command] } },
    };
    const manager = createAgentShellExecutionLeaseManager({ workspaceStore: storeFixture() });
    await expect(manager.acquire({ owner: OWNER, preparation: replaced,
      runCapabilityIdentity: source.identity.runCapabilityIdentity, toolRunId: source.identity.toolRunId,
      workspaceId: 'workspace-1' })).rejects.toThrow('execution identity 不匹配');
  });

  it('rechecks the execution identity and workspace bytes when consuming unknown-command leases', async () => {
    for (const change of ['identity', 'content'] as const) {
      const source = await unknownPrepared();
      let current = workspace();
      const manager = createAgentShellExecutionLeaseManager({ workspaceStore: storeFixture(() => current) });
      const lease = await manager.acquire({ owner: OWNER, preparation: source,
        runCapabilityIdentity: source.identity.runCapabilityIdentity, toolRunId: source.identity.toolRunId,
        workspaceId: 'workspace-1' });
      if (change === 'identity') source.binding.analysis.executionIdentity = `v1:${'0'.repeat(64)}`;
      else current = { ...current, workspaceContentIdentity: `v3:${'f'.repeat(64)}` };
      await expect(manager.consume(lease, OWNER)).rejects.toThrow(change === 'identity' ? 'execution identity' : 'spawn 前已变化');
      expect(manager.getActiveCount()).toBe(0);
    }
  });

  it('accepts the snapshot hash emitted by a real Registry main seal', async () => {
    const source = prepared();
    const toolInput = { command: source.publicAction.command };
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-registry',
      workspaceStore: storeFixture(),
    });
    const registry = createAgentToolRegistry([{
      description: 'Shell Registry-to-lease contract',
      execute: async (_input, context) => {
        if (!context.preparation) throw new Error('missing preparation');
        const lease = await manager.acquire({
          owner: OWNER,
          preparation: context.preparation,
          runCapabilityIdentity: context.preparation.identity.runCapabilityIdentity,
          toolRunId: context.preparation.identity.toolRunId,
          workspaceId: 'workspace-1',
        });
        const grant = await manager.consume(lease, OWNER);
        return { data: { command: grant.command }, ok: true };
      },
      inputSchema: {
        additionalProperties: false,
        properties: { command: { type: 'string' } },
        required: ['command'],
        type: 'object',
      },
      name: 'shell.run',
      prepareMain: async () => { throw new Error('not executed'); },
      preparedRisk: 'dynamic',
      registrationId: 'shell.run@1',
      risk: 'destructive',
    }]);
    const snapshot = registry.createSnapshot();
    const sealed = snapshot.sealMainPreparedExecution('shell.run', {
      approvalSemantics: {
        action: source.publicAction,
        behavior: 'ask',
        risk: source.publicAction.assessment.risk,
      },
      binding: source.binding,
      identity: {
        ...source.identity,
        ownerScope: {
          accountScope: OWNER.accountScope,
          backendScope: OWNER.backendScope,
        },
        toolInputHash: hashAgentToolInputForPreparation(toolInput),
      },
      publicAction: source.publicAction,
    });

    expect(sealed.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(snapshot.execute('shell.run', toolInput, {
      appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] },
      mainPreparationCapability: sealed.capability,
      mainPreparationIdentity: sealed.identity,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })).resolves.toEqual({
      data: { command: 'printf hello' },
      ok: true,
    });
  });

  it('accepts the bare main-seal snapshot hash and re-scans a one-shot lease', async () => {
    const store = storeFixture();
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-1',
      workspaceStore: store,
    });

    const lease = await manager.acquire({
      owner: OWNER,
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    });
    expect(lease).toMatchObject({
      commandHash: createAgentShellCommandHash('printf hello'),
      generation: 3,
      leaseId: 'lease-1',
      workspaceId: 'workspace-1',
    });
    expect(manager.getActiveCount()).toBe(1);

    const grant = await manager.consume(lease, OWNER);
    expect(grant).toMatchObject({
      command: 'printf hello',
      cwdPath: '/private/agent/workspace/work',
      leaseId: 'lease-1',
      provider: { resolvedExecutable: '/bin/zsh' },
    });
    expect(store.resolvePreparationContext).toHaveBeenCalledTimes(2);
    expect(manager.getActiveCount()).toBe(0);
    await expect(manager.consume(lease, OWNER)).rejects.toThrow('不存在或已失效');
  });

  it('rejects a workspace content or generation change before consume', async () => {
    let current = workspace();
    const store = storeFixture(() => current);
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-1',
      workspaceStore: store,
    });
    const lease = await manager.acquire({
      owner: OWNER,
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    });
    current = Object.freeze({
      ...current,
      generation: 4,
      workspaceContentIdentity: `v3:${'f'.repeat(64)}`,
    });

    await expect(manager.consume(lease, OWNER)).rejects.toThrow('spawn 前已变化');
    expect(manager.getActiveCount()).toBe(0);
    expect(manager.release(lease)).toBe(false);
  });

  it('binds owner and Run identities and rejects forged leases', async () => {
    const store = storeFixture();
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-1',
      workspaceStore: store,
    });
    await expect(manager.acquire({
      owner: { ...OWNER, sessionId: 'other-session' },
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    })).rejects.toThrow('owner 不匹配');

    const lease = await manager.acquire({
      owner: OWNER,
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    });
    const forged = { ...lease, leaseId: 'lease-1', token: {} as typeof lease.token };
    await expect(manager.consume(forged, OWNER)).rejects.toThrow('不存在或已失效');
  });

  it('expires leases and makes release idempotent', async () => {
    let currentTime = 100;
    const store = storeFixture();
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-1',
      now: () => currentTime,
      ttlMs: 10,
      workspaceStore: store,
    });
    const lease = await manager.acquire({
      owner: OWNER,
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    });
    currentTime = 110;
    expect(manager.release(lease)).toBe(false);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('allows only one concurrent consumer to cross the spawn boundary', async () => {
    let resolveScan!: () => void;
    const scanGate = new Promise<void>(resolve => { resolveScan = resolve; });
    let calls = 0;
    const store = {
      resolvePreparationContext: vi.fn(async () => {
        calls += 1;
        if (calls > 1) await scanGate;
        return workspace();
      }),
    };
    const manager = createAgentShellExecutionLeaseManager({
      createId: () => 'lease-1',
      workspaceStore: store,
    });
    const lease = await manager.acquire({
      owner: OWNER,
      preparation: prepared(),
      runCapabilityIdentity: `v1:${'7'.repeat(64)}`,
      toolRunId: 'tool-run-1',
      workspaceId: 'workspace-1',
    });
    const first = manager.consume(lease, OWNER);
    await expect(manager.consume(lease, OWNER)).rejects.toThrow('正在消费或已失效');
    resolveScan();
    await expect(first).resolves.toBeDefined();
  });
});

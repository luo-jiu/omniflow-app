import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import { createAgentShellExecutionLeaseManager } from './agent-shell-execution-lease';
import { createAgentShellCommandHash } from './agent-shell-prepared-action';
import {
  createAgentShellSpawnPreflight,
  type AgentShellSpawnPreflightCurrentBinding,
} from './agent-shell-spawn-preflight';
import { resolveAgentShellHostContext } from './agent-shell-host-context';
import type { AgentShellPreparedActionPublicV1 } from '../../../../src/shared/agent/shell/agent-shell.types';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

const OWNER: AgentShellWorkspaceOwner = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
  sessionId: 'session-1',
});

const macOnlyIt = process.platform === 'darwin' ? it : it.skip;
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-shell-preflight-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
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

function prepared(): AgentToolMainPreparedExecution {
  const command = 'printf hello';
  const commandHash = createAgentShellCommandHash(command);
  return {
    binding: {
      aiDestination: {
        configurationIdentity: `v1:${'e'.repeat(64)}`,
        identity: `v1:${'3'.repeat(64)}`,
      },
      analysis: {
        analysisIdentity: `v1:${'4'.repeat(64)}`,
        analyzerRevision: 'shell-command-analyzer-v1',
        authorizationIdentity: `v1:${'5'.repeat(64)}`,
        immutableDenyRevision: 'immutable-deny-v1',
        permissionMode: 'ask',
        policyRevision: 'shell-policy-v1',
        providerAnalyzerRevision: 'shell-analyzer-v1',
        workspaceBoundaryVerified: true,
      },
      commandHash,
      environmentBindingVersion: 1,
      effectiveEnvironment: {
        entries: [{ name: 'PATH', value: '/usr/bin' }],
        identity: `v1:${'c'.repeat(64)}`,
        pathHash: `v1:${'d'.repeat(64)}`,
        policyRevision: 'shell-environment-v1',
        providerPolicyRevision: 'zsh-environment-v1',
        servicePolicyRevision: 'shell-environment-policy-v1',
      },
      invocation: { argv: ['-f', '-c', command], executable: '/bin/zsh', shell: false },
      provider: {
        encodingRevision: 'zsh-encoding-v1',
        executable: 'zsh',
        executableContentIdentity: { sha256: 'b'.repeat(64), sizeBytes: 100 },
        executionReady: true,
        fixedArgs: ['-f', '-c'],
        invocationRevision: 'zsh-invocation-v1',
        probeGeneration: 1,
        probeIdentity: 'zsh-probe-v1',
        providerSnapshotIdentity: `v1:${'a'.repeat(64)}`,
        registrationIdentity: `v1:${'6'.repeat(64)}`,
        resolvedExecutable: '/bin/zsh',
        terminationRevision: 'zsh-termination-v1',
      },
      workspace: workspace(),
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
}

function currentBinding(input: AgentToolMainPreparedExecution): AgentShellSpawnPreflightCurrentBinding {
  const binding = input.binding as Record<string, any>;
  const analysis = binding.analysis;
  const environment = binding.effectiveEnvironment;
  const provider = binding.provider;
  const host = binding.host;
  return {
    ...(host ? { executionContextIdentity: host.contextIdentity } : {}),
    aiDestinationConfigurationIdentity: binding.aiDestination.configurationIdentity,
    aiDestinationIdentity: input.identity.aiDestinationIdentity,
    analysisIdentity: analysis.analysisIdentity,
    analyzerRevision: analysis.analyzerRevision,
    authorizationIdentity: analysis.authorizationIdentity,
    environmentBindingVersion: binding.environmentBindingVersion,
    environmentIdentity: environment.identity,
    environmentPolicyRevision: environment.policyRevision,
    immutableDenyRevision: analysis.immutableDenyRevision,
    pathHash: environment.pathHash,
    permissionMode: analysis.permissionMode,
    policyRevision: analysis.policyRevision,
    providerAnalyzerRevision: analysis.providerAnalyzerRevision,
    providerEncodingRevision: provider.encodingRevision,
    providerExecutableSha256: provider.executableContentIdentity.sha256,
    providerExecutableSizeBytes: provider.executableContentIdentity.sizeBytes,
    providerExecutionReady: provider.executionReady,
    providerInvocationRevision: provider.invocationRevision,
    providerProbeGeneration: provider.probeGeneration,
    providerProbeIdentity: provider.probeIdentity,
    providerRegistrationIdentity: provider.registrationIdentity,
    providerResolvedExecutable: provider.resolvedExecutable,
    providerSnapshotIdentity: provider.providerSnapshotIdentity,
    providerTerminationRevision: provider.terminationRevision,
    providerEnvironmentPolicyRevision: environment.providerPolicyRevision,
    serviceEnvironmentPolicyRevision: environment.servicePolicyRevision,
  };
}

async function hostPrepared(
  root: string,
  cwd: string,
): Promise<AgentToolMainPreparedExecution> {
  const base = prepared();
  const host = await resolveAgentShellHostContext({
    defaultCwd: root,
    environment: { source: { PATH: '/usr/bin' } },
    homedir: root,
    platform: 'darwin',
    requestedCwd: cwd,
  });
  const binding = { ...(base.binding as Record<string, unknown>) };
  delete binding.workspace;
  binding.host = host;
  const baseAction = base.publicAction as AgentShellPreparedActionPublicV1;
  const publicAction: AgentShellPreparedActionPublicV1 = {
    ...baseAction,
    cwd: { kind: 'host', path: cwd },
    dataScope: { ...baseAction.dataScope, unresolvedWorkspaceRead: true },
  };
  return {
    ...base,
    binding,
    publicAction,
  };
}

async function hostGrantFor(
  input: AgentToolMainPreparedExecution,
  root: string,
) {
  const manager = createAgentShellExecutionLeaseManager({
    createId: () => 'host-lease-1',
    hostCwd: root,
    hostHome: root,
    hostPlatform: 'darwin',
    ttlMs: 60_000,
  });
  const lease = await manager.acquire({
    owner: OWNER,
    preparation: input,
    runCapabilityIdentity: input.identity.runCapabilityIdentity,
    toolRunId: input.identity.toolRunId,
  });
  return manager.consume(lease, OWNER);
}

async function grantFor(input: AgentToolMainPreparedExecution) {
  const manager = createAgentShellExecutionLeaseManager({
    createId: () => 'lease-1',
    ttlMs: 60_000,
    workspaceStore: {
      resolvePreparationContext: vi.fn(async () => workspace()),
    },
  });
  const lease = await manager.acquire({
    owner: OWNER,
    preparation: input,
    runCapabilityIdentity: input.identity.runCapabilityIdentity,
    toolRunId: input.identity.toolRunId,
    workspaceId: 'workspace-1',
  });
  return manager.consume(lease, OWNER);
}

function createFixture() {
  const preparation = prepared();
  const currentWorkspace = { value: workspace() };
  let changed = false;
  const watcher = {
    changed: vi.fn(() => changed),
    close: vi.fn(),
  };
  const resolvePreparationContext = vi.fn(async () => currentWorkspace.value);
  const resolveCurrentBinding = vi.fn(async () => currentBinding(preparation));
  const preflight = createAgentShellSpawnPreflight({
    bindingResolver: { resolveCurrentBinding },
    createWatcher: vi.fn((_root, onChange) => ({
      changed: () => watcher.changed(),
      close: watcher.close,
      notify: onChange,
    })) as never,
    observationWindowMs: 0,
    workspaceStore: { resolvePreparationContext },
  });
  return {
    currentWorkspace,
    preparation,
    preflight,
    resolveCurrentBinding,
    resolvePreparationContext,
    watcher,
    markChanged: () => { changed = true; },
  };
}

describe('Agent Shell spawn preflight', () => {
  it('rechecks identities and scans the workspace immediately before spawn', async () => {
    const fixture = createFixture();
    await expect(fixture.preflight.assertReady({
      grant: await grantFor(fixture.preparation),
      owner: OWNER,
      preparation: fixture.preparation,
      runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: fixture.preparation.identity.toolRunId,
      workspaceId: 'workspace-1',
    })).resolves.toBeDefined();
    expect(fixture.resolvePreparationContext).toHaveBeenCalledTimes(2);
    expect(fixture.resolveCurrentBinding).toHaveBeenCalledTimes(2);
    expect(fixture.watcher.close).toHaveBeenCalledOnce();
  });

  it('fails closed when the watcher observes a workspace mutation', async () => {
    const fixture = createFixture();
    fixture.markChanged();
    await expect(fixture.preflight.assertReady({
      grant: await grantFor(fixture.preparation),
      owner: OWNER,
      preparation: fixture.preparation,
      runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: fixture.preparation.identity.toolRunId,
      workspaceId: 'workspace-1',
    })).rejects.toThrow('workspace 在 spawn 前已变化');
    expect(fixture.watcher.close).toHaveBeenCalledOnce();
  });

  it('fails closed when a rescan changes even without a watcher event', async () => {
    const fixture = createFixture();
    fixture.resolvePreparationContext
      .mockResolvedValueOnce(workspace())
      .mockResolvedValueOnce(Object.freeze({
        ...workspace(),
        generation: 4,
        workspaceContentIdentity: `v3:${'f'.repeat(64)}`,
      }));
    await expect(fixture.preflight.assertReady({
      grant: await grantFor(fixture.preparation),
      owner: OWNER,
      preparation: fixture.preparation,
      runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: fixture.preparation.identity.toolRunId,
      workspaceId: 'workspace-1',
    })).rejects.toThrow('workspace 在 spawn 前已变化');
    expect(fixture.watcher.close).toHaveBeenCalledOnce();
  });

  it('fails closed when a provider, AI destination, or policy identity changes', async () => {
    const fixture = createFixture();
    fixture.resolveCurrentBinding.mockResolvedValueOnce({
      ...currentBinding(fixture.preparation),
      providerRegistrationIdentity: 'v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    });
    await expect(fixture.preflight.assertReady({
      grant: await grantFor(fixture.preparation),
      owner: OWNER,
      preparation: fixture.preparation,
      runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: fixture.preparation.identity.toolRunId,
      workspaceId: 'workspace-1',
    })).rejects.toThrow('execution binding 在 spawn 前已变化');
  });

  it('does not keep an abort listener after the observation window settles', async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const grant = await grantFor(fixture.preparation);
    await fixture.preflight.assertReady({
      grant,
      owner: OWNER,
      preparation: fixture.preparation,
      runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
      signal: controller.signal,
      toolRunId: fixture.preparation.identity.toolRunId,
      workspaceId: 'workspace-1',
    });
    expect(() => controller.abort()).not.toThrow();
  });

  macOnlyIt('accepts a host grant without requiring a workspace store', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);
    const preparation = await hostPrepared(root, cwd);
    const resolveCurrentBinding = vi.fn(async () => currentBinding(preparation));
    const preflight = createAgentShellSpawnPreflight({
      bindingResolver: { resolveCurrentBinding },
      hostCwd: root,
      hostHome: root,
      observationWindowMs: 0,
    });

    const grant = await hostGrantFor(preparation, root);
    await expect(preflight.assertReady({
      grant,
      owner: OWNER,
      preparation,
      runCapabilityIdentity: preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: preparation.identity.toolRunId,
    })).resolves.toBe(grant);
    expect(resolveCurrentBinding).toHaveBeenCalledTimes(2);
  });

  macOnlyIt('rejects a host action whose cwd representation differs from the lease', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);
    const preparation = await hostPrepared(root, cwd);
    const grant = await hostGrantFor(preparation, root);
    const forgedPreparation = {
      ...preparation,
      publicAction: {
        ...(preparation.publicAction as AgentShellPreparedActionPublicV1),
        cwd: { kind: 'host' as const, path: path.join(root, 'other') },
      },
    };
    const preflight = createAgentShellSpawnPreflight({
      bindingResolver: {
        resolveCurrentBinding: vi.fn(async () => currentBinding(forgedPreparation)),
      },
      hostCwd: root,
      hostHome: root,
      observationWindowMs: 0,
    });

    await expect(preflight.assertReady({
      grant,
      owner: OWNER,
      preparation: forgedPreparation,
      runCapabilityIdentity: forgedPreparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: forgedPreparation.identity.toolRunId,
    })).rejects.toThrow('host prepared execution 与 grant 不匹配');
  });

  macOnlyIt('rejects a host binding whose context identity differs from the lease', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);
    const preparation = await hostPrepared(root, cwd);
    const grant = await hostGrantFor(preparation, root);
    const host = (preparation.binding as Record<string, any>).host;
    const forgedPreparation = {
      ...preparation,
      binding: {
        ...(preparation.binding as Record<string, unknown>),
        host: { ...host, contextIdentity: `v1:${'f'.repeat(64)}` },
      },
    };
    const preflight = createAgentShellSpawnPreflight({
      bindingResolver: {
        resolveCurrentBinding: vi.fn(async () => currentBinding(forgedPreparation)),
      },
      hostCwd: root,
      hostHome: root,
      observationWindowMs: 0,
    });

    await expect(preflight.assertReady({
      grant,
      owner: OWNER,
      preparation: forgedPreparation,
      runCapabilityIdentity: forgedPreparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: forgedPreparation.identity.toolRunId,
    })).rejects.toThrow('host prepared execution 与 grant 不匹配');
  });

  macOnlyIt('rejects a host grant when its cwd identity drifts before spawn', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    const replacement = path.join(root, 'cwd-replacement');
    await mkdir(cwd);
    const preparation = await hostPrepared(root, cwd);
    const preflight = createAgentShellSpawnPreflight({
      bindingResolver: {
        resolveCurrentBinding: vi.fn(async () => currentBinding(preparation)),
      },
      hostCwd: root,
      hostHome: root,
      observationWindowMs: 0,
    });

    const grant = await hostGrantFor(preparation, root);
    await rename(cwd, replacement);
    await mkdir(cwd);
    await expect(preflight.assertReady({
      grant,
      owner: OWNER,
      preparation,
      runCapabilityIdentity: preparation.identity.runCapabilityIdentity,
      signal: new AbortController().signal,
      toolRunId: preparation.identity.toolRunId,
    })).rejects.toThrow('host cwd 无法确认');
  });
});

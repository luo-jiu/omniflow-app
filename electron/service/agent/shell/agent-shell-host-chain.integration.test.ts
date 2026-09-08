import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createAgentAiDestinationSnapshot } from '../agent-ai-destination';
import { createAgentRunCapabilitySnapshot } from '../agent-run-capability-snapshot';
import {
  createAgentToolRegistry,
  hashAgentToolInputForPreparation,
  type AgentToolMainPreparationContext,
  type AgentToolMainPreparedExecution,
} from '../agent-tool-registry';
import { createAgentSkillRegistry } from '../skills/agent-skill-registry';
import { createAgentShellRunTool } from '../tools/shell-run-tool';
import { createAgentShellBindingResolver } from './agent-shell-binding-resolver';
import { createAgentShellExecutionLeaseManager } from './agent-shell-execution-lease';
import {
  createAgentShellPreparationService,
  type AgentShellPreparationWorkspaceReader,
} from './agent-shell-preparation-service';
import { createAgentShellLogStore } from './agent-shell-log-store';
import { createAgentShellProcessSupervisor } from './agent-shell-process-supervisor';
import { createAgentShellProviderRegistry } from './agent-shell-provider-registry';
import {
  createAgentShellRuntime,
  type AgentShellRuntimeEvent,
} from './agent-shell-runtime';
import { createAgentShellSpawnPreflight } from './agent-shell-spawn-preflight';
import type { AgentShellWorkspaceOwner } from './agent-shell-workspace-store';

const OWNER_SCOPE = Object.freeze({
  accountScope: 'user:77',
  backendScope: 'https://example.com/api',
});
const SESSION_ID = 'session-host-chain';
const RUN_ID = 'run-host-chain';
const TOOL_RUN_ID = 'tool-run-host-chain';
const PROFILE_ID = 'profile-host-chain';
const TOOL_REGISTRATION_ID = 'shell.run@1';
const FIXTURE_CLI_NAME = 'omniflow-host-fixture';
const macOnlyIt = process.platform === 'darwin' ? it : it.skip;

const RUNTIME_PROFILE = Object.freeze({
  apiKey: 'main-only-test-key',
  baseUrl: 'https://example.com/v1',
  configurationRevision: 'host-chain-revision-1',
  id: PROFILE_ID,
  name: 'Host chain test',
  providerType: 'local' as const,
});

interface HostChainFixture {
  readonly additionalBinPath: string;
  readonly cwdPath: string;
  readonly fixtureCliPath: string;
  readonly hostRoot: string;
  readonly owner: AgentShellWorkspaceOwner;
  readonly preparation: AgentToolMainPreparedExecution;
  readonly preparationResult: Awaited<
    ReturnType<ReturnType<typeof createAgentShellPreparationService>['prepare']>
  >;
  readonly requestedCwd: string;
  readonly resolver: ReturnType<typeof createAgentShellBindingResolver>;
  readonly workspaceReader: AgentShellPreparationWorkspaceReader;
  readonly workspaceResolver: ReturnType<
    typeof vi.fn<AgentShellPreparationWorkspaceReader['resolvePreparationContext']>
  >;
}

async function createHostChainFixture(options: {
  readonly command?: string;
} = {}): Promise<HostChainFixture> {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'omniflow-host-chain-'));
  const requestedCwd = 'requested-cwd';
  const cwdPath = path.join(hostRoot, requestedCwd);
  const inheritedBinPath = path.join(hostRoot, 'inherited-bin');
  const additionalBinPath = path.join(hostRoot, 'additional-bin');
  await Promise.all([
    mkdir(cwdPath),
    mkdir(inheritedBinPath),
    mkdir(additionalBinPath),
  ]);
  const fixtureCliPath = path.join(additionalBinPath, FIXTURE_CLI_NAME);
  await writeFile(fixtureCliPath, [
    '#!/bin/sh',
    'printf \'cwd=%s\\n\' "$PWD"',
    'printf \'host=%s\\n\' "$OMNIFLOW_HOST_MARKER"',
    'printf \'run=%s\\n\' "$RUN_LABEL"',
    'if [ "${TEST_API_KEY+x}" = x ]; then',
    '  printf \'sensitive=present\\n\'',
    'else',
    '  printf \'sensitive=absent\\n\'',
    'fi',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o755 });

  const hostEnvironment = Object.freeze({
    HOME: hostRoot,
    OMNIFLOW_HOST_MARKER: 'inherited-from-main',
    PATH: `${inheritedBinPath}:/usr/bin:/bin`,
    TEST_API_KEY: 'must-not-reach-the-child',
  });
  const workspaceResolver = vi.fn<
    AgentShellPreparationWorkspaceReader['resolvePreparationContext']
  >(async () => {
    throw new Error('host execution must not resolve a Run workspace');
  });
  const workspaceReader = Object.freeze({
    resolvePreparationContext: workspaceResolver,
  });
  const providerRegistry = createAgentShellProviderRegistry({
    candidates: { darwin: ['/bin/zsh'] },
    platform: 'darwin',
  });
  const providerSnapshot = await providerRegistry.refresh();
  if (!providerSnapshot.getProviderById('system-zsh')) {
    throw new Error('macOS host-chain fixture requires /bin/zsh');
  }

  const toolSnapshot = createAgentToolRegistry([
    createAgentShellRunTool({
      execute: async () => {
        throw new Error('host-chain integration stops before process spawn');
      },
      prepare: async () => {
        throw new Error('host-chain integration invokes PreparationService directly');
      },
    }),
  ]).createSnapshot();
  const runCapabilitySnapshot = createAgentRunCapabilitySnapshot({
    shellPermissionMode: 'full-access',
    shellProviderSnapshot: providerSnapshot,
    skillSnapshot: createAgentSkillRegistry().createRunSnapshot(),
    toolSnapshot,
  });
  const aiDestination = createAgentAiDestinationSnapshot({
    model: 'host-chain-model',
    profileId: PROFILE_ID,
    runtimeConnection: RUNTIME_PROFILE,
  });
  const toolInput = Object.freeze({
    command: options.command || 'opaque-command value',
    cwd: requestedCwd,
    env: Object.freeze({ RUN_LABEL: 'host-chain' }),
    executionContext: 'host' as const,
    timeoutMs: 10_000,
  });
  const preparationIdentity = Object.freeze({
    aiDestinationIdentity: aiDestination.identity,
    callId: 'call-host-chain',
    libraryId: 3,
    ownerScope: OWNER_SCOPE,
    ownerWebContentsId: 17,
    preparedActionId: 'prepared-host-chain',
    runCapabilityIdentity: runCapabilitySnapshot.identity,
    runId: RUN_ID,
    sessionId: SESSION_ID,
    toolInputHash: hashAgentToolInputForPreparation(toolInput),
    toolName: 'shell.run',
    toolRegistrationId: TOOL_REGISTRATION_ID,
    toolRunId: TOOL_RUN_ID,
  });
  const preparationContext: AgentToolMainPreparationContext = Object.freeze({
    aiDestination,
    appContext: {
      libraryId: 3,
      platform: 'darwin' as const,
      selectedNodeIds: [],
    },
    ownerScope: OWNER_SCOPE,
    ownerWebContentsId: 17,
    preparationIdentity,
    runCapabilitySnapshot,
    signal: new AbortController().signal,
  });
  const preparationService = createAgentShellPreparationService({
    additionalPathEntries: [additionalBinPath],
    hostCwd: hostRoot,
    hostEnvironment,
    hostHome: hostRoot,
    workspaceStore: workspaceReader,
  });
  const preparationResult = await preparationService.prepare({
    context: preparationContext,
    input: toolInput,
  });
  if (toolSnapshot.get('shell.run')?.registrationId !== TOOL_REGISTRATION_ID) {
    throw new Error('unexpected shell.run registration identity');
  }
  const sealed = toolSnapshot.sealMainPreparedExecution('shell.run', {
    approvalSemantics: preparationResult.decision,
    binding: preparationResult.binding,
    identity: preparationIdentity,
    publicAction: preparationResult.publicAction,
    snapshotMaterial: preparationResult.snapshotMaterial,
  }, TOOL_REGISTRATION_ID);
  const preparation: AgentToolMainPreparedExecution = Object.freeze({
    binding: preparationResult.binding,
    identity: sealed.identity,
    preparedActionId: sealed.identity.preparedActionId,
    publicAction: sealed.publicAction,
    snapshotHash: sealed.snapshotHash,
  });
  const resolver = createAgentShellBindingResolver({
    additionalPathEntries: [additionalBinPath],
    hostCwd: hostRoot,
    hostEnvironment,
    hostHome: hostRoot,
    providerRegistry,
    resolveRuntimeProfile: profileId => {
      if (profileId !== PROFILE_ID) throw new Error('unexpected AI profile');
      return RUNTIME_PROFILE;
    },
  });
  return {
    additionalBinPath,
    cwdPath,
    fixtureCliPath,
    hostRoot,
    owner: Object.freeze({ ...OWNER_SCOPE, sessionId: SESSION_ID }),
    preparation,
    preparationResult,
    requestedCwd,
    resolver,
    workspaceReader,
    workspaceResolver,
  };
}

async function cleanupHostRoot(root: string): Promise<void> {
  await rm(root, { force: true, recursive: true });
}

describe('Agent Shell macOS host execution chain', () => {
  macOnlyIt('carries an unknown full-access command through preparation, binding, lease and preflight', async () => {
    const fixture = await createHostChainFixture();
    try {
      expect(fixture.preparationResult.decision).toMatchObject({
        behavior: 'allow',
        risk: 'destructive',
      });
      expect(fixture.preparation.publicAction).toMatchObject({
        assessment: {
          facets: expect.arrayContaining(['process_launch', 'unknown_syntax']),
          unresolved: expect.arrayContaining(['unsupported-command']),
        },
        cwd: { kind: 'host', path: fixture.requestedCwd },
        dataScope: { unresolvedWorkspaceRead: true },
      });

      const binding = fixture.preparation.binding as Record<string, unknown>;
      expect(binding).toHaveProperty('host');
      expect(binding).not.toHaveProperty('workspace');
      const effectiveEnvironment = binding.effectiveEnvironment as {
        readonly entries: readonly { readonly name: string; readonly value: string }[];
        readonly executionContext: string;
      };
      const environment = Object.fromEntries(
        effectiveEnvironment.entries.map(entry => [entry.name, entry.value]),
      );
      expect(effectiveEnvironment.executionContext).toBe('host');
      expect(environment).toMatchObject({
        OMNIFLOW_HOST_MARKER: 'inherited-from-main',
        RUN_LABEL: 'host-chain',
      });
      expect(environment).not.toHaveProperty('TEST_API_KEY');
      expect(environment.PATH).toContain(fixture.additionalBinPath);
      expect(environment.PATH).toMatch(/^\/.*inherited-bin:/u);

      await expect(fixture.resolver.resolveCurrentBinding({
        owner: fixture.owner,
        preparation: fixture.preparation,
        signal: new AbortController().signal,
      })).resolves.toMatchObject({
        permissionMode: 'full-access',
        providerExecutionReady: true,
      });

      const leaseManager = createAgentShellExecutionLeaseManager({
        createId: () => 'host-chain-lease',
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        hostPlatform: 'darwin',
        workspaceStore: fixture.workspaceReader,
      });
      const lease = await leaseManager.acquire({
        owner: fixture.owner,
        preparation: fixture.preparation,
        runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
        toolRunId: TOOL_RUN_ID,
      });
      const grant = await leaseManager.consume(lease, fixture.owner);
      expect(grant).toMatchObject({
        executionContext: 'host',
      });
      expect(grant.cwdPath).toBe(await realpath(fixture.cwdPath));

      const preflight = createAgentShellSpawnPreflight({
        bindingResolver: fixture.resolver,
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        observationWindowMs: 0,
        workspaceStore: fixture.workspaceReader,
      });
      await expect(preflight.assertReady({
        grant,
        owner: fixture.owner,
        preparation: fixture.preparation,
        runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
        signal: new AbortController().signal,
        toolRunId: TOOL_RUN_ID,
      })).resolves.toBe(grant);
      expect(fixture.workspaceResolver).not.toHaveBeenCalled();
    } finally {
      await cleanupHostRoot(fixture.hostRoot);
    }
  }, 20_000);

  macOnlyIt('rejects the consumed host grant when the real cwd is replaced before preflight', async () => {
    const fixture = await createHostChainFixture();
    try {
      await fixture.resolver.resolveCurrentBinding({
        owner: fixture.owner,
        preparation: fixture.preparation,
        signal: new AbortController().signal,
      });
      const leaseManager = createAgentShellExecutionLeaseManager({
        createId: () => 'host-chain-replaced-cwd-lease',
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        hostPlatform: 'darwin',
        workspaceStore: fixture.workspaceReader,
      });
      const lease = await leaseManager.acquire({
        owner: fixture.owner,
        preparation: fixture.preparation,
        runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
        toolRunId: TOOL_RUN_ID,
      });
      const grant = await leaseManager.consume(lease, fixture.owner);

      await rename(fixture.cwdPath, `${fixture.cwdPath}-replaced`);
      await mkdir(fixture.cwdPath);

      const preflight = createAgentShellSpawnPreflight({
        bindingResolver: fixture.resolver,
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        observationWindowMs: 0,
        workspaceStore: fixture.workspaceReader,
      });
      await expect(preflight.assertReady({
        grant,
        owner: fixture.owner,
        preparation: fixture.preparation,
        runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
        signal: new AbortController().signal,
        toolRunId: TOOL_RUN_ID,
      })).rejects.toThrow('Agent Shell execution binding 无法确认');
      expect(fixture.workspaceResolver).not.toHaveBeenCalled();
    } finally {
      await cleanupHostRoot(fixture.hostRoot);
    }
  }, 20_000);

  macOnlyIt('executes a PATH-discovered CLI in the canonical host cwd through Runtime and LogStore', async () => {
    const fixture = await createHostChainFixture({ command: FIXTURE_CLI_NAME });
    const logStore = createAgentShellLogStore({
      createId: () => 'host-child-log',
    });
    try {
      expect(fixture.fixtureCliPath).toBe(path.join(
        fixture.additionalBinPath,
        FIXTURE_CLI_NAME,
      ));
      expect((fixture.preparation.binding as {
        readonly invocation: { readonly executable: string };
      }).invocation.executable).toBe('/bin/zsh');
      const leaseManager = createAgentShellExecutionLeaseManager({
        createId: () => 'host-child-lease',
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        hostPlatform: 'darwin',
        workspaceStore: fixture.workspaceReader,
      });
      const preflight = createAgentShellSpawnPreflight({
        bindingResolver: fixture.resolver,
        hostCwd: fixture.hostRoot,
        hostHome: fixture.hostRoot,
        observationWindowMs: 0,
        workspaceStore: fixture.workspaceReader,
      });
      const processSupervisor = createAgentShellProcessSupervisor({
        createId: () => 'host-child-execution',
        platform: 'darwin',
      });
      const runtime = createAgentShellRuntime({
        executionLeaseManager: leaseManager,
        logStore,
        processSupervisor,
        spawnPreflight: preflight,
      });
      const events: AgentShellRuntimeEvent[] = [];

      const result = await runtime.run({
        onEvent: event => events.push(event),
        owner: fixture.owner,
        preparation: fixture.preparation,
        runCapabilityIdentity: fixture.preparation.identity.runCapabilityIdentity,
        signal: new AbortController().signal,
        toolRunId: TOOL_RUN_ID,
      });

      const canonicalCwd = await realpath(fixture.cwdPath);
      const output = result.outputTail.frames.map(frame => frame.text).join('');
      expect(result).toMatchObject({
        exitCode: 0,
        ok: true,
        processStatus: 'completed',
        status: 'completed',
        terminationConfirmed: true,
      });
      expect(output).toBe([
        `cwd=${canonicalCwd}`,
        'host=inherited-from-main',
        'run=host-chain',
        'sensitive=absent',
        '',
      ].join('\n'));
      expect(events.filter(event => event.kind === 'output')
        .flatMap(event => event.frames)
        .map(frame => frame.text)
        .join('')).toBe(output);
      const detailedLog = await logStore.readPage({
        executionId: result.executionId,
        logRef: result.logRef,
        owner: fixture.owner,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        toolRunId: TOOL_RUN_ID,
      });
      expect(detailedLog.frames.map(frame => frame.text).join('')).toBe(output);
      expect(events.at(-1)).toMatchObject({ kind: 'state', state: 'completed' });
      expect(fixture.workspaceResolver).not.toHaveBeenCalled();
      expect(processSupervisor.getActiveCount()).toBe(0);
    } finally {
      await logStore.dispose();
      await cleanupHostRoot(fixture.hostRoot);
    }
  }, 30_000);
});

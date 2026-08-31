import { describe, expect, it, vi } from 'vitest';

import { createAgentAiDestinationSnapshot } from '../agent-ai-destination';
import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import { createAgentShellBindingResolver } from './agent-shell-binding-resolver';
import { createAgentShellCommandHash } from './agent-shell-prepared-action';
import { createAgentShellProviderRegistry } from './agent-shell-provider-registry';
import type { AgentShellWorkspacePreparationContext } from './agent-shell-workspace-store';

const EXECUTABLE_IDENTITY = Object.freeze({ sha256: 'a'.repeat(64), sizeBytes: 128 });

async function fixture() {
  const providerRegistry = createAgentShellProviderRegistry({
    candidates: { darwin: ['/bin/zsh'] },
    platform: 'darwin',
    probeDependencies: {
      accessExecutable: vi.fn(async () => undefined),
      readExecutableIdentity: vi.fn(async () => EXECUTABLE_IDENTITY),
      resolveExecutable: vi.fn(async () => '/bin/zsh'),
      runProbe: vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: 'zsh 5.9' })),
    },
  });
  const providerSnapshot = await providerRegistry.refresh();
  const provider = providerSnapshot.getProviderById('system-zsh');
  if (!provider) throw new Error('test provider missing');
  const workspace: AgentShellWorkspacePreparationContext = Object.freeze({
    generation: 1,
    logicalCwd: 'work',
    owner: Object.freeze({
      accountScope: 'user:7',
      backendScope: 'https://example.com/api',
      sessionId: 'session-1',
    }),
    physicalCwdPath: '/private/agent/workspace/work',
    physicalHomePath: '/private/agent/workspace/home',
    physicalTempPath: '/private/agent/workspace/tmp',
    runId: 'run-1',
    workspaceContentIdentity: `v3:${'b'.repeat(64)}`,
    workspaceContentScannerRevision: 'workspace-content-scanner-v3',
    workspaceEntryCount: 5,
    workspaceId: 'workspace-1',
    workspaceMetadataIdentity: `v2:${'c'.repeat(64)}`,
    workspaceTotalBytes: 0,
  });
  const command = 'pwd';
  const commandHash = createAgentShellCommandHash(command);
  const assessment = Object.freeze({
    facets: Object.freeze(['filesystem.read', 'process_launch'] as const),
    operations: Object.freeze([Object.freeze({
      argvPrefix: Object.freeze([]),
      effects: Object.freeze(['filesystem.read'] as const),
      executable: 'pwd',
    })]),
    persistentRuleEligible: true,
    risk: 'read' as const,
    unresolved: Object.freeze([]),
  });
  const preparation: AgentToolMainPreparedExecution = {
    binding: {
      analysis: {
        permissionMode: 'ask',
      },
      aiDestination: {
        configurationIdentity: `v1:${'d'.repeat(64)}`,
        identity: `v1:${'e'.repeat(64)}`,
        model: 'gpt-test',
        profileId: 'profile-1',
      },
      provider: {
        registrationIdentity: provider.publicIdentity.registrationIdentity,
      },
      workspace,
    },
    identity: {
      aiDestinationIdentity: `v1:${'e'.repeat(64)}`,
      callId: 'call-1',
      libraryId: 3,
      ownerScope: workspace.owner,
      ownerWebContentsId: 1,
      preparedActionId: 'prepared-1',
      runCapabilityIdentity: `v2:${'f'.repeat(64)}`,
      runId: 'run-1',
      sessionId: 'session-1',
      toolInputHash: '1'.repeat(64),
      toolName: 'shell.run',
      toolRegistrationId: 'shell.run@1',
      toolRunId: 'tool-run-1',
    },
    preparedActionId: 'prepared-1',
    publicAction: {
      aiDestination: {
        identityHash: `v1:${'e'.repeat(64)}`,
        profileLabel: 'Test',
        providerType: 'openai',
      },
      assessment,
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
    snapshotHash: '2'.repeat(64),
  };
  const runtimeProfile = {
    apiKey: 'configured-locally',
    baseUrl: 'https://example.com/v1',
    configurationRevision: 'revision-1',
    id: 'profile-1',
    name: 'Test',
    providerType: 'openai' as const,
  };
  const analysis = Object.freeze({
    analysisIdentity: `v1:${'3'.repeat(64)}`,
    analyzerRevision: 'analyzer-v1',
    assessment,
    workspaceBoundaryVerified: true,
  });
  const currentExecutableIdentity = { value: EXECUTABLE_IDENTITY };
  const resolver = createAgentShellBindingResolver({
    commandAnalyzer: { analyze: vi.fn(async () => analysis) },
    probeDependencies: {
      accessExecutable: vi.fn(async () => undefined),
      readExecutableIdentity: vi.fn(async () => currentExecutableIdentity.value),
      resolveExecutable: vi.fn(async () => '/bin/zsh'),
    },
    providerRegistry,
    resolveRuntimeProfile: () => runtimeProfile,
  });
  return {
    currentExecutableIdentity,
    expectedAiDestination: createAgentAiDestinationSnapshot({
      model: 'gpt-test',
      profileId: 'profile-1',
      runtimeConnection: runtimeProfile,
    }),
    preparation,
    providerSnapshot,
    resolver,
  };
}

describe('Agent Shell binding resolver', () => {
  it('re-proves AI, Provider executable, environment, analyzer and policy identities', async () => {
    const input = await fixture();
    const binding = await input.resolver.resolveCurrentBinding({
      owner: input.preparation.binding.workspace as never,
      preparation: input.preparation,
      signal: new AbortController().signal,
    });

    expect(binding).toMatchObject({
      aiDestinationConfigurationIdentity: input.expectedAiDestination.configurationIdentity,
      aiDestinationIdentity: input.expectedAiDestination.identity,
      analysisIdentity: `v1:${'3'.repeat(64)}`,
      analyzerRevision: 'analyzer-v1',
      environmentBindingVersion: 1,
      permissionMode: 'ask',
      providerExecutableSha256: EXECUTABLE_IDENTITY.sha256,
      providerExecutableSizeBytes: EXECUTABLE_IDENTITY.sizeBytes,
      providerExecutionReady: true,
      providerResolvedExecutable: '/bin/zsh',
      providerSnapshotIdentity: input.providerSnapshot.snapshotIdentity,
    });
  });

  it('fails closed when the executable bytes change after Provider probing', async () => {
    const input = await fixture();
    input.currentExecutableIdentity.value = {
      sha256: '9'.repeat(64),
      sizeBytes: EXECUTABLE_IDENTITY.sizeBytes,
    };
    await expect(input.resolver.resolveCurrentBinding({
      owner: input.preparation.binding.workspace as never,
      preparation: input.preparation,
      signal: new AbortController().signal,
    })).rejects.toThrow('executable identity 已变化');
  });

  it('keeps the Run-frozen permission mode when the global setting changes', async () => {
    const input = await fixture();
    (input.preparation.binding.analysis as { permissionMode: string }).permissionMode = 'auto';
    const binding = await input.resolver.resolveCurrentBinding({
      owner: input.preparation.binding.workspace as never,
      preparation: input.preparation,
      signal: new AbortController().signal,
    });
    expect(binding.permissionMode).toBe('auto');
  });
});

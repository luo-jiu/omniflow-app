import { describe, expect, it, vi } from 'vitest';

import type {
  AgentShellProvider,
  AgentShellProviderEncoding,
  AgentShellProviderMainBinding,
  AgentShellProviderPublicIdentity,
  AgentShellProviderRegistrationHandle,
  AgentShellSupportedPlatform,
} from '../../../platform/shell/shell-provider.types';
import {
  normalizeAgentShellPreparedActionPublicV1,
  type AgentShellPreparedActionPublicV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import { createAgentRunCapabilitySnapshot } from '../agent-run-capability-snapshot';
import {
  createAgentToolRegistry,
  type AgentToolMainPreparationContext,
} from '../agent-tool-registry';
import { createAgentSkillRegistry } from '../skills/agent-skill-registry';
import type { AgentShellProviderRegistrySnapshot } from './agent-shell-provider-registry';
import {
  createAgentShellPreparationService,
  type AgentShellPreparationHostEnvironment,
  type AgentShellPreparationWorkspaceReader,
} from './agent-shell-preparation-service';
import type {
  AgentShellWorkspace,
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

const OWNER_SCOPE = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
});
const SESSION_ID = 'session-1';
const RUN_ID = 'run-1';
const WORKSPACE_ID = 'workspace-1';
const AI_DESTINATION = Object.freeze({
  configurationIdentity: `v1:${'b'.repeat(64)}`,
  identity: `v1:${'a'.repeat(64)}`,
  model: 'deepseek-chat',
  profileId: 'profile-local',
  profileLabel: '本地 DeepSeek',
  providerType: 'openai-compatible',
});

interface ProviderFixture {
  binding: AgentShellProviderMainBinding;
  createInvocation: ReturnType<typeof vi.fn<AgentShellProvider['createInvocation']>>;
  getMainBinding: ReturnType<typeof vi.fn<AgentShellProvider['getMainBinding']>>;
  provider: AgentShellProvider;
  registrySnapshot: AgentShellProviderRegistrySnapshot;
}

function providerFixture(input: {
  invocation?: AgentShellProvider['createInvocation'];
  platform?: AgentShellSupportedPlatform;
  resolvedExecutable?: string;
} = {}): ProviderFixture {
  const platform = input.platform || 'darwin';
  const providerId = platform === 'win32' ? 'pwsh' : platform === 'linux'
    ? 'system-bash'
    : 'system-zsh';
  const dialect = platform === 'win32' ? 'powershell' : platform === 'linux' ? 'bash' : 'zsh';
  const fixedArgs = Object.freeze(platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
    : ['-f', '-c']);
  const resolvedExecutable = input.resolvedExecutable || (platform === 'win32'
    ? String.raw`C:\Program Files\PowerShell\7\pwsh.exe`
    : platform === 'linux' ? '/private/providers/bash' : '/private/providers/zsh');
  const encoding: AgentShellProviderEncoding = Object.freeze({
    commandTransport: 'argv-unicode',
    stderrDecoder: 'utf8',
    stdoutDecoder: 'utf8',
  });
  const registrationIdentity = `v1:${(platform === 'win32' ? 'c' : 'd').repeat(64)}`;
  const binding: AgentShellProviderMainBinding = Object.freeze({
    executable: resolvedExecutable,
    executableContentIdentity: Object.freeze({
      sha256: 'e'.repeat(64),
      sizeBytes: 4_096,
    }),
    resolvedExecutable,
  });
  const publicIdentity: AgentShellProviderPublicIdentity = Object.freeze({
    analyzerRevision: `${providerId}-analyzer-v1`,
    dialect,
    encoding,
    encodingRevision: `${providerId}-encoding-v1`,
    environmentRevision: `${providerId}-environment-v1`,
    executionReady: false,
    fixedArgs,
    implementationId: `omniflow.shell.${providerId}.v1`,
    invocationRevision: `${providerId}-invocation-v1`,
    platform,
    probeGeneration: 3,
    probeIdentity: `v1:${'f'.repeat(64)}`,
    providerId,
    registrationIdentity,
    terminationRevision: `${providerId}-termination-v1`,
    version: platform === 'win32' ? '7.4.6' : '5.9',
  });
  const getMainBinding = vi.fn<AgentShellProvider['getMainBinding']>(() => binding);
  const defaultInvocation: AgentShellProvider['createInvocation'] = command => Object.freeze({
    argv: Object.freeze([...fixedArgs, command]),
    executable: resolvedExecutable,
    shell: false,
  });
  const createInvocation = vi.fn<AgentShellProvider['createInvocation']>(
    input.invocation || defaultInvocation,
  );
  const provider: AgentShellProvider = Object.freeze({
    createInvocation,
    getMainBinding,
    publicIdentity,
    registrationHandle: Object.freeze({}) as AgentShellProviderRegistrationHandle,
  });
  const registrySnapshot: AgentShellProviderRegistrySnapshot = Object.freeze({
    defaultProviderId: providerId,
    defaultProviderRegistrationIdentity: registrationIdentity,
    failures: Object.freeze([]),
    getProvider: (identity: string) => identity === registrationIdentity ? provider : undefined,
    getProviderById: (id: string) => id === providerId ? provider : undefined,
    platform,
    probeGeneration: 3,
    providers: Object.freeze([publicIdentity]),
    snapshotIdentity: `v1:${'9'.repeat(64)}`,
  });
  return { binding, createInvocation, getMainBinding, provider, registrySnapshot };
}

function runCapabilitySnapshot(provider?: ProviderFixture) {
  return createAgentRunCapabilitySnapshot({
    ...(provider ? { shellProviderSnapshot: provider.registrySnapshot } : {}),
    skillSnapshot: createAgentSkillRegistry().createRunSnapshot(),
    toolSnapshot: createAgentToolRegistry([]).createSnapshot(),
  });
}

interface WorkspaceFixture {
  get: ReturnType<typeof vi.fn<AgentShellPreparationWorkspaceReader['get']>>;
  owner: AgentShellWorkspaceOwner;
  prepared: AgentShellWorkspacePreparationContext;
  resolvePreparationContext: ReturnType<
    typeof vi.fn<AgentShellPreparationWorkspaceReader['resolvePreparationContext']>
  >;
  store: AgentShellPreparationWorkspaceReader;
  workspace: AgentShellWorkspace;
}

function workspaceFixture(platform: AgentShellSupportedPlatform = 'darwin'): WorkspaceFixture {
  const owner: AgentShellWorkspaceOwner = {
    ...OWNER_SCOPE,
    sessionId: SESSION_ID,
  };
  const workspace: AgentShellWorkspace = {
    generation: 1,
    logicalRoots: ['input', 'work', 'output', 'tmp', 'home'],
    manifest: {
      entries: [],
      generation: 1,
      provenance: [],
      workspaceId: WORKSPACE_ID,
    },
    owner,
    runId: RUN_ID,
    workspaceId: WORKSPACE_ID,
  };
  const root = platform === 'win32'
    ? String.raw`C:\OmniFlow\agent\workspace-1`
    : '/managed/omniflow/agent/workspace-1';
  const separator = platform === 'win32' ? '\\' : '/';
  const prepared: AgentShellWorkspacePreparationContext = Object.freeze({
    generation: 1,
    logicalCwd: 'work',
    physicalCwdPath: `${root}${separator}work`,
    physicalHomePath: `${root}${separator}home`,
    physicalTempPath: `${root}${separator}tmp`,
    runId: RUN_ID,
    workspaceId: WORKSPACE_ID,
    workspaceMetadataIdentity: `v1:${'8'.repeat(64)}`,
  });
  const get = vi.fn<AgentShellPreparationWorkspaceReader['get']>(() => workspace);
  const resolvePreparationContext = vi.fn<
    AgentShellPreparationWorkspaceReader['resolvePreparationContext']
  >(async (_workspaceId, logicalCwd) => Object.freeze({
    ...prepared,
    logicalCwd,
  }));
  return {
    get,
    owner,
    prepared,
    resolvePreparationContext,
    store: { get, resolvePreparationContext },
    workspace,
  };
}

function preparationContext(
  snapshot: ReturnType<typeof runCapabilitySnapshot>,
  platform: AgentShellSupportedPlatform = 'darwin',
  signal: AbortSignal = new AbortController().signal,
): AgentToolMainPreparationContext {
  return {
    aiDestination: AI_DESTINATION,
    appContext: { libraryId: 3, platform, selectedNodeIds: [] },
    ownerScope: OWNER_SCOPE,
    ownerWebContentsId: 17,
    preparationIdentity: {
      aiDestinationIdentity: AI_DESTINATION.identity,
      callId: 'call-1',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      ownerWebContentsId: 17,
      preparedActionId: 'prepared-1',
      runCapabilityIdentity: snapshot.identity,
      runId: RUN_ID,
      sessionId: SESSION_ID,
      toolInputHash: 'input-hash',
      toolName: 'shell.run',
      toolRegistrationId: 'omniflow.shell.run.v1',
      toolRunId: 'tool-run-1',
    },
    runCapabilitySnapshot: snapshot,
    signal,
  };
}

function prepareRequest(
  context: AgentToolMainPreparationContext,
  overrides: {
    input?: unknown;
    requestedAction?: AgentShellPreparedActionPublicV1;
  } = {},
) {
  return {
    context,
    input: overrides.input || {
      command: 'printf "hello\\n"',
      cwd: 'work',
      env: { MODE: 'test' },
      timeoutMs: 12_000,
    },
    ...(overrides.requestedAction ? { requestedAction: overrides.requestedAction } : {}),
    workspaceId: WORKSPACE_ID,
  };
}

function environmentFromBinding(binding: Readonly<Record<string, unknown>>) {
  return binding.effectiveEnvironment as {
    entries: readonly { name: string; value: string }[];
    identity: string;
    pathHash: string;
    policyRevision: string;
    providerPolicyRevision: string;
    servicePolicyRevision: string;
  };
}

describe('Agent Shell PreparationService', () => {
  it('freezes a conservative macOS action from the Run Provider and workspace snapshot', async () => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({
      additionalPathEntries: ['/custom/bin', '/usr/bin'],
      workspaceStore: workspace.store,
    });

    const result = await service.prepare(prepareRequest(preparationContext(snapshot)));
    const action = normalizeAgentShellPreparedActionPublicV1(result.publicAction);
    const environment = environmentFromBinding(result.binding);

    expect(action).toMatchObject({
      aiDestination: {
        identityHash: AI_DESTINATION.identity,
        profileLabel: AI_DESTINATION.profileLabel,
        providerType: AI_DESTINATION.providerType,
      },
      assessment: {
        facets: ['unknown_syntax', 'environment_change'],
        operations: [],
        persistentRuleEligible: false,
        risk: 'destructive',
        unresolved: ['ast-analysis-unavailable'],
      },
      command: 'printf "hello\\n"',
      cwd: { kind: 'run-workspace', path: 'work' },
      dataScope: { stagedInputs: [], unresolvedWorkspaceRead: true },
      environment: [{ name: 'MODE', value: 'test' }],
      provider: { dialect: 'zsh', id: 'system-zsh', version: '5.9' },
      timeoutMs: 12_000,
    });
    expect(action.commandHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.decision).toMatchObject({ behavior: 'ask', risk: 'destructive' });
    expect(result.decision.behavior === 'ask' && result.decision.preview.details)
      .toContainEqual({ label: '环境变量 MODE', value: 'test' });
    expect(Object.fromEntries(environment.entries.map(entry => [entry.name, entry.value])))
      .toEqual({
      HOME: workspace.prepared.physicalHomePath,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      MODE: 'test',
      PATH: '/private/providers:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/custom/bin',
      TEMP: workspace.prepared.physicalTempPath,
      TMP: workspace.prepared.physicalTempPath,
      TMPDIR: workspace.prepared.physicalTempPath,
    });
    expect(environment).toMatchObject({
      identity: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      pathHash: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      policyRevision: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
      providerPolicyRevision: 'system-zsh-environment-v1',
      servicePolicyRevision: 'shell-environment-policy-v1',
    });
    expect(result.binding).toMatchObject({
      aiDestination: AI_DESTINATION,
      analysis: {
        analyzerRevision: 'system-zsh-analyzer-v1',
        fallbackAnalyzerRevision: 'shell-analysis-unavailable-v1',
        immutableDenyRevision: 'shell-immutable-deny-pending-v1',
        policyRevision: 'shell-conservative-ask-policy-v1',
      },
      invocation: {
        argv: ['-f', '-c', 'printf "hello\\n"'],
        executable: '/private/providers/zsh',
        shell: false,
      },
      workspace: workspace.prepared,
    });
    expect(result.snapshotMaterial).toMatchObject({
      providerSnapshotIdentity: provider.registrySnapshot.snapshotIdentity,
      workspaceGeneration: 1,
      workspaceMetadataIdentity: workspace.prepared.workspaceMetadataIdentity,
    });
    expect(provider.getMainBinding).toHaveBeenCalledTimes(1);
    expect(provider.createInvocation).toHaveBeenCalledWith('printf "hello\\n"');
    expect(workspace.resolvePreparationContext).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'work',
      RUN_ID,
      workspace.owner,
    );
    expect(JSON.stringify({ action, decision: result.decision }))
      .not.toContain('/managed/omniflow');
    expect(Object.isFrozen(result.binding)).toBe(true);
    expect(Object.isFrozen(environment.entries)).toBe(true);
  });

  it('builds a case-insensitive, local-drive-only Windows environment without enumerating host env', async () => {
    const provider = providerFixture({ platform: 'win32' });
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture('win32');
    const hostEnvironment = new Proxy({
      SECRET_SENTINEL: 'must-not-be-read',
      systemroot: String.raw`C:\Windows`,
      windir: String.raw`c:\windows`,
    } as AgentShellPreparationHostEnvironment, {
      ownKeys: () => {
        throw new Error('host environment must not be enumerated');
      },
    });
    const service = createAgentShellPreparationService({
      additionalPathEntries: [String.raw`c:\windows\system32`, String.raw`D:\Tools`],
      hostEnvironment,
      workspaceStore: workspace.store,
    });

    const result = await service.prepare(prepareRequest(
      preparationContext(snapshot, 'win32'),
      { input: { command: 'Get-ChildItem', env: { MODE: 'test' } } },
    ));
    const environment = Object.fromEntries(
      environmentFromBinding(result.binding).entries.map(entry => [entry.name, entry.value]),
    );

    expect(environment).toEqual({
      HOME: workspace.prepared.physicalHomePath,
      MODE: 'test',
      PATH: String.raw`C:\Program Files\PowerShell\7;C:\Windows;C:\Windows\System32;C:\Windows\System32\Wbem;C:\Windows\System32\WindowsPowerShell\v1.0;D:\Tools`,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      POWERSHELL_TELEMETRY_OPTOUT: '1',
      SystemRoot: String.raw`C:\Windows`,
      TEMP: workspace.prepared.physicalTempPath,
      TMP: workspace.prepared.physicalTempPath,
      USERPROFILE: workspace.prepared.physicalHomePath,
      WINDIR: String.raw`C:\Windows`,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-be-read');
  });

  it.each([
    { hostEnvironment: {}, label: 'missing SystemRoot' },
    {
      hostEnvironment: {
        SystemRoot: String.raw`C:\Windows`,
        WINDIR: String.raw`D:\Windows`,
      },
      label: 'conflicting SystemRoot aliases',
    },
    { hostEnvironment: { SystemRoot: String.raw`\Windows` }, label: 'root-relative SystemRoot' },
    {
      hostEnvironment: { SystemRoot: String.raw`\\server\share\Windows` },
      label: 'UNC SystemRoot',
    },
    {
      hostEnvironment: { SystemRoot: String.raw`C:\Windows|invalid` },
      label: 'invalid-character SystemRoot',
    },
  ])('fails closed for $label', async ({ hostEnvironment }) => {
    const provider = providerFixture({ platform: 'win32' });
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture('win32');
    const service = createAgentShellPreparationService({
      hostEnvironment,
      workspaceStore: workspace.store,
    });

    await expect(service.prepare(prepareRequest(preparationContext(snapshot, 'win32'))))
      .rejects.toThrow(/SystemRoot|PATH/u);
  });

  it('re-prepares only editable requested-action fields and recomputes all authoritative fields', async () => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });
    const context = preparationContext(snapshot);
    const first = normalizeAgentShellPreparedActionPublicV1(
      (await service.prepare(prepareRequest(context))).publicAction,
    );
    const requestedAction: AgentShellPreparedActionPublicV1 = {
      ...first,
      aiDestination: {
        identityHash: `v1:${'7'.repeat(64)}`,
        profileLabel: 'forged destination',
        providerType: 'forged-provider',
      },
      assessment: {
        facets: ['filesystem.read'],
        operations: [{
          argvPrefix: ['status'],
          effects: ['filesystem.read'],
          executable: 'git',
        }],
        persistentRuleEligible: true,
        risk: 'read',
        unresolved: [],
      },
      command: 'git status',
      commandHash: `sha256:${'0'.repeat(64)}`,
      cwd: { kind: 'run-workspace', path: 'output' },
      dataScope: {
        stagedInputs: [{
          contentHash: `sha256:${'6'.repeat(64)}`,
          displayName: 'forged.txt',
          logicalPath: 'input/forged.txt',
          sourceKind: 'library',
        }],
        unresolvedWorkspaceRead: false,
      },
      environment: [{ name: 'MODE', value: 'edited' }],
      provider: { ...first.provider, version: 'forged-version' },
      timeoutMs: 45_000,
    };

    const prepared = await service.prepare(prepareRequest(context, {
      input: { command: 'ignored but valid' },
      requestedAction,
    }));
    const action = normalizeAgentShellPreparedActionPublicV1(prepared.publicAction);

    expect(action).toMatchObject({
      aiDestination: {
        identityHash: AI_DESTINATION.identity,
        profileLabel: AI_DESTINATION.profileLabel,
        providerType: AI_DESTINATION.providerType,
      },
      assessment: {
        facets: ['unknown_syntax', 'environment_change'],
        operations: [],
        persistentRuleEligible: false,
        risk: 'destructive',
      },
      command: 'git status',
      cwd: { path: 'output' },
      dataScope: { stagedInputs: [], unresolvedWorkspaceRead: true },
      environment: [{ name: 'MODE', value: 'edited' }],
      provider: { id: 'system-zsh', version: '5.9' },
      timeoutMs: 45_000,
    });
    expect(action.commandHash).not.toBe(requestedAction.commandHash);
    expect(provider.createInvocation).toHaveBeenLastCalledWith('git status');
    expect(workspace.resolvePreparationContext).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      'output',
      RUN_ID,
      workspace.owner,
    );
  });

  it.each([
    {
      label: 'owner scope',
      mutate: (context: AgentToolMainPreparationContext) => ({
        ...context,
        ownerScope: { ...context.ownerScope, accountScope: 'user:other' },
      }),
    },
    {
      label: 'window owner',
      mutate: (context: AgentToolMainPreparationContext) => ({
        ...context,
        ownerWebContentsId: context.ownerWebContentsId + 1,
      }),
    },
    {
      label: 'library',
      mutate: (context: AgentToolMainPreparationContext) => ({
        ...context,
        appContext: { ...context.appContext, libraryId: 4 },
      }),
    },
  ])('rejects a mixed $label context before workspace access', async ({ mutate }) => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });
    const context = mutate(preparationContext(snapshot));

    await expect(service.prepare(prepareRequest(context))).rejects.toThrow('owner binding');
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();
  });

  it('rejects mismatched Run and AI destination identities before workspace access', async () => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });
    const base = preparationContext(snapshot);

    await expect(service.prepare(prepareRequest({
      ...base,
      preparationIdentity: {
        ...base.preparationIdentity,
        runCapabilityIdentity: `v2:${'1'.repeat(64)}`,
      },
    }))).rejects.toThrow('Run capability snapshot');
    await expect(service.prepare(prepareRequest({
      ...base,
      aiDestination: { ...base.aiDestination, identity: `v1:${'2'.repeat(64)}` },
    }))).rejects.toThrow('AI 目的地 binding');
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();
  });

  it('uses only Providers frozen into the Run and rejects platform or registration drift', async () => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });

    await expect(service.prepare(prepareRequest(
      preparationContext(snapshot),
      { input: { command: 'pwd', providerId: 'later-provider' } },
    ))).rejects.toThrow('不属于当前 Run');
    await expect(service.prepare(prepareRequest(
      preparationContext(snapshot, 'win32'),
      { input: { command: 'pwd' } },
    ))).rejects.toThrow('当前平台不匹配');
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();
  });

  it('fails closed when a Provider returns an invocation different from its frozen identity', async () => {
    const provider = providerFixture({
      invocation: command => ({
        argv: ['-c', command],
        executable: '/tmp/replaced-zsh',
        shell: false,
      }),
    });
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });

    await expect(service.prepare(prepareRequest(preparationContext(snapshot))))
      .rejects.toThrow('Provider execution binding 无法确认');
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();
  });

  it('maps raw Provider and workspace adapter errors to stable path-free messages', async () => {
    const raw = '/Users/private/workspace Authorization: Bearer private-token';
    const provider = providerFixture({
      invocation: () => {
        throw new Error(raw);
      },
    });
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });

    await expect(service.prepare(prepareRequest(preparationContext(snapshot))))
      .rejects.toThrow('Provider execution binding 无法确认');

    const healthyProvider = providerFixture();
    const healthySnapshot = runCapabilitySnapshot(healthyProvider);
    workspace.resolvePreparationContext.mockRejectedValueOnce(new Error(raw));
    await expect(createAgentShellPreparationService({ workspaceStore: workspace.store }).prepare(
      prepareRequest(preparationContext(healthySnapshot)),
    )).rejects.toThrow('workspace binding 无法确认');
  });

  it.each([
    { field: 'generation', mutate: (workspace: AgentShellWorkspace) => { workspace.generation = 2; } },
    {
      field: 'manifest generation',
      mutate: (workspace: AgentShellWorkspace) => { workspace.manifest.generation = 2; },
    },
    {
      field: 'owner',
      mutate: (workspace: AgentShellWorkspace) => {
        workspace.owner = { ...workspace.owner, accountScope: 'user:other' };
      },
    },
  ])('rejects $field drift between workspace resolve and seal', async ({ mutate }) => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    workspace.resolvePreparationContext.mockImplementationOnce(async () => {
      mutate(workspace.workspace);
      return workspace.prepared;
    });
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });

    await expect(service.prepare(prepareRequest(preparationContext(snapshot))))
      .rejects.toThrow('workspace binding 无法确认');
  });

  it('honors cancellation before and immediately after asynchronous workspace resolution', async () => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(service.prepare(prepareRequest(
      preparationContext(snapshot, 'darwin', preAborted.signal),
    ))).rejects.toMatchObject({ name: 'AbortError' });
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();

    const duringResolve = new AbortController();
    workspace.resolvePreparationContext.mockImplementationOnce(async () => {
      duringResolve.abort();
      return workspace.prepared;
    });
    await expect(service.prepare(prepareRequest(
      preparationContext(snapshot, 'darwin', duringResolve.signal),
    ))).rejects.toMatchObject({ name: 'AbortError' });
    expect(workspace.get).not.toHaveBeenCalled();
  });

  it.each([
    {
      input: { command: 'echo Authorization: Bearer private-token' },
      message: 'command 包含敏感信息',
    },
    {
      input: { command: 'echo ok', env: { MODE: 'password=private-value' } },
      message: '环境变量包含敏感信息',
    },
    {
      input: { command: 'echo ok', env: { JAVA_TOOL_OPTIONS: '-javaagent:evil.jar' } },
      message: '环境变量禁止覆盖',
    },
    {
      input: { command: 'echo ok', env: { GIT_CONFIG_COUNT: '1' } },
      message: '环境变量禁止覆盖',
    },
  ])('rejects sensitive or hidden-control input without workspace access', async ({ input, message }) => {
    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    const workspace = workspaceFixture();
    const service = createAgentShellPreparationService({ workspaceStore: workspace.store });

    await expect(service.prepare(prepareRequest(preparationContext(snapshot), { input })))
      .rejects.toThrow(message);
    expect(workspace.resolvePreparationContext).not.toHaveBeenCalled();
  });

  it('rejects a Run with no Provider and invalid main-owned PATH entries', async () => {
    const workspace = workspaceFixture();
    const noProviderSnapshot = runCapabilitySnapshot();
    await expect(createAgentShellPreparationService({ workspaceStore: workspace.store }).prepare(
      prepareRequest(preparationContext(noProviderSnapshot)),
    )).rejects.toThrow('没有可用 Provider');

    const provider = providerFixture();
    const snapshot = runCapabilitySnapshot(provider);
    await expect(createAgentShellPreparationService({
      additionalPathEntries: ['relative/bin'],
      workspaceStore: workspace.store,
    }).prepare(prepareRequest(preparationContext(snapshot))))
      .rejects.toThrow('PATH 条目无效');

    await expect(createAgentShellPreparationService({
      additionalPathEntries: ['/safe:/injected'],
      workspaceStore: workspace.store,
    }).prepare(prepareRequest(preparationContext(snapshot))))
      .rejects.toThrow('PATH 条目无效');

    const windowsProvider = providerFixture({ platform: 'win32' });
    const windowsSnapshot = runCapabilitySnapshot(windowsProvider);
    const windowsWorkspace = workspaceFixture('win32');
    await expect(createAgentShellPreparationService({
      additionalPathEntries: [String.raw`C:\Safe;D:\Injected`],
      hostEnvironment: { SystemRoot: String.raw`C:\Windows` },
      workspaceStore: windowsWorkspace.store,
    }).prepare(prepareRequest(preparationContext(windowsSnapshot, 'win32'))))
      .rejects.toThrow('PATH 条目无效');
  });
});

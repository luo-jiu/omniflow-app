import crypto from 'node:crypto';
import path from 'node:path';

import type { AgentPreparedActionPublic } from '../../../../src/shared/agent/agent.types';
import {
  AGENT_SHELL_RUN_TOOL_NAME,
  normalizeAgentShellPreparedActionPublicV1,
  normalizeAgentShellRunInputV1,
  type AgentShellPreparedActionPublicV1,
  type AgentShellRunInputV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import { containsAgentSensitiveData } from '../agent-sensitive-data';
import type {
  AgentToolMainPreparationContext,
  AgentToolMainPreparationResult,
  AgentToolPermissionDecision,
} from '../agent-tool-registry';
import type {
  AgentShellProvider,
  AgentShellProviderMainBinding,
} from '../../../platform/shell/shell-provider.types';
import {
  sealAgentShellPreparedActionPublicV1,
} from './agent-shell-prepared-action';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
  AgentShellWorkspaceStore,
} from './agent-shell-workspace-store';
import {
  AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION,
  AGENT_SHELL_WORKSPACE_PERSISTENT_RULE_IDENTITY_READY,
} from './agent-shell-workspace-content-scanner';
import {
  AGENT_SHELL_IMMUTABLE_DENY_REVISION,
  AGENT_SHELL_POLICY_REVISION,
  createAgentShellPolicyEngine,
  type AgentShellPolicyDecision,
} from './agent-shell-policy-engine';
import {
  createAgentShellCommandAnalyzer,
  type AgentShellCommandAnalysis,
  type AgentShellCommandAnalyzer,
} from './agent-shell-command-analyzer';

export const AGENT_SHELL_ENVIRONMENT_BINDING_VERSION = 1 as const;
export const AGENT_SHELL_ENVIRONMENT_POLICY_REVISION = 'shell-environment-policy-v1';
export const AGENT_SHELL_FALLBACK_ANALYZER_REVISION = 'shell-analysis-unavailable-v1';
const MAX_AI_DESTINATION_LABEL_BYTES = 512;
const MAX_AI_MODEL_BYTES = 512;
const MAX_AI_PROFILE_ID_BYTES = 256;
const MAX_AI_PROVIDER_TYPE_BYTES = 128;
const MAX_PATH_ENTRIES = 32;
const MAX_PATH_ENTRY_BYTES = 2_048;
const VERSIONED_IDENTITY_PATTERN = /^v[1-9]\d*:[a-f0-9]{64}$/u;

export interface AgentShellPreparationRequest {
  readonly context: AgentToolMainPreparationContext;
  readonly input: unknown;
  readonly requestedAction?: AgentPreparedActionPublic;
  readonly workspaceId: string;
}

export interface AgentShellPreparationWorkspaceReader {
  readonly resolvePreparationContext: AgentShellWorkspaceStore['resolvePreparationContext'];
}

export interface CreateAgentShellPreparationServiceOptions {
  readonly additionalPathEntries?: readonly string[];
  readonly commandAnalyzer?: Pick<AgentShellCommandAnalyzer, 'analyze'>;
  readonly hostEnvironment?: AgentShellPreparationHostEnvironment;
  readonly workspaceStore: AgentShellPreparationWorkspaceReader;
}

export interface AgentShellPreparationHostEnvironment {
  readonly [name: string]: string | undefined;
  readonly SYSTEMROOT?: string;
  readonly SystemRoot?: string;
  readonly WINDIR?: string;
  readonly systemroot?: string;
  readonly windir?: string;
}

export interface AgentShellEffectiveEnvironment {
  readonly entries: readonly { name: string; value: string }[];
  readonly identity: string;
  readonly pathHash: string;
  readonly providerPolicyRevision: string;
  readonly policyRevision: string;
  readonly servicePolicyRevision: string;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedMainText(input: unknown, label: string, maximumBytes: number): string {
  const value = String(input ?? '').trim();
  if (
    !value
    || utf8Length(value) > maximumBytes
    || value.includes('\0')
    || containsAgentSensitiveData(value)
  ) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function boundedMainIdentity(input: unknown, label: string): string {
  const value = boundedMainText(input, label, 80);
  if (!VERSIONED_IDENTITY_PATTERN.test(value)) throw new Error(`${label}无效`);
  return value;
}

function hashIdentity(domain: string, value: unknown): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    domain,
    value,
  ])).digest('hex');
  return `v1:${digest}`;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Agent Shell preparation 已取消');
  error.name = 'AbortError';
  throw error;
}

function captureHostEnvironment(
  source: AgentShellPreparationHostEnvironment,
): AgentShellPreparationHostEnvironment {
  const systemRoot = source.SystemRoot ?? source.SYSTEMROOT ?? source.systemroot;
  const windir = source.WINDIR ?? source.windir;
  return Object.freeze({
    ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }),
    ...(windir === undefined ? {} : { WINDIR: windir }),
  });
}

function sameOwner(
  left: Pick<AgentShellWorkspaceOwner, 'accountScope' | 'backendScope' | 'sessionId'>,
  right: Pick<AgentShellWorkspaceOwner, 'accountScope' | 'backendScope' | 'sessionId'>,
): boolean {
  return left.accountScope === right.accountScope
    && left.backendScope === right.backendScope
    && left.sessionId === right.sessionId;
}

function sameOwnerScope(
  left: Pick<AgentShellWorkspaceOwner, 'accountScope' | 'backendScope'>,
  right: Pick<AgentShellWorkspaceOwner, 'accountScope' | 'backendScope'>,
): boolean {
  return left.accountScope === right.accountScope
    && left.backendScope === right.backendScope;
}

export function freezeAgentShellProviderInvocation(
  provider: AgentShellProvider,
  providerBinding: AgentShellProviderMainBinding,
  command: string,
) {
  const invocation = provider.createInvocation(command);
  const fixedArgs = provider.publicIdentity.fixedArgs;
  if (
    invocation.shell !== false
    || invocation.executable !== providerBinding.resolvedExecutable
    || !Array.isArray(invocation.argv)
    || invocation.argv.length !== fixedArgs.length + 1
    || invocation.argv.some(argument => typeof argument !== 'string' || argument.includes('\0'))
    || fixedArgs.some((argument, index) => invocation.argv[index] !== argument)
    || invocation.argv.at(-1) !== command
  ) {
    throw new Error('Agent Shell Provider invocation 与冻结身份不匹配');
  }
  return Object.freeze({
    argv: Object.freeze([...invocation.argv]),
    executable: invocation.executable,
    shell: false as const,
  });
}

function requestedInput(
  input: AgentShellRunInputV1,
  requestedAction: AgentPreparedActionPublic | undefined,
): AgentShellRunInputV1 {
  if (!requestedAction) return input;
  const requested = normalizeAgentShellPreparedActionPublicV1(requestedAction);
  const environment = Object.create(null) as Record<string, string>;
  for (const entry of requested.environment) environment[entry.name] = entry.value;
  return normalizeAgentShellRunInputV1({
    command: requested.command,
    cwd: requested.cwd.path,
    env: environment,
    providerId: requested.provider.id,
    timeoutMs: requested.timeoutMs,
  });
}

function assertNoSensitiveShellInput(input: AgentShellRunInputV1): void {
  if (containsAgentSensitiveData(input.command)) {
    throw new Error('Agent Shell command 包含敏感信息');
  }
  for (const value of Object.values(input.env)) {
    if (containsAgentSensitiveData(value)) {
      throw new Error('Agent Shell 环境变量包含敏感信息');
    }
  }
}

function absolutePathEntry(
  input: unknown,
  platform: 'darwin' | 'linux' | 'win32',
): string {
  const value = String(input ?? '').trim();
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const invalidWindowsPath = platform === 'win32' && (
    !/^[A-Za-z]:[\\/]/u.test(value)
    || /[<>:"|?*]/u.test(value.slice(2))
  );
  if (
    !value
    || value.includes('\0')
    || value.includes(pathDelimiter)
    || utf8Length(value) > MAX_PATH_ENTRY_BYTES
    || !pathApi.isAbsolute(value)
    || invalidWindowsPath
  ) {
    throw new Error('Agent Shell PATH 条目无效');
  }
  return pathApi.normalize(value);
}

function resolveWindowsSystemRoot(
  hostEnvironment: AgentShellPreparationHostEnvironment,
): string {
  const candidates = [hostEnvironment.SystemRoot, hostEnvironment.WINDIR]
    .filter((value): value is string => value !== undefined)
    .map(value => absolutePathEntry(value, 'win32'));
  if (candidates.length === 0) throw new Error('Agent Shell Windows SystemRoot 缺失');
  const distinct = new Set(candidates.map(value => value.toLowerCase()));
  if (distinct.size !== 1) throw new Error('Agent Shell Windows SystemRoot 不一致');
  return candidates[0];
}

function buildPathEntries(
  provider: AgentShellProvider,
  providerBinding: AgentShellProviderMainBinding,
  additionalPathEntries: readonly string[],
  windowsSystemRoot?: string,
): readonly string[] {
  const identity = provider.publicIdentity;
  const pathApi = identity.platform === 'win32' ? path.win32 : path.posix;
  const providerDirectory = pathApi.dirname(providerBinding.resolvedExecutable);
  const candidates = identity.platform === 'win32'
    ? [
        providerDirectory,
        windowsSystemRoot!,
        path.win32.join(windowsSystemRoot!, 'System32'),
        path.win32.join(windowsSystemRoot!, 'System32', 'Wbem'),
        path.win32.join(windowsSystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0'),
        ...additionalPathEntries,
      ]
    : [
        providerDirectory,
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        ...(identity.platform === 'darwin' ? ['/opt/homebrew/bin'] : []),
        ...additionalPathEntries,
      ];
  if (candidates.length > MAX_PATH_ENTRIES) throw new Error('Agent Shell PATH 条目过多');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const value = absolutePathEntry(candidate, identity.platform);
    const key = identity.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return Object.freeze(result);
}

export function buildAgentShellEffectiveEnvironment(input: {
  additionalPathEntries: readonly string[];
  hostEnvironment: AgentShellPreparationHostEnvironment;
  overrides: Readonly<Record<string, string>>;
  provider: AgentShellProvider;
  providerBinding: AgentShellProviderMainBinding;
  workspace: AgentShellWorkspacePreparationContext;
}): AgentShellEffectiveEnvironment {
  const providerIdentity = input.provider.publicIdentity;
  const separator = providerIdentity.platform === 'win32' ? ';' : ':';
  const windowsSystemRoot = providerIdentity.platform === 'win32'
    ? resolveWindowsSystemRoot(input.hostEnvironment)
    : undefined;
  const pathValue = buildPathEntries(
    input.provider,
    input.providerBinding,
    input.additionalPathEntries,
    windowsSystemRoot,
  ).join(separator);
  const environment: Record<string, string> = providerIdentity.platform === 'win32'
    ? {
        HOME: input.workspace.physicalHomePath,
        PATH: pathValue,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        POWERSHELL_TELEMETRY_OPTOUT: '1',
        TEMP: input.workspace.physicalTempPath,
        TMP: input.workspace.physicalTempPath,
        USERPROFILE: input.workspace.physicalHomePath,
      }
    : {
        HOME: input.workspace.physicalHomePath,
        LANG: providerIdentity.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
        LC_ALL: providerIdentity.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
        PATH: pathValue,
        TEMP: input.workspace.physicalTempPath,
        TMP: input.workspace.physicalTempPath,
        TMPDIR: input.workspace.physicalTempPath,
      };
  if (providerIdentity.platform === 'win32') {
    environment.SystemRoot = windowsSystemRoot!;
    environment.WINDIR = windowsSystemRoot!;
  }
  for (const [name, value] of Object.entries(input.overrides)) environment[name] = value;
  const entries = Object.freeze(Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => Object.freeze({ name, value })));
  const policyRevision = hashIdentity('omniflow.agent.shell.environment-policy-v1', {
    providerPolicyRevision: providerIdentity.environmentRevision,
    servicePolicyRevision: AGENT_SHELL_ENVIRONMENT_POLICY_REVISION,
  });
  return Object.freeze({
    entries,
    identity: hashIdentity('omniflow.agent.shell.environment-v1', {
      entries,
      policyRevision,
    }),
    pathHash: hashIdentity('omniflow.agent.shell.path-v1', pathValue),
    policyRevision,
    providerPolicyRevision: providerIdentity.environmentRevision,
    servicePolicyRevision: AGENT_SHELL_ENVIRONMENT_POLICY_REVISION,
  });
}

function assertWorkspaceBinding(
  preparedWorkspace: AgentShellWorkspacePreparationContext,
  expectedOwner: AgentShellWorkspaceOwner,
  expectedRunId: string,
  expectedWorkspaceId: string,
): AgentShellWorkspacePreparationContext {
  if (
    preparedWorkspace.runId !== expectedRunId
    || preparedWorkspace.workspaceId !== expectedWorkspaceId
    || !Number.isSafeInteger(preparedWorkspace.generation)
    || preparedWorkspace.generation < 1
    || !sameOwner(preparedWorkspace.owner, expectedOwner)
    || !Number.isSafeInteger(preparedWorkspace.workspaceEntryCount)
    || preparedWorkspace.workspaceEntryCount < 5
    || !Number.isSafeInteger(preparedWorkspace.workspaceTotalBytes)
    || preparedWorkspace.workspaceTotalBytes < 0
    || preparedWorkspace.workspaceContentScannerRevision
      !== AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION
  ) {
    throw new Error('Agent Shell workspace binding 已变化');
  }
  const contentIdentity = boundedMainIdentity(
    preparedWorkspace.workspaceContentIdentity,
    'Agent Shell workspace content identity',
  );
  const metadataIdentity = boundedMainIdentity(
    preparedWorkspace.workspaceMetadataIdentity,
    'Agent Shell workspace metadata identity',
  );
  if (
    contentIdentity !== preparedWorkspace.workspaceContentIdentity
    || metadataIdentity !== preparedWorkspace.workspaceMetadataIdentity
    || !/^v3:[a-f0-9]{64}$/u.test(contentIdentity)
    || !/^v2:[a-f0-9]{64}$/u.test(metadataIdentity)
  ) {
    throw new Error('Agent Shell workspace binding 已变化');
  }
  return preparedWorkspace;
}

export function createAgentShellConservativeAnalysis(
  hasEnvironmentOverrides: boolean,
): AgentShellCommandAnalysis {
  return Object.freeze({
    analysisIdentity: null,
    analyzerRevision: AGENT_SHELL_FALLBACK_ANALYZER_REVISION,
    assessment: Object.freeze({
      facets: Object.freeze(hasEnvironmentOverrides
        ? ['environment_change', 'unknown_syntax'] as const
        : ['unknown_syntax'] as const),
      operations: Object.freeze([]),
      persistentRuleEligible: false,
      risk: 'destructive' as const,
      unresolved: Object.freeze(['ast-analysis-unavailable']),
    }),
    workspaceBoundaryVerified: false,
  });
}

export function createAgentShellAuthorizationIdentity(input: {
  readonly aiDestinationIdentity: string;
  readonly analysisIdentity: string | null;
  readonly environmentIdentity: string;
  readonly providerRegistrationIdentity: string;
  readonly workspaceContentIdentity: string;
  readonly workspaceContentScannerRevision: string;
}): string | undefined {
  if (!input.analysisIdentity) return undefined;
  return hashIdentity('omniflow.agent.shell.authorization-v1', {
    aiDestinationIdentity: input.aiDestinationIdentity,
    analysisIdentity: input.analysisIdentity,
    environmentIdentity: input.environmentIdentity,
    immutableDenyRevision: AGENT_SHELL_IMMUTABLE_DENY_REVISION,
    policyRevision: AGENT_SHELL_POLICY_REVISION,
    providerRegistrationIdentity: input.providerRegistrationIdentity,
    workspaceContentIdentity: input.workspaceContentIdentity,
    workspaceContentScannerRevision: input.workspaceContentScannerRevision,
  });
}

function createPreparationDecision(
  policyDecision: AgentShellPolicyDecision,
  publicAction: AgentShellPreparedActionPublicV1,
): AgentToolPermissionDecision {
  if (policyDecision.behavior === 'allow') {
    return Object.freeze({
      behavior: 'allow' as const,
      risk: policyDecision.risk,
    });
  }
  if (policyDecision.behavior === 'deny') {
    return Object.freeze({
      behavior: 'deny' as const,
      message: 'Agent Shell 当前策略不允许执行此命令',
      risk: policyDecision.risk,
    });
  }
  return Object.freeze({
    behavior: 'ask' as const,
    preview: Object.freeze({
      description: '此命令将以当前系统用户权限运行，并把有界输出提供给当前 AI 服务。',
      details: Object.freeze([
        Object.freeze({ label: '命令', value: publicAction.command }),
        Object.freeze({ label: 'Provider', value: publicAction.provider.id }),
        Object.freeze({ label: '工作目录', value: publicAction.cwd.path }),
        Object.freeze({ label: '超时', value: `${publicAction.timeoutMs} ms` }),
        ...publicAction.environment.map(entry => Object.freeze({
          label: `环境变量 ${entry.name}`,
          value: entry.value,
        })),
      ]),
      risk: policyDecision.risk,
      title: '运行 Shell 命令',
    }),
    risk: policyDecision.risk,
  });
}

export function createAgentShellPreparationService(
  options: CreateAgentShellPreparationServiceOptions,
) {
  if (!options?.workspaceStore) throw new Error('Agent Shell PreparationService 缺少 workspace');
  const commandAnalyzer = options.commandAnalyzer || createAgentShellCommandAnalyzer();
  const policyEngine = createAgentShellPolicyEngine();
  const hostEnvironment = captureHostEnvironment(options.hostEnvironment || process.env);
  const additionalPathEntries = Object.freeze([...(options.additionalPathEntries || [])]);

  async function prepare(
    request: AgentShellPreparationRequest,
  ): Promise<AgentToolMainPreparationResult> {
    const context = request?.context;
    if (!context || context.preparationIdentity.toolName !== AGENT_SHELL_RUN_TOOL_NAME) {
      throw new Error('Agent Shell preparation identity 无效');
    }
    if (
      context.runCapabilitySnapshot.identity
      !== context.preparationIdentity.runCapabilityIdentity
    ) {
      throw new Error('Agent Shell Run capability snapshot 不匹配');
    }
    if (
      !sameOwnerScope(context.ownerScope, context.preparationIdentity.ownerScope)
      || context.ownerWebContentsId !== context.preparationIdentity.ownerWebContentsId
      || context.appContext.libraryId !== context.preparationIdentity.libraryId
    ) {
      throw new Error('Agent Shell preparation owner binding 不匹配');
    }
    if (
      !context.aiDestination
      || context.aiDestination.identity !== context.preparationIdentity.aiDestinationIdentity
    ) {
      throw new Error('Agent Shell AI 目的地 binding 不匹配');
    }
    abortIfNeeded(context.signal);
    const normalizedInput = requestedInput(
      normalizeAgentShellRunInputV1(request.input),
      request.requestedAction,
    );
    assertNoSensitiveShellInput(normalizedInput);

    const providerId = normalizedInput.providerId
      || context.runCapabilitySnapshot.defaultShellProviderId;
    if (!providerId) throw new Error('Agent Shell 当前 Run 没有可用 Provider');
    const provider = normalizedInput.providerId
      ? context.runCapabilitySnapshot.getShellProviderById(providerId)
      : context.runCapabilitySnapshot.getShellProvider(
          context.runCapabilitySnapshot.defaultShellProviderRegistrationIdentity || '',
        );
    if (!provider || provider.publicIdentity.providerId !== providerId) {
      throw new Error('Agent Shell Provider 不属于当前 Run 冻结快照');
    }
    if (provider.publicIdentity.platform !== context.appContext.platform) {
      throw new Error('Agent Shell Provider 与当前平台不匹配');
    }
    if (
      context.runCapabilitySnapshot.getShellProvider(
        provider.publicIdentity.registrationIdentity,
      ) !== provider
    ) {
      throw new Error('Agent Shell Provider registration identity 不匹配');
    }
    let providerBinding: AgentShellProviderMainBinding;
    let invocation: ReturnType<typeof freezeAgentShellProviderInvocation>;
    try {
      providerBinding = provider.getMainBinding();
      invocation = freezeAgentShellProviderInvocation(
        provider,
        providerBinding,
        normalizedInput.command,
      );
    } catch {
      throw new Error('Agent Shell Provider execution binding 无法确认');
    }

    const owner: AgentShellWorkspaceOwner = Object.freeze({
      ...context.preparationIdentity.ownerScope,
      sessionId: context.preparationIdentity.sessionId,
    });
    let preparedWorkspace: AgentShellWorkspacePreparationContext;
    try {
      preparedWorkspace = await options.workspaceStore.resolvePreparationContext(
        request.workspaceId,
        normalizedInput.cwd,
        context.preparationIdentity.runId,
        owner,
        context.signal,
      );
      abortIfNeeded(context.signal);
      assertWorkspaceBinding(
        preparedWorkspace,
        owner,
        context.preparationIdentity.runId,
        request.workspaceId,
      );
    } catch {
      abortIfNeeded(context.signal);
      throw new Error('Agent Shell workspace binding 无法确认');
    }
    abortIfNeeded(context.signal);
    const aiDestination = Object.freeze({
      configurationIdentity: boundedMainIdentity(
        context.aiDestination.configurationIdentity,
        'Agent Shell AI 配置 identity',
      ),
      identity: boundedMainIdentity(
        context.aiDestination.identity,
        'Agent Shell AI 目的地 identity',
      ),
      model: boundedMainText(
        context.aiDestination.model,
        'Agent Shell AI 模型',
        MAX_AI_MODEL_BYTES,
      ),
      profileId: boundedMainText(
        context.aiDestination.profileId,
        'Agent Shell AI 配置 ID',
        MAX_AI_PROFILE_ID_BYTES,
      ),
      profileLabel: boundedMainText(
        context.aiDestination.profileLabel,
        'Agent Shell AI 配置',
        MAX_AI_DESTINATION_LABEL_BYTES,
      ),
      providerType: boundedMainText(
        context.aiDestination.providerType,
        'Agent Shell AI Provider',
        MAX_AI_PROVIDER_TYPE_BYTES,
      ),
    });
    const effectiveEnvironment = buildAgentShellEffectiveEnvironment({
      additionalPathEntries,
      hostEnvironment,
      overrides: normalizedInput.env,
      provider,
      providerBinding,
      workspace: preparedWorkspace,
    });
    let commandAnalysis: AgentShellCommandAnalysis;
    try {
      commandAnalysis = await commandAnalyzer.analyze({
        command: normalizedInput.command,
        dialect: provider.publicIdentity.dialect,
        hasEnvironmentOverrides: Object.keys(normalizedInput.env).length > 0,
        logicalCwd: preparedWorkspace.logicalCwd,
        persistentRuleEligible: AGENT_SHELL_WORKSPACE_PERSISTENT_RULE_IDENTITY_READY,
        providerAnalyzerRevision: provider.publicIdentity.analyzerRevision,
      });
      abortIfNeeded(context.signal);
    } catch {
      abortIfNeeded(context.signal);
      commandAnalysis = createAgentShellConservativeAnalysis(
        Object.keys(normalizedInput.env).length > 0,
      );
    }
    const assessment = commandAnalysis.assessment;
    const authorizationIdentity = createAgentShellAuthorizationIdentity({
      aiDestinationIdentity: aiDestination.identity,
      analysisIdentity: commandAnalysis.analysisIdentity,
      environmentIdentity: effectiveEnvironment.identity,
      providerRegistrationIdentity: provider.publicIdentity.registrationIdentity,
      workspaceContentIdentity: preparedWorkspace.workspaceContentIdentity,
      workspaceContentScannerRevision: preparedWorkspace.workspaceContentScannerRevision,
    });
    const publicAction = sealAgentShellPreparedActionPublicV1({
      aiDestination: Object.freeze({
        identityHash: aiDestination.identity,
        profileLabel: aiDestination.profileLabel,
        providerType: aiDestination.providerType,
      }),
      assessment,
      command: normalizedInput.command,
      cwd: Object.freeze({ kind: 'run-workspace', path: preparedWorkspace.logicalCwd }),
      dataScope: Object.freeze({
        stagedInputs: Object.freeze([]),
        unresolvedWorkspaceRead: !commandAnalysis.workspaceBoundaryVerified,
      }),
      environment: Object.freeze(Object.entries(normalizedInput.env)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => Object.freeze({ name, value }))),
      kind: AGENT_SHELL_RUN_TOOL_NAME,
      provider: Object.freeze({
        dialect: provider.publicIdentity.dialect,
        id: provider.publicIdentity.providerId,
        version: provider.publicIdentity.version,
      }),
      timeoutMs: normalizedInput.timeoutMs,
      version: 1,
    });
    const policyDecision = policyEngine.evaluate({
      assessment,
      authorizationIdentity,
      mode: context.runCapabilitySnapshot.shellPermissionMode,
      workspaceBoundaryVerified: commandAnalysis.workspaceBoundaryVerified,
    });
    abortIfNeeded(context.signal);
    return Object.freeze({
      binding: Object.freeze({
        aiDestination,
        analysis: Object.freeze({
          analysisIdentity: commandAnalysis.analysisIdentity,
          analyzerRevision: commandAnalysis.analyzerRevision,
          authorizationIdentity: authorizationIdentity || null,
          fallbackAnalyzerRevision: AGENT_SHELL_FALLBACK_ANALYZER_REVISION,
          immutableDenyRevision: AGENT_SHELL_IMMUTABLE_DENY_REVISION,
          policyRevision: AGENT_SHELL_POLICY_REVISION,
          permissionMode: context.runCapabilitySnapshot.shellPermissionMode,
          providerAnalyzerRevision: provider.publicIdentity.analyzerRevision,
          reasonCodes: policyDecision.reasonCodes,
          workspaceBoundaryVerified: commandAnalysis.workspaceBoundaryVerified,
        }),
        commandHash: publicAction.commandHash,
        effectiveEnvironment,
        environmentBindingVersion: AGENT_SHELL_ENVIRONMENT_BINDING_VERSION,
        invocation,
        provider: Object.freeze({
          encoding: Object.freeze({ ...provider.publicIdentity.encoding }),
          encodingRevision: provider.publicIdentity.encodingRevision,
          executable: providerBinding.executable,
          executableContentIdentity: Object.freeze({
            ...providerBinding.executableContentIdentity,
          }),
          executionReady: provider.publicIdentity.executionReady,
          fixedArgs: Object.freeze([...provider.publicIdentity.fixedArgs]),
          invocationRevision: provider.publicIdentity.invocationRevision,
          probeGeneration: provider.publicIdentity.probeGeneration,
          probeIdentity: provider.publicIdentity.probeIdentity,
          providerSnapshotIdentity: context.runCapabilitySnapshot.shellProviderSnapshotIdentity,
          registrationIdentity: provider.publicIdentity.registrationIdentity,
          resolvedExecutable: providerBinding.resolvedExecutable,
          terminationRevision: provider.publicIdentity.terminationRevision,
        }),
        workspace: preparedWorkspace,
      }),
      decision: createPreparationDecision(policyDecision, publicAction),
      publicAction,
      snapshotMaterial: Object.freeze({
        aiDestinationConfigurationIdentity: aiDestination.configurationIdentity,
        analysisIdentity: commandAnalysis.analysisIdentity,
        analyzerRevision: commandAnalysis.analyzerRevision,
        authorizationIdentity: authorizationIdentity || null,
        fallbackAnalyzerRevision: AGENT_SHELL_FALLBACK_ANALYZER_REVISION,
        immutableDenyRevision: AGENT_SHELL_IMMUTABLE_DENY_REVISION,
        policyRevision: AGENT_SHELL_POLICY_REVISION,
        permissionMode: context.runCapabilitySnapshot.shellPermissionMode,
        policyReasonCodes: policyDecision.reasonCodes,
        providerAnalyzerRevision: provider.publicIdentity.analyzerRevision,
        providerSnapshotIdentity: context.runCapabilitySnapshot.shellProviderSnapshotIdentity,
        workspaceContentIdentity: preparedWorkspace.workspaceContentIdentity,
        workspaceContentScannerRevision: preparedWorkspace.workspaceContentScannerRevision,
        workspaceEntryCount: preparedWorkspace.workspaceEntryCount,
        workspaceGeneration: preparedWorkspace.generation,
        workspaceMetadataIdentity: preparedWorkspace.workspaceMetadataIdentity,
        workspaceTotalBytes: preparedWorkspace.workspaceTotalBytes,
        workspaceBoundaryVerified: commandAnalysis.workspaceBoundaryVerified,
      }),
    });
  }

  return Object.freeze({ prepare });
}

export type AgentShellPreparationService = ReturnType<typeof createAgentShellPreparationService>;

import {
  createAgentAiDestinationSnapshot,
  type AgentRuntimeProfile,
} from '../agent-ai-destination';
import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import {
  defaultAgentShellProviderProbeDependencies,
} from '../../../platform/shell/shell-provider-probe';
import type {
  AgentShellProviderProbeDependencies,
} from '../../../platform/shell/shell-provider.types';
import {
  validateAgentShellPreparedActionCommandHashV1,
} from './agent-shell-prepared-action';
import {
  createAgentShellCommandAnalyzer,
  type AgentShellCommandAnalyzer,
} from './agent-shell-command-analyzer';
import {
  AGENT_SHELL_WORKSPACE_PERSISTENT_RULE_IDENTITY_READY,
} from './agent-shell-workspace-content-scanner';
import {
  AGENT_SHELL_IMMUTABLE_DENY_REVISION,
  AGENT_SHELL_POLICY_REVISION,
  createAgentShellPolicyEngine,
} from './agent-shell-policy-engine';
import {
  AGENT_SHELL_ENVIRONMENT_BINDING_VERSION,
  AGENT_SHELL_ENVIRONMENT_POLICY_REVISION,
  buildAgentShellEffectiveEnvironment,
  createAgentShellAuthorizationIdentity,
  createAgentShellConservativeAnalysis,
  freezeAgentShellProviderInvocation,
  type AgentShellPreparationHostEnvironment,
} from './agent-shell-preparation-service';
import type {
  AgentShellProviderRegistry,
} from './agent-shell-provider-registry';
import type {
  AgentShellSpawnPreflightBindingResolver,
  AgentShellSpawnPreflightCurrentBinding,
} from './agent-shell-spawn-preflight';
import type {
  AgentShellWorkspacePreparationContext,
} from './agent-shell-workspace-store';

export interface CreateAgentShellBindingResolverOptions {
  readonly additionalPathEntries?: readonly string[];
  readonly commandAnalyzer?: Pick<AgentShellCommandAnalyzer, 'analyze'>;
  readonly hostEnvironment?: AgentShellPreparationHostEnvironment;
  readonly probeDependencies?: Pick<
    AgentShellProviderProbeDependencies,
    'accessExecutable' | 'readExecutableIdentity' | 'resolveExecutable'
  >;
  readonly providerRegistry: Pick<AgentShellProviderRegistry, 'getSnapshot'>;
  readonly resolveRuntimeProfile: (profileId: string) => AgentRuntimeProfile;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Agent Shell binding 复验已取消');
  error.name = 'AbortError';
  throw error;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}无效`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}无效`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function sameExecutableIdentity(
  left: { readonly sha256: string; readonly sizeBytes: number },
  right: { readonly sha256: string; readonly sizeBytes: number },
): boolean {
  return left.sha256 === right.sha256 && left.sizeBytes === right.sizeBytes;
}

export function createAgentShellBindingResolver(
  options: CreateAgentShellBindingResolverOptions,
): AgentShellSpawnPreflightBindingResolver {
  if (!options?.providerRegistry) throw new Error('Agent Shell binding resolver 缺少 Provider Registry');
  if (!options?.resolveRuntimeProfile) throw new Error('Agent Shell binding resolver 缺少 AI 配置解析器');
  const commandAnalyzer = options.commandAnalyzer || createAgentShellCommandAnalyzer();
  const policyEngine = createAgentShellPolicyEngine();
  const additionalPathEntries = Object.freeze([...(options.additionalPathEntries || [])]);
  const hostEnvironment = options.hostEnvironment || process.env;
  const probeDependencies = options.probeDependencies
    || defaultAgentShellProviderProbeDependencies;

  async function resolveCurrentBinding(input: {
    readonly preparation: AgentToolMainPreparedExecution;
    readonly signal: AbortSignal;
  }): Promise<AgentShellSpawnPreflightCurrentBinding> {
    abortIfNeeded(input.signal);
    const action = validateAgentShellPreparedActionCommandHashV1(input.preparation.publicAction);
    const binding = record(input.preparation.binding, 'Agent Shell prepared binding');
    const preparedAiDestination = record(
      binding.aiDestination,
      'Agent Shell AI destination binding',
    );
    const preparedProvider = record(binding.provider, 'Agent Shell Provider binding');
    const preparedAnalysis = record(binding.analysis, 'Agent Shell analysis binding');
    const preparedWorkspace = record(
      binding.workspace,
      'Agent Shell workspace binding',
    ) as unknown as AgentShellWorkspacePreparationContext;
    const profileId = requiredText(
      preparedAiDestination.profileId,
      'Agent Shell AI profile ID',
    );
    const model = requiredText(preparedAiDestination.model, 'Agent Shell AI model');
    const currentAiDestination = createAgentAiDestinationSnapshot({
      model,
      profileId,
      runtimeConnection: options.resolveRuntimeProfile(profileId),
    });
    abortIfNeeded(input.signal);

    const providerSnapshot = options.providerRegistry.getSnapshot();
    const registrationIdentity = requiredText(
      preparedProvider.registrationIdentity,
      'Agent Shell Provider registration identity',
    );
    const provider = providerSnapshot.getProvider(registrationIdentity);
    if (
      !provider
      || !provider.publicIdentity.executionReady
      || provider.publicIdentity.platform !== providerSnapshot.platform
      || provider.publicIdentity.providerId !== action.provider.id
      || provider.publicIdentity.dialect !== action.provider.dialect
      || provider.publicIdentity.version !== action.provider.version
    ) {
      throw new Error('Agent Shell Provider 当前不可执行');
    }
    const providerBinding = provider.getMainBinding();
    await probeDependencies.accessExecutable(
      providerBinding.executable,
      provider.publicIdentity.platform,
    );
    const resolvedExecutable = await probeDependencies.resolveExecutable(
      providerBinding.executable,
      provider.publicIdentity.platform,
    );
    const executableContentIdentity = await probeDependencies.readExecutableIdentity(
      resolvedExecutable,
      provider.publicIdentity.platform,
    );
    if (
      resolvedExecutable !== providerBinding.resolvedExecutable
      || !sameExecutableIdentity(
        executableContentIdentity,
        providerBinding.executableContentIdentity,
      )
    ) {
      throw new Error('Agent Shell Provider executable identity 已变化');
    }
    freezeAgentShellProviderInvocation(provider, providerBinding, action.command);
    abortIfNeeded(input.signal);

    const overrides = Object.freeze(Object.fromEntries(
      action.environment.map(entry => [entry.name, entry.value]),
    ));
    const effectiveEnvironment = buildAgentShellEffectiveEnvironment({
      additionalPathEntries,
      hostEnvironment,
      overrides,
      provider,
      providerBinding,
      workspace: preparedWorkspace,
    });
    let commandAnalysis;
    try {
      commandAnalysis = await commandAnalyzer.analyze({
        command: action.command,
        dialect: provider.publicIdentity.dialect,
        hasEnvironmentOverrides: action.environment.length > 0,
        logicalCwd: action.cwd.path,
        persistentRuleEligible: AGENT_SHELL_WORKSPACE_PERSISTENT_RULE_IDENTITY_READY,
        providerAnalyzerRevision: provider.publicIdentity.analyzerRevision,
      });
    } catch {
      abortIfNeeded(input.signal);
      commandAnalysis = createAgentShellConservativeAnalysis(action.environment.length > 0);
    }
    abortIfNeeded(input.signal);
    const authorizationIdentity = createAgentShellAuthorizationIdentity({
      aiDestinationIdentity: currentAiDestination.identity,
      analysisIdentity: commandAnalysis.analysisIdentity,
      environmentIdentity: effectiveEnvironment.identity,
      providerRegistrationIdentity: provider.publicIdentity.registrationIdentity,
      workspaceContentIdentity: preparedWorkspace.workspaceContentIdentity,
      workspaceContentScannerRevision: preparedWorkspace.workspaceContentScannerRevision,
    }) || null;
    const permissionMode = preparedAnalysis.permissionMode;
    if (
      permissionMode !== 'ask'
      && permissionMode !== 'auto'
      && permissionMode !== 'full-access'
    ) {
      throw new Error('Agent Shell 冻结权限模式无效');
    }
    const policyDecision = policyEngine.evaluate({
      assessment: commandAnalysis.assessment,
      authorizationIdentity: authorizationIdentity || undefined,
      mode: permissionMode,
      workspaceBoundaryVerified: commandAnalysis.workspaceBoundaryVerified,
    });
    if (policyDecision.behavior === 'deny') {
      throw new Error('Agent Shell 当前策略不再允许执行此命令');
    }

    return Object.freeze({
      aiDestinationConfigurationIdentity: currentAiDestination.configurationIdentity,
      aiDestinationIdentity: currentAiDestination.identity,
      analysisIdentity: commandAnalysis.analysisIdentity,
      analyzerRevision: commandAnalysis.analyzerRevision,
      authorizationIdentity,
      environmentBindingVersion: AGENT_SHELL_ENVIRONMENT_BINDING_VERSION,
      environmentIdentity: effectiveEnvironment.identity,
      environmentPolicyRevision: effectiveEnvironment.policyRevision,
      immutableDenyRevision: AGENT_SHELL_IMMUTABLE_DENY_REVISION,
      pathHash: effectiveEnvironment.pathHash,
      permissionMode,
      policyRevision: AGENT_SHELL_POLICY_REVISION,
      providerAnalyzerRevision: provider.publicIdentity.analyzerRevision,
      providerEncodingRevision: provider.publicIdentity.encodingRevision,
      providerEnvironmentPolicyRevision: provider.publicIdentity.environmentRevision,
      providerExecutableSha256: executableContentIdentity.sha256,
      providerExecutableSizeBytes: executableContentIdentity.sizeBytes,
      providerExecutionReady: provider.publicIdentity.executionReady,
      providerInvocationRevision: provider.publicIdentity.invocationRevision,
      providerProbeGeneration: provider.publicIdentity.probeGeneration,
      providerProbeIdentity: provider.publicIdentity.probeIdentity,
      providerRegistrationIdentity: provider.publicIdentity.registrationIdentity,
      providerResolvedExecutable: resolvedExecutable,
      providerSnapshotIdentity: providerSnapshot.snapshotIdentity,
      providerTerminationRevision: provider.publicIdentity.terminationRevision,
      serviceEnvironmentPolicyRevision: AGENT_SHELL_ENVIRONMENT_POLICY_REVISION,
    });
  }

  return Object.freeze({ resolveCurrentBinding });
}

import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { normalizeAgentOwnerScope } from '../../../../src/shared/agent/agent-owner-scope';
import { validateAgentShellPreparedActionCommandHashV1 } from './agent-shell-prepared-action';
import {
  isAgentShellExecutionLeaseGrant,
  type AgentShellExecutionLeaseGrant,
} from './agent-shell-execution-lease';
import type { AgentToolMainPreparedExecution } from '../agent-tool-registry';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
  AgentShellWorkspaceStore,
} from './agent-shell-workspace-store';

const DEFAULT_OBSERVATION_WINDOW_MS = 50;
const MAX_OBSERVATION_WINDOW_MS = 500;
const IDENTITY_PATTERN = /^v[1-9]\d*:[a-f0-9]{64}$/u;

export interface AgentShellSpawnPreflightCurrentBinding {
  readonly aiDestinationConfigurationIdentity: string;
  readonly aiDestinationIdentity: string;
  readonly analysisIdentity: string | null;
  readonly analyzerRevision: string;
  readonly authorizationIdentity: string | null;
  readonly environmentBindingVersion: number;
  readonly environmentIdentity: string;
  readonly environmentPolicyRevision: string;
  readonly immutableDenyRevision: string;
  readonly pathHash: string;
  readonly permissionMode: 'ask' | 'auto' | 'full-access';
  readonly policyRevision: string;
  readonly providerAnalyzerRevision: string;
  readonly providerEncodingRevision: string;
  readonly providerExecutableSha256: string;
  readonly providerExecutableSizeBytes: number;
  readonly providerExecutionReady: boolean;
  readonly providerInvocationRevision: string;
  readonly providerProbeGeneration: number;
  readonly providerProbeIdentity: string;
  readonly providerRegistrationIdentity: string;
  readonly providerResolvedExecutable: string;
  readonly providerSnapshotIdentity: string;
  readonly providerTerminationRevision: string;
  readonly providerEnvironmentPolicyRevision: string;
  readonly serviceEnvironmentPolicyRevision: string;
}

export interface AgentShellSpawnPreflightBindingResolver {
  readonly resolveCurrentBinding: (input: {
    readonly owner: AgentShellWorkspaceOwner;
    readonly preparation: AgentToolMainPreparedExecution;
    readonly signal: AbortSignal;
  }) => Promise<AgentShellSpawnPreflightCurrentBinding>;
}

export interface AgentShellSpawnPreflightWatcher {
  readonly close: () => void;
  readonly changed: () => boolean;
}

export interface CreateAgentShellSpawnPreflightOptions {
  readonly bindingResolver: AgentShellSpawnPreflightBindingResolver;
  readonly createWatcher?: (
    rootPath: string,
    onChange: () => void,
  ) => AgentShellSpawnPreflightWatcher;
  readonly observationWindowMs?: number;
  readonly workspaceStore: Pick<
    AgentShellWorkspaceStore,
    'resolvePreparationContext'
  >;
}

export interface AgentShellSpawnPreflightInput {
  readonly grant: AgentShellExecutionLeaseGrant;
  readonly owner: AgentShellWorkspaceOwner;
  readonly preparation: AgentToolMainPreparedExecution;
  readonly runCapabilityIdentity: string;
  readonly signal: AbortSignal;
  readonly toolRunId: string;
  readonly workspaceId: string;
}

function invalidPreflight(message: string): never {
  throw new Error(message);
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Agent Shell spawn 前复验已取消');
  error.name = 'AbortError';
  throw error;
}

function sameOwner(
  left: AgentShellWorkspaceOwner,
  right: AgentShellWorkspaceOwner,
): boolean {
  const normalizedLeft = normalizeAgentOwnerScope(left);
  const normalizedRight = normalizeAgentOwnerScope(right);
  return normalizedLeft.accountScope === normalizedRight.accountScope
    && normalizedLeft.backendScope === normalizedRight.backendScope
    && left.sessionId === right.sessionId;
}

function sameWorkspace(
  expected: AgentShellWorkspacePreparationContext,
  current: AgentShellWorkspacePreparationContext,
): boolean {
  return expected.generation === current.generation
    && expected.logicalCwd === current.logicalCwd
    && expected.workspaceMetadataIdentity === current.workspaceMetadataIdentity
    && expected.workspaceContentIdentity === current.workspaceContentIdentity
    && expected.workspaceContentScannerRevision === current.workspaceContentScannerRevision
    && expected.workspaceEntryCount === current.workspaceEntryCount
    && expected.workspaceTotalBytes === current.workspaceTotalBytes
    && expected.physicalCwdPath === current.physicalCwdPath
    && expected.physicalHomePath === current.physicalHomePath
    && expected.physicalTempPath === current.physicalTempPath
    && expected.runId === current.runId
    && expected.workspaceId === current.workspaceId
    && sameOwner(expected.owner, current.owner);
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameEnvironment(
  left: readonly { readonly name: string; readonly value: string }[],
  right: readonly { readonly name: string; readonly value: string }[],
): boolean {
  return left.length === right.length
    && left.every((entry, index) => (
      entry.name === right[index]?.name && entry.value === right[index]?.value
    ));
}

function assertIdentity(value: unknown, label: string, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || !IDENTITY_PATTERN.test(value)) {
    invalidPreflight(`${label}无效`);
  }
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    invalidPreflight(`${label}无效`);
  }
  return value;
}

function workspaceRootPath(context: AgentShellWorkspacePreparationContext): string {
  const homePath = context.physicalHomePath;
  const pathApi = /^[A-Za-z]:[\\/]/u.test(homePath) ? path.win32 : path.posix;
  const normalizedHomePath = pathApi.normalize(homePath);
  if (pathApi.basename(normalizedHomePath).toLowerCase() !== 'home') {
    invalidPreflight('Agent Shell workspace home 身份无效');
  }
  return pathApi.dirname(normalizedHomePath);
}

function createDefaultWatcher(
  rootPath: string,
  onChange: () => void,
): AgentShellSpawnPreflightWatcher {
  let dirty = false;
  let watcher: FSWatcher;
  try {
    watcher = watch(rootPath, { persistent: false, recursive: true }, () => {
      dirty = true;
      onChange();
    });
  } catch {
    invalidPreflight('Agent Shell workspace 观察器不可用');
  }
  watcher.on('error', () => {
    dirty = true;
    onChange();
  });
  return {
    changed: () => dirty,
    close: () => watcher.close(),
  };
}

function waitForObservationWindow(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    abortIfNeeded(signal);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const error = new Error('Agent Shell spawn 前复验已取消');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function expectedBinding(
  preparation: AgentToolMainPreparedExecution,
): AgentShellSpawnPreflightCurrentBinding {
  const binding = preparation.binding as Record<string, unknown>;
  const analysis = binding.analysis as Record<string, unknown> | undefined;
  const provider = binding.provider as Record<string, unknown> | undefined;
  const effectiveEnvironment = binding.effectiveEnvironment as Record<string, unknown> | undefined;
  if (!analysis || !provider || !effectiveEnvironment) {
    invalidPreflight('Agent Shell prepared binding 不完整');
  }
  const providerSnapshotIdentity = provider.providerSnapshotIdentity;
  const aiDestination = binding.aiDestination as Record<string, unknown> | undefined;
  const executableContentIdentity = provider.executableContentIdentity as
    | Record<string, unknown>
    | undefined;
  if (!aiDestination || !executableContentIdentity) {
    invalidPreflight('Agent Shell prepared binding 不完整');
  }
  return Object.freeze({
    aiDestinationConfigurationIdentity: assertIdentity(
      aiDestination.configurationIdentity,
      'Agent Shell AI destination configuration identity',
    ) as string,
    aiDestinationIdentity: assertIdentity(
      preparation.identity.aiDestinationIdentity,
      'Agent Shell AI destination identity',
    ) as string,
    analysisIdentity: assertIdentity(analysis.analysisIdentity, 'Agent Shell analysis identity', true),
    analyzerRevision: requiredText(
      analysis.analyzerRevision,
      'Agent Shell analyzer revision',
    ),
    authorizationIdentity: assertIdentity(
      analysis.authorizationIdentity,
      'Agent Shell authorization identity',
      true,
    ),
    environmentBindingVersion: (() => {
      if (!Number.isSafeInteger(binding.environmentBindingVersion)
        || (binding.environmentBindingVersion as number) < 1) {
        invalidPreflight('Agent Shell environment binding version 无效');
      }
      return binding.environmentBindingVersion as number;
    })(),
    environmentIdentity: requiredText(
      effectiveEnvironment.identity,
      'Agent Shell environment identity',
    ),
    environmentPolicyRevision: requiredText(
      effectiveEnvironment.policyRevision,
      'Agent Shell environment policy revision',
    ),
    immutableDenyRevision: requiredText(
      analysis.immutableDenyRevision,
      'Agent Shell immutable deny revision',
    ),
    pathHash: requiredText(effectiveEnvironment.pathHash, 'Agent Shell PATH identity'),
    permissionMode: (() => {
      const mode = analysis.permissionMode;
      if (mode !== 'ask' && mode !== 'auto' && mode !== 'full-access') {
        invalidPreflight('Agent Shell permission mode 无效');
      }
      return mode;
    })(),
    policyRevision: requiredText(analysis.policyRevision, 'Agent Shell policy revision'),
    providerAnalyzerRevision: requiredText(
      analysis.providerAnalyzerRevision,
      'Agent Shell Provider analyzer revision',
    ),
    providerEncodingRevision: requiredText(
      provider.encodingRevision,
      'Agent Shell Provider encoding revision',
    ),
    providerExecutableSha256: requiredText(
      executableContentIdentity.sha256,
      'Agent Shell Provider executable hash',
    ),
    providerExecutableSizeBytes: (() => {
      if (!Number.isSafeInteger(executableContentIdentity.sizeBytes)
        || (executableContentIdentity.sizeBytes as number) < 0) {
        invalidPreflight('Agent Shell Provider executable size 无效');
      }
      return executableContentIdentity.sizeBytes as number;
    })(),
    providerExecutionReady: (() => {
      if (provider.executionReady !== true) {
        invalidPreflight('Agent Shell Provider execution readiness 无效');
      }
      return true;
    })(),
    providerInvocationRevision: requiredText(
      provider.invocationRevision,
      'Agent Shell Provider invocation revision',
    ),
    providerProbeGeneration: (() => {
      if (!Number.isSafeInteger(provider.probeGeneration) || (provider.probeGeneration as number) < 1) {
        invalidPreflight('Agent Shell Provider probe generation 无效');
      }
      return provider.probeGeneration as number;
    })(),
    providerProbeIdentity: requiredText(
      provider.probeIdentity,
      'Agent Shell Provider probe identity',
    ),
    providerRegistrationIdentity: requiredText(
      provider.registrationIdentity,
      'Agent Shell Provider registration identity',
    ),
    providerResolvedExecutable: requiredText(
      provider.resolvedExecutable,
      'Agent Shell Provider resolved executable',
    ),
    providerSnapshotIdentity: requiredText(
      providerSnapshotIdentity,
      'Agent Shell Provider snapshot identity',
    ),
    providerTerminationRevision: requiredText(
      provider.terminationRevision,
      'Agent Shell Provider termination revision',
    ),
    providerEnvironmentPolicyRevision: requiredText(
      effectiveEnvironment.providerPolicyRevision,
      'Agent Shell Provider environment policy revision',
    ),
    serviceEnvironmentPolicyRevision: requiredText(
      effectiveEnvironment.servicePolicyRevision,
      'Agent Shell service environment policy revision',
    ),
  });
}

function assertCurrentBinding(
  expected: AgentShellSpawnPreflightCurrentBinding,
  current: AgentShellSpawnPreflightCurrentBinding,
): void {
  const fields: readonly (keyof AgentShellSpawnPreflightCurrentBinding)[] = [
    'aiDestinationConfigurationIdentity',
    'aiDestinationIdentity',
    'analysisIdentity',
    'analyzerRevision',
    'authorizationIdentity',
    'environmentBindingVersion',
    'environmentIdentity',
    'environmentPolicyRevision',
    'immutableDenyRevision',
    'pathHash',
    'permissionMode',
    'policyRevision',
    'providerAnalyzerRevision',
    'providerEncodingRevision',
    'providerExecutableSha256',
    'providerExecutableSizeBytes',
    'providerExecutionReady',
    'providerInvocationRevision',
    'providerProbeGeneration',
    'providerProbeIdentity',
    'providerRegistrationIdentity',
    'providerResolvedExecutable',
    'providerSnapshotIdentity',
    'providerTerminationRevision',
    'providerEnvironmentPolicyRevision',
    'serviceEnvironmentPolicyRevision',
  ];
  if (fields.some(field => expected[field] !== current[field])) {
    invalidPreflight('Agent Shell execution binding 在 spawn 前已变化');
  }
}

function assertGrantMatchesPreparation(
  input: AgentShellSpawnPreflightInput,
): AgentShellWorkspacePreparationContext {
  const { grant, owner, preparation } = input;
  if (!isAgentShellExecutionLeaseGrant(grant)) {
    invalidPreflight('Agent Shell spawn 只接受已消费的 execution lease grant');
  }
  if (grant.expiresAt <= Date.now()) invalidPreflight('Agent Shell execution grant 已过期');
  const publicAction = validateAgentShellPreparedActionCommandHashV1(preparation.publicAction);
  if (
    preparation.preparedActionId !== preparation.identity.preparedActionId
    || preparation.identity.toolRunId !== input.toolRunId
    || preparation.identity.runCapabilityIdentity !== input.runCapabilityIdentity
    || preparation.identity.runId !== grant.workspace.runId
    || preparation.identity.sessionId !== grant.workspace.owner.sessionId
    || preparation.identity.aiDestinationIdentity !== publicAction.aiDestination.identityHash
    || input.workspaceId !== grant.workspace.workspaceId
    || publicAction.kind !== 'shell.run'
    || publicAction.version !== 1
    || publicAction.command !== grant.command
    || publicAction.commandHash !== grant.commandHash
    || publicAction.cwd.path !== grant.workspace.logicalCwd
    || grant.cwdPath !== grant.workspace.physicalCwdPath
  ) {
    invalidPreflight('Agent Shell prepared execution 与 grant 不匹配');
  }
  if (!sameOwner(owner, grant.workspace.owner)) {
    invalidPreflight('Agent Shell spawn owner 不匹配');
  }
  const binding = preparation.binding as Record<string, unknown>;
  const aiDestination = binding.aiDestination as { identity?: unknown } | undefined;
  const workspace = binding.workspace as AgentShellWorkspacePreparationContext | undefined;
  const invocation = binding.invocation as {
    argv?: unknown;
    executable?: unknown;
    shell?: unknown;
  } | undefined;
  const provider = binding.provider as Record<string, unknown> | undefined;
  const effectiveEnvironment = binding.effectiveEnvironment as {
    entries?: unknown;
  } | undefined;
  if (
    !workspace
    || !aiDestination
    || !invocation
    || !provider
    || !effectiveEnvironment
    || !Array.isArray(invocation.argv)
    || invocation.shell !== false
    || typeof invocation.executable !== 'string'
    || !Array.isArray(effectiveEnvironment.entries)
    || aiDestination.identity !== preparation.identity.aiDestinationIdentity
    || binding.commandHash !== grant.commandHash
    || !sameWorkspace(workspace, grant.workspace)
    || grant.provider.registrationIdentity !== provider.registrationIdentity
    || grant.provider.resolvedExecutable !== provider.resolvedExecutable
    || grant.provider.executable !== provider.executable
    || grant.provider.executableContentIdentity.sha256
      !== (provider.executableContentIdentity as { sha256?: unknown })?.sha256
    || grant.provider.executableContentIdentity.sizeBytes
      !== (provider.executableContentIdentity as { sizeBytes?: unknown })?.sizeBytes
    || !Array.isArray(provider.fixedArgs)
    || grant.provider.fixedArgs.length !== provider.fixedArgs.length
    || !sameStringArray(grant.provider.fixedArgs, provider.fixedArgs)
    || grant.invocation.executable !== invocation.executable
    || grant.invocation.shell !== invocation.shell
    || !sameStringArray(grant.invocation.argv, invocation.argv as string[])
    || !sameEnvironment(grant.environment, effectiveEnvironment.entries as {
      name: string;
      value: string;
    }[])
  ) {
    invalidPreflight('Agent Shell execution binding 与 grant 不匹配');
  }
  expectedBinding(preparation);
  return workspace;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function stablePreflightError(error: unknown, fallback: string): never {
  if (isAbortError(error)) throw error;
  throw new Error(fallback);
}

export function createAgentShellSpawnPreflight(
  options: CreateAgentShellSpawnPreflightOptions,
) {
  if (!options?.workspaceStore) throw new Error('Agent Shell spawn preflight 缺少 workspace');
  if (!options?.bindingResolver?.resolveCurrentBinding) {
    throw new Error('Agent Shell spawn preflight 缺少 binding resolver');
  }
  const observationWindowMs = Number(
    options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS,
  );
  if (
    !Number.isSafeInteger(observationWindowMs)
    || observationWindowMs < 0
    || observationWindowMs > MAX_OBSERVATION_WINDOW_MS
  ) {
    throw new Error('Agent Shell spawn preflight 观察窗口无效');
  }
  const createWatcher = options.createWatcher || createDefaultWatcher;

  async function assertReady(input: AgentShellSpawnPreflightInput): Promise<AgentShellExecutionLeaseGrant> {
    abortIfNeeded(input.signal);
    const expectedWorkspace = assertGrantMatchesPreparation(input);
    const watcher = createWatcher(workspaceRootPath(expectedWorkspace), () => undefined);
    try {
      const expectedBindingSnapshot = expectedBinding(input.preparation);
      let currentBinding: AgentShellSpawnPreflightCurrentBinding;
      try {
        currentBinding = await options.bindingResolver.resolveCurrentBinding({
          owner: input.owner,
          preparation: input.preparation,
          signal: input.signal,
        });
      } catch (error) {
        stablePreflightError(error, 'Agent Shell execution binding 无法确认');
      }
      assertCurrentBinding(expectedBindingSnapshot, currentBinding);
      let firstWorkspace: AgentShellWorkspacePreparationContext;
      try {
        firstWorkspace = await options.workspaceStore.resolvePreparationContext(
          input.workspaceId,
          expectedWorkspace.logicalCwd,
          expectedWorkspace.runId,
          input.owner,
          input.signal,
        );
      } catch (error) {
        stablePreflightError(error, 'Agent Shell workspace 无法确认');
      }
      if (!sameWorkspace(expectedWorkspace, firstWorkspace) || watcher.changed()) {
        invalidPreflight('Agent Shell workspace 在 spawn 前已变化');
      }
      await waitForObservationWindow(observationWindowMs, input.signal);
      abortIfNeeded(input.signal);
      if (watcher.changed()) invalidPreflight('Agent Shell workspace 在 spawn 前已变化');
      let finalWorkspace: AgentShellWorkspacePreparationContext;
      try {
        finalWorkspace = await options.workspaceStore.resolvePreparationContext(
          input.workspaceId,
          expectedWorkspace.logicalCwd,
          expectedWorkspace.runId,
          input.owner,
          input.signal,
        );
      } catch (error) {
        stablePreflightError(error, 'Agent Shell workspace 无法确认');
      }
      if (!sameWorkspace(expectedWorkspace, finalWorkspace) || watcher.changed()) {
        invalidPreflight('Agent Shell workspace 在 spawn 前已变化');
      }
      let finalBinding: AgentShellSpawnPreflightCurrentBinding;
      try {
        finalBinding = await options.bindingResolver.resolveCurrentBinding({
          owner: input.owner,
          preparation: input.preparation,
          signal: input.signal,
        });
      } catch (error) {
        stablePreflightError(error, 'Agent Shell execution binding 无法确认');
      }
      assertCurrentBinding(expectedBindingSnapshot, finalBinding);
      if (input.grant.expiresAt <= Date.now()) {
        invalidPreflight('Agent Shell execution grant 已过期');
      }
      return input.grant;
    } finally {
      try {
        watcher.close();
      } catch {
        // Watcher cleanup cannot change the spawn decision or leak raw errors.
      }
    }
  }

  return Object.freeze({ assertReady });
}

export type AgentShellSpawnPreflight = ReturnType<typeof createAgentShellSpawnPreflight>;

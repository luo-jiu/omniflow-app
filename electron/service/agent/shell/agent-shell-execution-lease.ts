import crypto from 'node:crypto';

import {
  type AgentShellPreparedActionPublicV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import { normalizeAgentOwnerScope } from '../../../../src/shared/agent/agent-owner-scope';
import type {
  AgentToolMainPreparedExecution,
} from '../agent-tool-registry';
import {
  createAgentShellCommandHash,
  validateAgentShellPreparedActionCommandHashV1,
} from './agent-shell-prepared-action';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePreparationContext,
  AgentShellWorkspaceStore,
} from './agent-shell-workspace-store';

const DEFAULT_LEASE_TTL_MS = 15_000;
const MAX_LEASE_TTL_MS = 60_000;
const MAX_LEASE_ID_LENGTH = 200;
const IDENTITY_PATTERN = /^v[1-9]\d*:[a-f0-9]{64}$/u;
const HEX_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const AGENT_SHELL_EXECUTION_LEASE_TOKEN = Symbol('omniflow.agent.shell.execution-lease');
const AGENT_SHELL_EXECUTION_LEASE_GRANT = Symbol('omniflow.agent.shell.execution-lease-grant');

/** Opaque main-only token. Renderer and model inputs must never receive it. */
export type AgentShellExecutionLeaseToken = Readonly<{
  [AGENT_SHELL_EXECUTION_LEASE_TOKEN]: true;
}>;

/** Main-only brand attached after an active lease has been consumed. */
export type AgentShellExecutionLeaseGrantBrand = Readonly<{
  [AGENT_SHELL_EXECUTION_LEASE_GRANT]: true;
}>;

export interface AgentShellExecutionLeaseRequest {
  readonly owner: AgentShellWorkspaceOwner;
  readonly preparation: AgentToolMainPreparedExecution;
  readonly runCapabilityIdentity: string;
  readonly signal?: AbortSignal;
  readonly toolRunId: string;
  readonly workspaceId: string;
}

export interface AgentShellExecutionLease {
  readonly commandHash: string;
  readonly expiresAt: number;
  readonly generation: number;
  readonly leaseId: string;
  readonly preparedActionId: string;
  readonly token: AgentShellExecutionLeaseToken;
  readonly workspaceContentIdentity: string;
  readonly workspaceId: string;
}

export interface AgentShellExecutionLeaseGrant extends AgentShellExecutionLeaseGrantBrand {
  readonly command: string;
  readonly commandHash: string;
  readonly cwdPath: string;
  readonly environment: readonly { name: string; value: string }[];
  readonly expiresAt: number;
  readonly timeoutMs: number;
  readonly invocation: {
    readonly argv: readonly string[];
    readonly executable: string;
    readonly shell: false;
  };
  readonly leaseId: string;
  readonly provider: {
    readonly executable: string;
    readonly executableContentIdentity: {
      readonly sha256: string;
      readonly sizeBytes: number;
    };
    readonly fixedArgs: readonly string[];
    readonly registrationIdentity: string;
    readonly resolvedExecutable: string;
  };
  readonly token: AgentShellExecutionLeaseToken;
  readonly workspace: AgentShellWorkspacePreparationContext;
}

export function isAgentShellExecutionLeaseGrant(
  value: unknown,
): value is AgentShellExecutionLeaseGrant {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Record<PropertyKey, unknown>)[AGENT_SHELL_EXECUTION_LEASE_GRANT] === true,
  );
}

export interface AgentShellExecutionLeaseWorkspaceReader {
  readonly resolvePreparationContext: AgentShellWorkspaceStore['resolvePreparationContext'];
}

export interface CreateAgentShellExecutionLeaseManagerOptions {
  readonly createId?: () => string;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly workspaceStore: AgentShellExecutionLeaseWorkspaceReader;
}

interface LeaseRecord {
  readonly command: string;
  readonly commandHash: string;
  readonly environment: readonly { name: string; value: string }[];
  readonly expiresAt: number;
  readonly identity: AgentToolMainPreparedExecution['identity'];
  readonly invocation: AgentShellExecutionLeaseGrant['invocation'];
  readonly leaseId: string;
  readonly preparation: AgentToolMainPreparedExecution;
  readonly provider: AgentShellExecutionLeaseGrant['provider'];
  readonly token: AgentShellExecutionLeaseToken;
  readonly workspace: AgentShellWorkspacePreparationContext;
  state: 'active' | 'consuming';
}

function invalidLease(message = 'Agent Shell execution lease 无效'): never {
  throw new Error(message);
}

function requireString(
  value: unknown,
  label: string,
  pattern?: RegExp,
  maximum = 4_096,
): string {
  if (
    typeof value !== 'string'
    || !value
    || value.length > maximum
    || value.includes('\0')
  ) invalidLease(`${label}无效`);
  if (pattern && !pattern.test(value)) invalidLease(`${label}无效`);
  return value;
}

function requireIdentity(value: unknown, label: string): string {
  return requireString(value, label, IDENTITY_PATTERN);
}

function requireHexHash(value: unknown, label: string): string {
  return requireString(value, label, HEX_HASH_PATTERN);
}

function requireSha256Hash(value: unknown, label: string): string {
  return requireString(value, label, SHA256_HASH_PATTERN);
}

function requireSafeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalidLease(`${label}无效`);
  return value as number;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidLease(`${label}无效`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidLease(`${label}无效`);
  return value as Record<string, unknown>;
}

function sameOwner(left: AgentShellWorkspaceOwner, right: AgentShellWorkspaceOwner): boolean {
  return left.accountScope === right.accountScope
    && left.backendScope === right.backendScope
    && left.sessionId === right.sessionId;
}

function normalizeExpectedOwner(input: AgentShellWorkspaceOwner): AgentShellWorkspaceOwner {
  const scope = normalizeAgentOwnerScope(input);
  return Object.freeze({
    ...scope,
    sessionId: requireString(input?.sessionId, 'Agent Shell Session ID'),
  });
}

function assertOwnerIdentity(
  identity: AgentToolMainPreparedExecution['identity'],
  owner: AgentShellWorkspaceOwner,
): void {
  const identityOwner = normalizeExpectedOwner({
    ...identity.ownerScope,
    sessionId: identity.sessionId,
  });
  if (!sameOwner(identityOwner, owner)) invalidLease('Agent Shell execution owner 不匹配');
}

function assertWorkspaceUnchanged(
  expected: AgentShellWorkspacePreparationContext,
  current: AgentShellWorkspacePreparationContext,
): void {
  if (
    expected.workspaceId !== current.workspaceId
    || expected.runId !== current.runId
    || expected.generation !== current.generation
    || expected.workspaceContentIdentity !== current.workspaceContentIdentity
    || expected.workspaceMetadataIdentity !== current.workspaceMetadataIdentity
    || expected.workspaceContentScannerRevision !== current.workspaceContentScannerRevision
    || expected.logicalCwd !== current.logicalCwd
    || expected.physicalCwdPath !== current.physicalCwdPath
    || expected.physicalHomePath !== current.physicalHomePath
    || expected.physicalTempPath !== current.physicalTempPath
    || expected.workspaceEntryCount !== current.workspaceEntryCount
    || expected.workspaceTotalBytes !== current.workspaceTotalBytes
    || !sameOwner(expected.owner, current.owner)
  ) {
    invalidLease('Agent Shell workspace 在 spawn 前已变化');
  }
}

function normalizePreparedExecution(input: AgentToolMainPreparedExecution): {
  action: AgentShellPreparedActionPublicV1;
  binding: Record<string, unknown>;
  identity: AgentToolMainPreparedExecution['identity'];
} {
  if (!input || typeof input !== 'object') invalidLease('Agent Shell prepared execution 缺失');
  const action = validateAgentShellPreparedActionCommandHashV1(input.publicAction);
  const binding = plainObject(input.binding, 'Agent Shell prepared binding');
  const identity = input.identity;
  if (!identity || typeof identity !== 'object') invalidLease('Agent Shell prepared identity 缺失');
  requireString(identity.callId, 'Agent Shell call ID');
  requireString(identity.runId, 'Agent Shell Run ID');
  requireString(identity.sessionId, 'Agent Shell Session ID');
  requireString(identity.toolRunId, 'Agent Shell ToolRun ID');
  requireString(identity.preparedActionId, 'Agent Shell prepared action ID');
  requireString(input.preparedActionId, 'Agent Shell prepared action ID');
  requireSha256Hash(input.snapshotHash, 'Agent Shell prepared snapshot hash');
  if (input.preparedActionId !== identity.preparedActionId) {
    invalidLease('Agent Shell prepared action identity 不匹配');
  }
  requireString(identity.toolName, 'Agent Shell Tool 名称');
  requireString(identity.toolRegistrationId, 'Agent Shell Tool registration identity');
  requireIdentity(identity.runCapabilityIdentity, 'Agent Shell Run capability identity');
  requireIdentity(identity.aiDestinationIdentity, 'Agent Shell AI destination identity');
  requireSafeInteger(identity.libraryId, 'Agent Shell library ID', 1);
  if (action.aiDestination.identityHash !== identity.aiDestinationIdentity) {
    invalidLease('Agent Shell AI destination identity 不匹配');
  }
  return { action, binding, identity };
}

function extractBinding(input: {
  action: AgentShellPreparedActionPublicV1;
  binding: Record<string, unknown>;
  identity: AgentToolMainPreparedExecution['identity'];
}): Omit<LeaseRecord, 'expiresAt' | 'leaseId' | 'preparation' | 'token' | 'state'> {
  const workspace = plainObject(
    input.binding.workspace,
    'Agent Shell workspace binding',
  ) as unknown as AgentShellWorkspacePreparationContext;
  const workspaceOwner = normalizeExpectedOwner(workspace.owner);
  const provider = plainObject(input.binding.provider, 'Agent Shell Provider binding');
  const providerIdentity = plainObject(
    provider.executableContentIdentity,
    'Agent Shell Provider executable identity',
  );
  const invocation = plainObject(input.binding.invocation, 'Agent Shell invocation') as {
    argv?: unknown;
    executable?: unknown;
    shell?: unknown;
  };
  if (!Array.isArray(invocation.argv) || invocation.argv.some(value => typeof value !== 'string')) {
    invalidLease('Agent Shell invocation argv 无效');
  }
  if (invocation.shell !== false) invalidLease('Agent Shell invocation 必须禁用 shell');
  const command = input.action.command;
  const commandHash = createAgentShellCommandHash(command);
  if (input.action.commandHash !== commandHash || provider.registrationIdentity === undefined) {
    invalidLease('Agent Shell command binding 不匹配');
  }
  if (input.binding.commandHash !== commandHash) invalidLease('Agent Shell command hash 不匹配');
  if (workspace.runId !== input.identity.runId || workspace.owner.sessionId !== input.identity.sessionId) {
    invalidLease('Agent Shell workspace identity 不匹配');
  }
  if (workspace.logicalCwd !== input.action.cwd.path) {
    invalidLease('Agent Shell workspace cwd 不匹配');
  }
  assertOwnerIdentity(input.identity, workspaceOwner);
  const analysis = plainObject(input.binding.analysis, 'Agent Shell analysis binding');
  requireIdentity(analysis.authorizationIdentity, 'Agent Shell authorization identity');
  requireIdentity(analysis.analysisIdentity, 'Agent Shell analysis identity');
  if (typeof analysis.workspaceBoundaryVerified !== 'boolean') {
    invalidLease('Agent Shell workspace boundary binding 无效');
  }
  requireString(provider.registrationIdentity, 'Agent Shell Provider registration identity');
  requireString(provider.resolvedExecutable, 'Agent Shell Provider resolved executable');
  requireString(provider.executable, 'Agent Shell Provider executable');
  requireHexHash(providerIdentity.sha256, 'Agent Shell Provider executable hash');
  requireSafeInteger(providerIdentity.sizeBytes, 'Agent Shell Provider executable size');
  if (!Array.isArray(provider.fixedArgs) || provider.fixedArgs.some(value => typeof value !== 'string')) {
    invalidLease('Agent Shell Provider fixed args 无效');
  }
  const effectiveEnvironment = plainObject(
    input.binding.effectiveEnvironment,
    'Agent Shell effective environment',
  );
  const environment = effectiveEnvironment.entries;
  if (!Array.isArray(environment) || environment.some(entry => {
    const value = plainObject(entry, 'Agent Shell environment entry');
    return typeof value.name !== 'string' || typeof value.value !== 'string';
  })) {
    invalidLease('Agent Shell effective environment 无效');
  }
  if (workspace.workspaceContentScannerRevision === undefined) {
    invalidLease('Agent Shell workspace scanner revision 缺失');
  }
  return {
    command,
    commandHash,
    environment: Object.freeze(
      (environment as Array<{ name: string; value: string }>).map(entry => (
        Object.freeze({ name: entry.name, value: entry.value })
      )),
    ),
    identity: input.identity,
    invocation: Object.freeze({
      argv: Object.freeze([...invocation.argv] as string[]),
      executable: requireString(invocation.executable, 'Agent Shell invocation executable'),
      shell: false,
    }),
    provider: Object.freeze({
      executable: provider.executable as string,
      executableContentIdentity: Object.freeze({
        sha256: providerIdentity.sha256 as string,
        sizeBytes: providerIdentity.sizeBytes as number,
      }),
      fixedArgs: Object.freeze([...(provider.fixedArgs as string[])]),
      registrationIdentity: provider.registrationIdentity as string,
      resolvedExecutable: provider.resolvedExecutable as string,
    }),
    workspace: Object.freeze(workspace),
  };
}

function createToken(): AgentShellExecutionLeaseToken {
  return Object.freeze({
    [AGENT_SHELL_EXECUTION_LEASE_TOKEN]: true,
  });
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Agent Shell execution lease 已取消');
  error.name = 'AbortError';
  throw error;
}

export function createAgentShellExecutionLeaseManager(
  options: CreateAgentShellExecutionLeaseManagerOptions,
) {
  if (!options?.workspaceStore) throw new Error('Agent Shell execution lease 缺少 workspace');
  const createId = options.createId || crypto.randomUUID;
  const now = options.now || Date.now;
  const ttlMs = Number(options.ttlMs ?? DEFAULT_LEASE_TTL_MS);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
    throw new Error('Agent Shell execution lease TTL 无效');
  }
  const leases = new Map<string, LeaseRecord>();

  function removeExpired(currentTime = now()): void {
    for (const [leaseId, record] of leases) {
      if (record.expiresAt <= currentTime) leases.delete(leaseId);
    }
  }

  async function revalidate(
    record: LeaseRecord,
    owner: AgentShellWorkspaceOwner,
    signal?: AbortSignal,
  ): Promise<void> {
    abortIfNeeded(signal);
    const current = await options.workspaceStore.resolvePreparationContext(
      record.workspace.workspaceId,
      record.workspace.logicalCwd,
      record.identity.runId,
      owner,
      signal,
    );
    abortIfNeeded(signal);
    assertWorkspaceUnchanged(record.workspace, current);
  }

  async function acquire(input: AgentShellExecutionLeaseRequest): Promise<AgentShellExecutionLease> {
    removeExpired();
    const { action, binding, identity } = normalizePreparedExecution(input.preparation);
    const owner = normalizeExpectedOwner(input.owner);
    if (identity.runCapabilityIdentity !== input.runCapabilityIdentity) {
      invalidLease('Agent Shell Run capability identity 不匹配');
    }
    if (identity.toolRunId !== input.toolRunId) invalidLease('Agent Shell ToolRun identity 不匹配');
    if (action.kind !== 'shell.run' || action.version !== 1) invalidLease('Agent Shell action 类型无效');
    if (action.cwd.kind !== 'run-workspace') invalidLease('Agent Shell cwd 类型无效');
    if (input.workspaceId !== (binding.workspace as AgentShellWorkspacePreparationContext).workspaceId) {
      invalidLease('Agent Shell workspace identity 不匹配');
    }
    const extracted = extractBinding({ action, binding, identity });
    if (!sameOwner(owner, extracted.workspace.owner)) invalidLease('Agent Shell workspace owner 不匹配');
    await revalidate({
      ...extracted,
      expiresAt: now() + ttlMs,
      leaseId: '',
      preparation: input.preparation,
      token: createToken(),
      state: 'active',
    }, owner, input.signal);
    const leaseId = requireString(
      createId(),
      'Agent Shell execution lease ID',
      undefined,
      MAX_LEASE_ID_LENGTH,
    );
    if (leases.has(leaseId)) invalidLease('Agent Shell execution lease ID 冲突');
    const expiresAt = now() + ttlMs;
    const record: LeaseRecord = {
      ...extracted,
      expiresAt,
      identity,
      leaseId,
      preparation: input.preparation,
      token: createToken(),
      state: 'active',
    };
    leases.set(leaseId, record);
    return Object.freeze({
      commandHash: record.commandHash,
      expiresAt,
      generation: record.workspace.generation,
      leaseId,
      preparedActionId: identity.preparedActionId,
      token: record.token,
      workspaceContentIdentity: record.workspace.workspaceContentIdentity,
      workspaceId: record.workspace.workspaceId,
    });
  }

  async function consume(
    lease: AgentShellExecutionLease,
    owner: AgentShellWorkspaceOwner,
    signal?: AbortSignal,
  ): Promise<AgentShellExecutionLeaseGrant> {
    removeExpired();
    const leaseId = requireString(lease?.leaseId, 'Agent Shell execution lease ID');
    const record = leases.get(leaseId);
    if (!record || record.token !== lease.token) invalidLease('Agent Shell execution lease 不存在或已失效');
    if (record.state !== 'active') invalidLease('Agent Shell execution lease 正在消费或已失效');
    if (record.expiresAt <= now()) {
      leases.delete(leaseId);
      invalidLease('Agent Shell execution lease 已过期');
    }
    if (!sameOwner(owner, record.workspace.owner)) invalidLease('Agent Shell execution owner 不匹配');
    record.state = 'consuming';
    try {
      await revalidate(record, owner, signal);
    } catch (error) {
      leases.delete(leaseId);
      throw error;
    }
    leases.delete(leaseId);
    const timeoutMs = record.preparation.publicAction.kind === 'shell.run'
      ? record.preparation.publicAction.timeoutMs
      : undefined;
    if (timeoutMs === undefined) invalidLease('Agent Shell execution action timeout 缺失');
    return Object.freeze({
      [AGENT_SHELL_EXECUTION_LEASE_GRANT]: true as const,
      command: record.command,
      commandHash: record.commandHash,
      cwdPath: record.workspace.physicalCwdPath,
      environment: record.environment,
      expiresAt: record.expiresAt,
      timeoutMs,
      invocation: record.invocation,
      leaseId: record.leaseId,
      provider: record.provider,
      token: record.token,
      workspace: record.workspace,
    });
  }

  function release(lease: AgentShellExecutionLease): boolean {
    removeExpired();
    const leaseId = requireString(lease?.leaseId, 'Agent Shell execution lease ID');
    const record = leases.get(leaseId);
    if (!record || record.token !== lease.token || record.state !== 'active') return false;
    leases.delete(leaseId);
    return true;
  }

  return Object.freeze({
    acquire,
    consume,
    getActiveCount: () => {
      removeExpired();
      return leases.size;
    },
    release,
  });
}

export type AgentShellExecutionLeaseManager = ReturnType<
  typeof createAgentShellExecutionLeaseManager
>;

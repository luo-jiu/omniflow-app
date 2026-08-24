import crypto from 'node:crypto';

import { normalizeAgentOwnerScope } from '../../../../src/shared/agent/agent-owner-scope';
import type {
  AgentCapabilityDefinition,
  AgentCapabilityProbeContext,
  AgentCapabilityProbeResult,
  AgentCapabilitySnapshot,
  AgentCapabilitySnapshotEntry,
  AgentCapabilitySnapshotRequest,
} from './agent-capability.types';

const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const CAPABILITY_REVISION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._:+@-]*$/u;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAX_CAPABILITY_ID_LENGTH = 128;
const MAX_CAPABILITY_REVISION_LENGTH = 128;
const MAX_REASON_CODE_LENGTH = 128;
const MAX_PROBE_TIMEOUT_MS = 30_000;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const PROBE_FAILED_REASON = 'capability.probe_failed';
const PROBE_INVALID_RESULT_REASON = 'capability.invalid_result';
const PROBE_TIMEOUT_REASON = 'capability.probe_timeout';

interface NormalizedCapabilityDefinition extends AgentCapabilityDefinition {}

interface CachedCapabilityResult {
  readonly entry: AgentCapabilitySnapshotEntry;
  readonly expiresAt: number;
  readonly generation: number;
}

interface CapabilityScopeContext {
  readonly capabilityId: string;
  readonly libraryId: number;
  readonly ownerScope: ReturnType<typeof normalizeAgentOwnerScope>;
  readonly scope: NormalizedCapabilityDefinition['scope'];
}

interface InFlightCapabilityProbe {
  readonly controller: AbortController;
  readonly generation: number;
  readonly promise: Promise<AgentCapabilitySnapshotEntry>;
  readonly scopeContext: CapabilityScopeContext;
}

export interface AgentCapabilityInvalidation {
  readonly capabilityId?: string;
  readonly libraryId?: number;
  readonly ownerScope?: AgentCapabilitySnapshotRequest['ownerScope'];
}

export interface AgentCapabilityRegistryOptions {
  readonly now?: () => number;
}

function abortError(): Error {
  const error = new Error('Agent Capability 探测已取消');
  error.name = 'AbortError';
  return error;
}

function normalizeIdentifier(
  value: unknown,
  label: string,
  pattern: RegExp,
  maximumLength: number,
): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximumLength || !pattern.test(normalized)) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizePositiveInteger(
  value: unknown,
  label: string,
  maximum: number,
): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > maximum) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizeDefinition(input: AgentCapabilityDefinition): NormalizedCapabilityDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Agent Capability 定义无效');
  }
  const id = normalizeIdentifier(
    input.id,
    'Agent Capability ID',
    CAPABILITY_ID_PATTERN,
    MAX_CAPABILITY_ID_LENGTH,
  );
  const revision = normalizeIdentifier(
    input.revision,
    'Agent Capability revision',
    CAPABILITY_REVISION_PATTERN,
    MAX_CAPABILITY_REVISION_LENGTH,
  );
  if (!['library', 'machine', 'owner'].includes(input.scope)) {
    throw new Error(`Agent Capability scope 无效：${id}`);
  }
  if (typeof input.probe !== 'function') {
    throw new Error(`Agent Capability probe 无效：${id}`);
  }
  return Object.freeze({
    cacheTtlMs: normalizePositiveInteger(
      input.cacheTtlMs,
      `Agent Capability cache TTL（${id}）`,
      MAX_CACHE_TTL_MS,
    ),
    id,
    probe: input.probe,
    revision,
    scope: input.scope,
    timeoutMs: normalizePositiveInteger(
      input.timeoutMs,
      `Agent Capability timeout（${id}）`,
      MAX_PROBE_TIMEOUT_MS,
    ),
  });
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(',')}}`;
  }
  return 'null';
}

function hashIdentity(value: unknown): string {
  return crypto.createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}

function normalizeReasonCode(value: unknown, fallback: string): string {
  const normalized = String(value || '').trim();
  return normalized.length <= MAX_REASON_CODE_LENGTH && REASON_CODE_PATTERN.test(normalized)
    ? normalized
    : fallback;
}

function normalizeProbeResult(
  input: AgentCapabilityProbeResult,
  definition: NormalizedCapabilityDefinition,
  scopeIdentity: string,
  checkedAt: number,
): AgentCapabilitySnapshotEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return Object.freeze({
      checkedAt,
      definitionRevision: definition.revision,
      id: definition.id,
      reasonCode: PROBE_INVALID_RESULT_REASON,
      scopeIdentity,
      state: 'unknown',
    });
  }
  if (input.state === 'available') {
    return Object.freeze({
      checkedAt,
      definitionRevision: definition.revision,
      id: definition.id,
      scopeIdentity,
      state: 'available',
    });
  }
  if (input.state === 'unavailable' || input.state === 'unknown') {
    return Object.freeze({
      checkedAt,
      definitionRevision: definition.revision,
      id: definition.id,
      reasonCode: normalizeReasonCode(input.reasonCode, PROBE_INVALID_RESULT_REASON),
      scopeIdentity,
      state: input.state,
    });
  }
  return Object.freeze({
    checkedAt,
    definitionRevision: definition.revision,
    id: definition.id,
    reasonCode: PROBE_INVALID_RESULT_REASON,
    scopeIdentity,
    state: 'unknown',
  });
}

function createUnknownEntry(
  definition: NormalizedCapabilityDefinition,
  scopeIdentity: string,
  checkedAt: number,
  reasonCode: string,
): AgentCapabilitySnapshotEntry {
  return Object.freeze({
    checkedAt,
    definitionRevision: definition.revision,
    id: definition.id,
    reasonCode,
    scopeIdentity,
    state: 'unknown',
  });
}

function normalizeRequestContext(
  request: AgentCapabilitySnapshotRequest,
): Omit<AgentCapabilitySnapshotRequest, 'capabilityIds'> {
  const libraryId = Number(request.libraryId);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    throw new Error('Agent Capability 资料库 scope 无效');
  }
  if (!request.signal || typeof request.signal.aborted !== 'boolean') {
    throw new Error('Agent Capability AbortSignal 无效');
  }
  return {
    libraryId,
    ownerScope: normalizeAgentOwnerScope(request.ownerScope),
    signal: request.signal,
  };
}

function scopePayload(
  definition: NormalizedCapabilityDefinition,
  context: Omit<AgentCapabilitySnapshotRequest, 'capabilityIds' | 'signal'>,
): unknown {
  if (definition.scope === 'machine') return { scope: 'machine' };
  if (definition.scope === 'owner') {
    return { ownerScope: context.ownerScope, scope: 'owner' };
  }
  return {
    libraryId: context.libraryId,
    ownerScope: context.ownerScope,
    scope: 'library',
  };
}

export function createAgentCapabilitySnapshot(input: {
  readonly entries?: readonly AgentCapabilitySnapshotEntry[];
  readonly registryRevision?: number;
} = {}): AgentCapabilitySnapshot {
  const registryRevision = Number(input.registryRevision || 0);
  if (!Number.isInteger(registryRevision) || registryRevision < 0) {
    throw new Error('Agent Capability Registry revision 无效');
  }
  const entries = Object.freeze([...(input.entries || [])]
    .map(entry => Object.freeze({ ...entry }))
    .sort((left, right) => left.id.localeCompare(right.id)));
  const byId = new Map<string, AgentCapabilitySnapshotEntry>();
  for (const entry of entries) {
    const id = normalizeIdentifier(
      entry.id,
      'Agent Capability Snapshot ID',
      CAPABILITY_ID_PATTERN,
      MAX_CAPABILITY_ID_LENGTH,
    );
    if (byId.has(id)) throw new Error(`Agent Capability Snapshot 包含重复 ID：${id}`);
    if (!['available', 'unavailable', 'unknown'].includes(entry.state)) {
      throw new Error(`Agent Capability Snapshot 状态无效：${id}`);
    }
    byId.set(id, entry);
  }
  const identity = `v1:${hashIdentity({
    entries: entries.map(entry => ({
      definitionRevision: entry.definitionRevision,
      id: entry.id,
      reasonCode: entry.reasonCode || null,
      scopeIdentity: entry.scopeIdentity,
      state: entry.state,
    })),
    registryRevision,
  })}`;
  return Object.freeze({
    entries,
    get: (capabilityId: string) => byId.get(String(capabilityId || '').trim()) || null,
    identity,
    list: () => entries,
    registryRevision,
  });
}

function waitForCaller<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      value => {
        cleanup();
        resolve(value);
      },
      error => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function createAgentCapabilityRegistry(
  initialDefinitions: readonly AgentCapabilityDefinition[] = [],
  options: AgentCapabilityRegistryOptions = {},
) {
  const definitions = new Map<string, NormalizedCapabilityDefinition>();
  const cache = new Map<string, CachedCapabilityResult>();
  const generations = new Map<string, number>();
  const inFlight = new Map<string, InFlightCapabilityProbe>();
  const scopeContexts = new Map<string, CapabilityScopeContext>();
  const now = options.now || Date.now;
  let registryRevision = 0;

  function register(input: AgentCapabilityDefinition): void {
    const definition = normalizeDefinition(input);
    if (definitions.has(definition.id)) {
      throw new Error(`Agent Capability 已注册：${definition.id}`);
    }
    definitions.set(definition.id, definition);
    registryRevision += 1;
  }

  function get(capabilityId: string): AgentCapabilityDefinition | null {
    return definitions.get(String(capabilityId || '').trim()) || null;
  }

  function list(): readonly AgentCapabilityDefinition[] {
    return Object.freeze(Array.from(definitions.values()).sort((left, right) => (
      left.id.localeCompare(right.id)
    )));
  }

  function resolveScope(
    definition: NormalizedCapabilityDefinition,
    context: Omit<AgentCapabilitySnapshotRequest, 'capabilityIds' | 'signal'>,
  ): { cacheKey: string; scopeContext: CapabilityScopeContext; scopeIdentity: string } {
    const payload = scopePayload(definition, context);
    const scopeIdentity = hashIdentity(payload);
    const cacheKey = `${definition.id}@${definition.revision}:${scopeIdentity}`;
    return {
      cacheKey,
      scopeContext: {
        capabilityId: definition.id,
        libraryId: context.libraryId,
        ownerScope: context.ownerScope,
        scope: definition.scope,
      },
      scopeIdentity,
    };
  }

  function startProbe(
    definition: NormalizedCapabilityDefinition,
    context: Omit<AgentCapabilitySnapshotRequest, 'capabilityIds'>,
    cacheKey: string,
    scopeIdentity: string,
    scopeContext: CapabilityScopeContext,
    generation: number,
  ): InFlightCapabilityProbe {
    const controller = new AbortController();
    const probeContext: AgentCapabilityProbeContext = {
      libraryId: context.libraryId,
      ownerScope: context.ownerScope,
      signal: controller.signal,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AgentCapabilitySnapshotEntry>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(createUnknownEntry(
          definition,
          scopeIdentity,
          now(),
          PROBE_TIMEOUT_REASON,
        ));
      }, definition.timeoutMs);
      timer.unref?.();
    });
    const probe = Promise.resolve()
      .then(() => definition.probe(probeContext))
      .then(result => normalizeProbeResult(result, definition, scopeIdentity, now()))
      .catch(() => createUnknownEntry(
        definition,
        scopeIdentity,
        now(),
        PROBE_FAILED_REASON,
      ));
    const promise = Promise.race([probe, timeout]).then((entry) => {
      if (timer) clearTimeout(timer);
      if ((generations.get(cacheKey) || 0) === generation) {
        cache.set(cacheKey, {
          entry,
          expiresAt: entry.checkedAt + definition.cacheTtlMs,
          generation,
        });
      }
      return entry;
    }).finally(() => {
      const current = inFlight.get(cacheKey);
      if (current?.generation === generation) inFlight.delete(cacheKey);
    });
    const task = { controller, generation, promise, scopeContext };
    inFlight.set(cacheKey, task);
    scopeContexts.set(cacheKey, scopeContext);
    return task;
  }

  async function resolveCapability(
    definition: NormalizedCapabilityDefinition,
    context: Omit<AgentCapabilitySnapshotRequest, 'capabilityIds'>,
  ): Promise<AgentCapabilitySnapshotEntry> {
    const { cacheKey, scopeContext, scopeIdentity } = resolveScope(definition, context);
    for (;;) {
      if (context.signal.aborted) throw abortError();
      const generation = generations.get(cacheKey) || 0;
      const cached = cache.get(cacheKey);
      if (cached && cached.generation === generation && cached.expiresAt > now()) {
        return cached.entry;
      }
      if (cached) cache.delete(cacheKey);
      const active = inFlight.get(cacheKey);
      const task = active?.generation === generation
        ? active
        : startProbe(
            definition,
            context,
            cacheKey,
            scopeIdentity,
            scopeContext,
            generation,
          );
      const entry = await waitForCaller(task.promise, context.signal);
      if ((generations.get(cacheKey) || 0) === generation) return entry;
    }
  }

  async function createSnapshot(
    request: AgentCapabilitySnapshotRequest,
  ): Promise<AgentCapabilitySnapshot> {
    const context = normalizeRequestContext(request);
    if (context.signal.aborted) throw abortError();
    const capabilityIds = Array.from(new Set((request.capabilityIds || []).map((value) => (
      normalizeIdentifier(
        value,
        'Agent Capability 请求 ID',
        CAPABILITY_ID_PATTERN,
        MAX_CAPABILITY_ID_LENGTH,
      )
    )))).sort((left, right) => left.localeCompare(right));
    const capturedDefinitions = capabilityIds.map((capabilityId) => {
      const definition = definitions.get(capabilityId);
      if (!definition) throw new Error(`Agent Capability 未注册：${capabilityId}`);
      return definition;
    });
    const capturedRevision = registryRevision;
    const entries = await Promise.all(capturedDefinitions.map(definition => (
      resolveCapability(definition, context)
    )));
    if (context.signal.aborted) throw abortError();
    return createAgentCapabilitySnapshot({ entries, registryRevision: capturedRevision });
  }

  function matchesInvalidation(
    scopeContext: CapabilityScopeContext,
    invalidation: AgentCapabilityInvalidation,
  ): boolean {
    if (
      invalidation.capabilityId
      && scopeContext.capabilityId !== String(invalidation.capabilityId || '').trim()
    ) return false;
    if (
      invalidation.libraryId !== undefined
      && (scopeContext.scope !== 'library'
        || scopeContext.libraryId !== Number(invalidation.libraryId))
    ) return false;
    if (invalidation.ownerScope) {
      if (scopeContext.scope === 'machine') return false;
      const ownerScope = normalizeAgentOwnerScope(invalidation.ownerScope);
      if (
        scopeContext.ownerScope.accountScope !== ownerScope.accountScope
        || scopeContext.ownerScope.backendScope !== ownerScope.backendScope
      ) return false;
    }
    return true;
  }

  function invalidate(invalidation: AgentCapabilityInvalidation = {}): void {
    for (const [cacheKey, scopeContext] of scopeContexts) {
      if (!matchesInvalidation(scopeContext, invalidation)) continue;
      generations.set(cacheKey, (generations.get(cacheKey) || 0) + 1);
      cache.delete(cacheKey);
      inFlight.get(cacheKey)?.controller.abort();
    }
  }

  initialDefinitions.forEach(register);

  return {
    createSnapshot,
    get,
    invalidate,
    list,
    register,
  };
}

export type AgentCapabilityRegistry = ReturnType<typeof createAgentCapabilityRegistry>;

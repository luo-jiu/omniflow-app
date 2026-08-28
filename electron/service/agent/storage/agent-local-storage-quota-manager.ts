import crypto from 'node:crypto';

import {
  normalizeAgentOwnerScope,
} from '../../../../src/shared/agent/agent-owner-scope';
import type { AgentOwnerScope } from '../../../../src/shared/agent/agent.types';

const DEFAULT_MAX_SINGLE_RESOURCE_BYTES = 2 * 1024 * 1024 * 1024;
// Four maximum-sized resources keep the default aligned with the Agent
// architecture contract: 2 GiB per resource and 8 GiB in total.
const DEFAULT_MAX_TOTAL_BYTES = 4 * DEFAULT_MAX_SINGLE_RESOURCE_BYTES;
const DEFAULT_MAX_RESOURCE_COUNT = 4_096;
const DEFAULT_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CATEGORY_LENGTH = 64;
const MAX_RUN_ID_LENGTH = 200;
const MAX_RESOURCE_REF_LENGTH = 256;
const MAX_ADAPTER_ID_LENGTH = 128;

export const AGENT_LOCAL_STORAGE_DEFAULT_MAX_SINGLE_RESOURCE_BYTES =
  DEFAULT_MAX_SINGLE_RESOURCE_BYTES;
export const AGENT_LOCAL_STORAGE_DEFAULT_MAX_TOTAL_BYTES = DEFAULT_MAX_TOTAL_BYTES;

export type AgentLocalStorageQuotaOwner = AgentOwnerScope;

export type AgentLocalStorageQuotaState =
  | 'reserved'
  | 'bound'
  | 'committed'
  | 'deleting';

export interface AgentLocalStorageResourceAdapter {
  remove: (resourceRef: string) => Promise<void>;
}

export interface AgentLocalStorageQuotaLease {
  expiresAt: number;
  leaseId: string;
  resourceRef: string;
}

export interface AgentLocalStorageQuotaLimits {
  maxCategoryBytes?: number | Record<string, number>;
  maxResourceCount?: number;
  maxRunBytes?: number | Record<string, number>;
  maxSingleResourceBytes?: number;
  maxTotalBytes?: number;
  minFreeBytes?: number;
}

export interface AgentLocalStorageQuotaManagerOptions
  extends AgentLocalStorageQuotaLimits {
  adapters?: Record<string, AgentLocalStorageResourceAdapter>;
  createId?: () => string;
  getAvailableDiskBytes?: () => Promise<number> | number;
  maxTtlMs?: number;
  now?: () => number;
  persistence?: AgentLocalStorageQuotaPersistence;
}

export interface AgentLocalStorageQuotaPersistedRecord {
  accountScope: string;
  adapterId: string;
  actualBytes: number | null;
  backendScope: string;
  category: string;
  createdAt: number;
  expectedBytes: number;
  expiresAt: number;
  id: string;
  lastErrorCode?: 'adapter_unavailable' | 'live_lease' | 'remove_failed';
  lastTouchedAt: number;
  occupancyUnknown?: boolean;
  resourceRef?: string;
  runId: string;
  state: AgentLocalStorageQuotaState;
}

/** Durable state is deliberately replaced in one transaction by the adapter. */
export interface AgentLocalStorageQuotaPersistence {
  load: () => Promise<AgentLocalStorageQuotaPersistedRecord[]>;
  replace: (records: AgentLocalStorageQuotaPersistedRecord[]) => Promise<void>;
  close?: () => Promise<void>;
}

export interface AgentLocalStorageQuotaReservation {
  accountScope: string;
  adapterId: string;
  actualBytes: number | null;
  backendScope: string;
  category: string;
  createdAt: number;
  expectedBytes: number;
  expiresAt: number;
  id: string;
  lastTouchedAt: number;
  resourceRef?: string;
  runId: string;
  state: AgentLocalStorageQuotaState;
}

export interface AgentLocalStorageQuotaUsage {
  byCategory: Record<string, number>;
  byRun: Record<string, number>;
  resourceCount: number;
  totalBytes: number;
}

export interface AgentLocalStorageQuotaReleaseResult {
  released: boolean;
  state: 'deleting' | 'not_found' | 'released';
}

export type AgentLocalStorageQuotaObservedBytes = number | 'unknown';

export interface AgentLocalStorageQuotaSweepResult {
  attempted: number;
  failed: number;
  reason: string;
  released: number;
}

interface QuotaRecord {
  accountScope: string;
  adapterId: string;
  backendScope: string;
  category: string;
  createdAt: number;
  expectedBytes: number;
  expiresAt: number;
  id: string;
  lastErrorCode?: 'adapter_unavailable' | 'live_lease' | 'remove_failed';
  lastTouchedAt: number;
  occupancyUnknown: boolean;
  resourceRef?: string;
  runId: string;
  state: AgentLocalStorageQuotaState;
  actualBytes: number | null;
  liveLeaseIds: Set<string>;
}

interface UnreconciledDeletionIntent {
  conservativeBytes: number;
  occupancyUnknown: boolean;
  owner: AgentLocalStorageQuotaOwner;
  reservationId: string;
}

interface ReleaseTarget {
  owner: AgentLocalStorageQuotaOwner;
  reservationId: string;
  resourceRef: string;
}

interface ActiveReleaseOperation {
  observation: {
    flushPromise: Promise<boolean> | null;
    observedBytes?: AgentLocalStorageQuotaObservedBytes;
    persistedRevision: number;
    revision: number;
    sealed: boolean;
  };
  promise: Promise<AgentLocalStorageQuotaReleaseResult>;
  target: ReleaseTarget;
}

function normalizeString(
  value: unknown,
  label: string,
  maximum: number,
  pattern?: RegExp,
): string {
  const normalized = String(value ?? '').trim();
  if (
    !normalized
    || normalized.length > maximum
    || normalized.includes('\u0000')
    || (pattern && !pattern.test(normalized))
  ) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizeOwner(owner: AgentLocalStorageQuotaOwner): AgentLocalStorageQuotaOwner {
  return normalizeAgentOwnerScope(owner);
}

function normalizeBytes(value: unknown, label: string): number {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`${label}无效`);
  }
  return bytes;
}

function normalizeLimit(value: unknown, label: string, fallback: number): number {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error(`${label}无效`);
  }
  return limit;
}

function normalizeTtl(value: unknown, maxTtlMs: number): number {
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > maxTtlMs) {
    throw new Error('Agent 配额 TTL 无效');
  }
  return ttl;
}

function normalizeLimitMap(
  value: number | Record<string, number> | undefined,
  label: string,
  keyMaximum: number,
): { defaultLimit?: number; limits: Map<string, number> } {
  if (value === undefined) return { limits: new Map() };
  if (typeof value === 'number') {
    return { defaultLimit: normalizeLimit(value, label, 0), limits: new Map() };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}无效`);
  }
  const limits = new Map<string, number>();
  for (const [key, limit] of Object.entries(value)) {
    const normalizedKey = normalizeString(key, `${label}键`, keyMaximum);
    limits.set(normalizedKey, normalizeLimit(limit, label, 0));
  }
  return { limits };
}

function normalizeErrorCode(error: unknown): 'remove_failed' {
  void error;
  return 'remove_failed';
}

function cloneReservation(record: QuotaRecord): AgentLocalStorageQuotaReservation {
  return {
    accountScope: record.accountScope,
    adapterId: record.adapterId,
    actualBytes: record.actualBytes,
    backendScope: record.backendScope,
    category: record.category,
    createdAt: record.createdAt,
    expectedBytes: record.expectedBytes,
    expiresAt: record.expiresAt,
    id: record.id,
    lastTouchedAt: record.lastTouchedAt,
    ...(record.resourceRef ? { resourceRef: record.resourceRef } : {}),
    runId: record.runId,
    state: record.state,
  };
}

function clonePersistedRecord(record: QuotaRecord): AgentLocalStorageQuotaPersistedRecord {
  return {
    accountScope: record.accountScope,
    adapterId: record.adapterId,
    actualBytes: record.actualBytes,
    backendScope: record.backendScope,
    category: record.category,
    createdAt: record.createdAt,
    expectedBytes: record.expectedBytes,
    expiresAt: record.expiresAt,
    id: record.id,
    ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
    lastTouchedAt: record.lastTouchedAt,
    occupancyUnknown: record.occupancyUnknown,
    ...(record.resourceRef ? { resourceRef: record.resourceRef } : {}),
    runId: record.runId,
    state: record.state,
  };
}

function sameOwner(
  record: QuotaRecord,
  owner: AgentLocalStorageQuotaOwner,
): boolean {
  return record.accountScope === owner.accountScope
    && record.backendScope === owner.backendScope;
}

function createIdFactory(createId?: () => string): () => string {
  return createId || crypto.randomUUID;
}

export function createAgentLocalStorageQuotaManager(
  options: AgentLocalStorageQuotaManagerOptions = {},
) {
  const createId = createIdFactory(options.createId);
  const now = options.now || Date.now;
  const maxTtlMs = normalizeLimit(options.maxTtlMs, 'Agent 配额最大 TTL', DEFAULT_MAX_TTL_MS);
  if (maxTtlMs <= 0) throw new Error('Agent 配额最大 TTL 无效');
  const maxSingleResourceBytes = normalizeLimit(
    options.maxSingleResourceBytes,
    'Agent 单文件配额',
    DEFAULT_MAX_SINGLE_RESOURCE_BYTES,
  );
  const maxTotalBytes = normalizeLimit(
    options.maxTotalBytes,
    'Agent 总配额',
    DEFAULT_MAX_TOTAL_BYTES,
  );
  const maxResourceCount = normalizeLimit(
    options.maxResourceCount,
    'Agent 配额资源数量',
    DEFAULT_MAX_RESOURCE_COUNT,
  );
  const minFreeBytes = normalizeLimit(options.minFreeBytes, 'Agent 低磁盘水位', 0);
  const categoryLimits = normalizeLimitMap(
    options.maxCategoryBytes,
    'Agent 分类配额',
    MAX_CATEGORY_LENGTH,
  );
  const runLimits = normalizeLimitMap(
    options.maxRunBytes,
    'Agent Run 配额',
    MAX_RUN_ID_LENGTH,
  );
  const adapters = new Map<string, AgentLocalStorageResourceAdapter>();
  for (const [adapterId, adapter] of Object.entries(options.adapters || {})) {
    const normalizedAdapterId = normalizeString(
      adapterId,
      'Agent 配额 adapter ID',
      MAX_ADAPTER_ID_LENGTH,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    );
    if (!adapter || typeof adapter.remove !== 'function') {
      throw new Error('Agent 配额 resource adapter 无效');
    }
    adapters.set(normalizedAdapterId, adapter);
  }

  const records = new Map<string, QuotaRecord>();
  const resourceIndex = new Map<string, string>();
  const issuedReservationIds = new Set<string>();
  const unknownOccupancyRecordIds = new Set<string>();
  const admissionBlocks = new Set<string>();
  const unreconciledDeletionIntents = new Map<string, UnreconciledDeletionIntent>();
  const admittedMultiPhaseOperations = new Set<Promise<unknown>>();
  const activeReleaseOperations = new Map<string, ActiveReleaseOperation>();
  const activeReleaseOperationsByResourceRef = new Map<string, ActiveReleaseOperation>();
  let tail = Promise.resolve();
  let closing = false;
  let closePromise: Promise<void> | null = null;

  function assertAdmissionOpen(): void {
    if (admissionBlocks.size > 0) {
      throw new Error('Agent 本机临时存储正在核对未登记的物理占用');
    }
    if (unreconciledDeletionIntents.size > 0) {
      throw new Error('Agent 配额账本存在尚未持久化的清理事实');
    }
    if (unknownOccupancyRecordIds.size > 0) {
      throw new Error('Agent 配额账本存在物理占用未知的清理资源');
    }
  }

  function rememberUnreconciledDeletionIntent(
    target: ReleaseTarget,
    conservativeBytes: number,
    occupancyUnknown: boolean,
  ): void {
    const existing = unreconciledDeletionIntents.get(target.resourceRef);
    if (existing && (
      existing.reservationId !== target.reservationId
      || existing.owner.accountScope !== target.owner.accountScope
      || existing.owner.backendScope !== target.owner.backendScope
    )) {
      throw new Error('Agent 配额清理意图资源身份冲突');
    }
    unreconciledDeletionIntents.set(target.resourceRef, {
      conservativeBytes: Math.max(existing?.conservativeBytes ?? 0, conservativeBytes),
      occupancyUnknown: Boolean(existing?.occupancyUnknown || occupancyUnknown),
      owner: { ...target.owner },
      reservationId: target.reservationId,
    });
  }

  function snapshotRecords(): AgentLocalStorageQuotaPersistedRecord[] {
    return Array.from(records.values(), clonePersistedRecord);
  }

  function snapshotLiveLeases(): Map<string, Set<string>> {
    return new Map(Array.from(records, ([id, record]) => [
      id,
      new Set(record.liveLeaseIds),
    ]));
  }

  function restoreLiveLeases(snapshot: Map<string, Set<string>>): void {
    for (const [id, leaseIds] of snapshot) {
      const record = records.get(id);
      if (record) record.liveLeaseIds = new Set(leaseIds);
    }
  }

  function restoreRecords(snapshot: AgentLocalStorageQuotaPersistedRecord[]): void {
    records.clear();
    resourceIndex.clear();
    unknownOccupancyRecordIds.clear();
    for (const input of snapshot) {
      const id = normalizeReservationId(input.id);
      issuedReservationIds.add(id);
      const adapterId = normalizeAdapterId(input.adapterId);
      const accountScope = normalizeOwner({
        accountScope: input.accountScope,
        backendScope: input.backendScope,
      }).accountScope;
      const backendScope = normalizeOwner({
        accountScope: input.accountScope,
        backendScope: input.backendScope,
      }).backendScope;
      const category = normalizeCategory(input.category);
      const runId = normalizeRunId(input.runId);
      const expectedBytes = normalizeBytes(input.expectedBytes, 'Agent reservation 预期字节');
      const actualBytes = input.actualBytes === null
        ? null
        : normalizeBytes(input.actualBytes, 'Agent resource 实际字节');
      const createdAt = normalizeBytes(input.createdAt, 'Agent reservation 创建时间');
      const expiresAt = normalizeBytes(input.expiresAt, 'Agent reservation 过期时间');
      const lastTouchedAt = normalizeBytes(input.lastTouchedAt, 'Agent reservation 更新时间');
      const occupancyUnknown = input.occupancyUnknown ?? false;
      if (typeof occupancyUnknown !== 'boolean') {
        throw new Error('Agent 配额持久化未知占用状态无效');
      }
      if (input.state !== 'reserved' && input.state !== 'bound'
        && input.state !== 'committed' && input.state !== 'deleting') {
        throw new Error('Agent 配额持久化状态无效');
      }
      if (input.lastErrorCode !== undefined
        && input.lastErrorCode !== 'adapter_unavailable'
        && input.lastErrorCode !== 'live_lease'
        && input.lastErrorCode !== 'remove_failed') {
        throw new Error('Agent 配额持久化错误状态无效');
      }
      if (input.state !== 'deleting' && (
        expectedBytes > maxSingleResourceBytes
        || (actualBytes !== null && actualBytes > maxSingleResourceBytes)
      )) {
        throw new Error('Agent 配额持久化资源超过单文件上限');
      }
      if (records.has(id)) throw new Error('Agent 配额持久化 reservation 重复');
      const resourceRef = input.resourceRef === undefined
        ? undefined
        : normalizeResourceRef(input.resourceRef);
      if (resourceRef && resourceIndex.has(resourceRef)) {
        throw new Error('Agent 配额持久化 resource ref 重复');
      }
      if ((input.state === 'bound' || input.state === 'committed') && !resourceRef) {
        throw new Error('Agent 配额持久化资源缺少 resource ref');
      }
      if (input.state === 'committed' && actualBytes === null) {
        throw new Error('Agent 配额持久化 committed 资源缺少实际字节');
      }
      if (input.state === 'reserved' && resourceRef) {
        throw new Error('Agent 配额持久化 reserved 资源不应绑定 resource ref');
      }
      if (occupancyUnknown && (input.state !== 'deleting' || !resourceRef)) {
        throw new Error('Agent 配额持久化未知占用资源状态无效');
      }
      const record: QuotaRecord = {
        accountScope,
        actualBytes,
        adapterId,
        backendScope,
        category,
        createdAt,
        expectedBytes,
        expiresAt,
        id,
        ...(input.lastErrorCode ? { lastErrorCode: input.lastErrorCode } : {}),
        lastTouchedAt,
        occupancyUnknown,
        ...(resourceRef ? { resourceRef } : {}),
        runId,
        state: input.state,
        liveLeaseIds: new Set(),
      };
      records.set(id, record);
      if (resourceRef) resourceIndex.set(resourceRef, id);
      if (occupancyUnknown) unknownOccupancyRecordIds.add(id);
    }
    const usage = calculateUsage(record => record.state !== 'deleting');
    if (usage.totalBytes > maxTotalBytes) {
      throw new Error('Agent 配额持久化总量超过当前上限');
    }
    for (const [category, bytes] of Object.entries(usage.byCategory)) {
      const limit = findLimit(categoryLimits, category);
      if (limit !== undefined && bytes > limit) {
        throw new Error('Agent 配额持久化分类超过当前上限');
      }
    }
    for (const [runId, bytes] of Object.entries(usage.byRun)) {
      const limit = findLimit(runLimits, runId);
      if (limit !== undefined && bytes > limit) {
        throw new Error('Agent 配额持久化 Run 超过当前上限');
      }
    }
  }

  const ready = options.persistence
    ? options.persistence.load().then((snapshot) => {
      restoreRecords(snapshot);
    })
    : Promise.resolve();

  function enqueue<T>(
    operation: () => Promise<T> | T,
    allowDuringClose = false,
  ): Promise<T> {
    if (closing && !allowDuringClose) {
      return Promise.reject(new Error('Agent 配额管理器正在关闭'));
    }
    const next = tail.then(() => ready).then(operation);
    tail = next.then(() => undefined, () => undefined);
    return next;
  }

  function enqueueMutation<T>(
    operation: () => Promise<T> | T,
    allowDuringClose = false,
  ): Promise<T> {
    return enqueue(async () => {
      const before = options.persistence ? snapshotRecords() : null;
      const liveLeasesBefore = options.persistence ? snapshotLiveLeases() : null;
      const reconciledDeletionIntents: Array<Pick<
        ReleaseTarget,
        'reservationId' | 'resourceRef'
      >> = [];
      try {
        const result = await operation();
        applyUnreconciledDeletionIntents(reconciledDeletionIntents);
        if (options.persistence) await options.persistence.replace(snapshotRecords());
        clearReconciledDeletionIntents(reconciledDeletionIntents);
        return result;
      } catch (error) {
        if (before) {
          restoreRecords(before);
          if (liveLeasesBefore) restoreLiveLeases(liveLeasesBefore);
        }
        throw error;
      }
    }, allowDuringClose);
  }

  function runAdmittedMultiPhaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new Error('Agent 配额管理器正在关闭'));
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    admittedMultiPhaseOperations.add(promise);
    void promise.then(
      () => admittedMultiPhaseOperations.delete(promise),
      () => admittedMultiPhaseOperations.delete(promise),
    );
    return promise;
  }

  function getRecordByTarget(target: string): QuotaRecord {
    const normalizedTarget = normalizeString(target, 'Agent 配额 reservation 或 resource ref', Math.max(MAX_RESOURCE_REF_LENGTH, 200));
    const reservation = records.get(normalizedTarget);
    const reservationId = resourceIndex.get(normalizedTarget);
    if (reservation && reservationId && reservation.id !== reservationId) {
      throw new Error('Agent 配额目标标识存在歧义');
    }
    if (reservation) return reservation;
    if (!reservationId) throw new Error('Agent 配额资源不存在或已经释放');
    const resource = records.get(reservationId);
    if (!resource) throw new Error('Agent 配额资源不存在或已经释放');
    return resource;
  }

  function assertRecordOwner(
    record: QuotaRecord,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): void {
    const owner = normalizeOwner(ownerInput);
    if (!sameOwner(record, owner)) {
      throw new Error('当前账号无权操作该 Agent 配额资源');
    }
  }

  function createReleaseTarget(
    record: QuotaRecord,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): ReleaseTarget {
    const owner = normalizeOwner(ownerInput);
    assertRecordOwner(record, owner);
    if (!record.resourceRef || resourceIndex.get(record.resourceRef) !== record.id) {
      throw new Error('Agent 配额资源索引不一致');
    }
    return {
      owner,
      reservationId: record.id,
      resourceRef: record.resourceRef,
    };
  }

  function getExactReleaseRecord(target: ReleaseTarget): QuotaRecord | undefined {
    if (resourceIndex.get(target.resourceRef) !== target.reservationId) return undefined;
    const record = records.get(target.reservationId);
    if (!record || record.resourceRef !== target.resourceRef) return undefined;
    assertRecordOwner(record, target.owner);
    return record;
  }

  function hasPendingDeletionIntent(record: QuotaRecord): boolean {
    if (!record.resourceRef) return false;
    return unreconciledDeletionIntents.get(record.resourceRef)?.reservationId === record.id;
  }

  function accountedBytes(record: QuotaRecord): number {
    return Math.max(record.actualBytes ?? 0, record.expectedBytes);
  }

  function pendingDiskHeadroomBytes(): number {
    let total = 0;
    for (const record of records.values()) {
      if (record.state === 'committed' || record.state === 'deleting') continue;
      total += Math.max(0, record.expectedBytes - (record.actualBytes ?? 0));
    }
    return total;
  }

  function calculateUsage(
    include: (record: QuotaRecord) => boolean = () => true,
  ): AgentLocalStorageQuotaUsage {
    const byCategory: Record<string, number> = {};
    const byRun: Record<string, number> = {};
    let totalBytes = 0;
    for (const record of records.values()) {
      if (!include(record)) continue;
      const bytes = accountedBytes(record);
      totalBytes += bytes;
      byCategory[record.category] = (byCategory[record.category] || 0) + bytes;
      byRun[record.runId] = (byRun[record.runId] || 0) + bytes;
    }
    return {
      byCategory,
      byRun,
      resourceCount: records.size,
      totalBytes,
    };
  }

  function readUsage(): AgentLocalStorageQuotaUsage {
    return calculateUsage();
  }

  function findLimit(
    limits: { defaultLimit?: number; limits: Map<string, number> },
    key: string,
  ): number | undefined {
    return limits.limits.get(key) ?? limits.defaultLimit;
  }

  function assertCapacity(
    category: string,
    runId: string,
    previousBytes: number,
    nextBytes: number,
    reserveDiskHeadroom: boolean,
  ): Promise<void> {
    if (nextBytes > maxSingleResourceBytes) {
      throw new Error(`Agent 单文件配额不足：${maxSingleResourceBytes} bytes`);
    }
    const usage = readUsage();
    const delta = nextBytes - previousBytes;
    if (delta <= 0) return Promise.resolve();
    if (usage.totalBytes + delta > maxTotalBytes) {
      throw new Error(`Agent 本机临时存储总量已达到上限：${maxTotalBytes} bytes`);
    }
    const categoryLimit = findLimit(categoryLimits, category);
    if (categoryLimit !== undefined && (usage.byCategory[category] || 0) + delta > categoryLimit) {
      throw new Error(`Agent ${category} 分类配额已达到上限`);
    }
    const runLimit = findLimit(runLimits, runId);
    if (runLimit !== undefined && (usage.byRun[runId] || 0) + delta > runLimit) {
      throw new Error('Agent Run 本机存储配额已达到上限');
    }
    if (reserveDiskHeadroom && options.getAvailableDiskBytes && minFreeBytes > 0) {
      return Promise.resolve(options.getAvailableDiskBytes()).then((availableBytes) => {
        const available = normalizeBytes(availableBytes, 'Agent 可用磁盘空间');
        if (available - pendingDiskHeadroomBytes() - delta < minFreeBytes) {
          throw new Error('Agent 可用磁盘空间低于安全水位');
        }
      });
    }
    return Promise.resolve();
  }

  function assertNewReservationCapacity(): void {
    if (records.size >= maxResourceCount) {
      throw new Error(`Agent 本机临时资源数量已达到上限：${maxResourceCount}`);
    }
  }

  async function assertZeroByteReservationCapacity(category: string, runId: string): Promise<void> {
    const usage = readUsage();
    if (usage.totalBytes >= maxTotalBytes) {
      throw new Error(`Agent 本机临时存储总量已达到上限：${maxTotalBytes} bytes`);
    }
    const categoryLimit = findLimit(categoryLimits, category);
    if (categoryLimit !== undefined && (usage.byCategory[category] || 0) >= categoryLimit) {
      throw new Error(`Agent ${category} 分类配额已达到上限`);
    }
    const runLimit = findLimit(runLimits, runId);
    if (runLimit !== undefined && (usage.byRun[runId] || 0) >= runLimit) {
      throw new Error('Agent Run 本机存储配额已达到上限');
    }
    if (options.getAvailableDiskBytes && minFreeBytes > 0) {
      const available = normalizeBytes(
        await options.getAvailableDiskBytes(),
        'Agent 可用磁盘空间',
      );
      if (available - pendingDiskHeadroomBytes() < minFreeBytes) {
        throw new Error('Agent 可用磁盘空间低于安全水位');
      }
    }
  }

  function normalizeReservationId(value: unknown): string {
    return normalizeString(value, 'Agent reservation ID', MAX_RESOURCE_REF_LENGTH);
  }

  function normalizeResourceRef(value: unknown): string {
    return normalizeString(
      value,
      'Agent resource ref',
      MAX_RESOURCE_REF_LENGTH,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    );
  }

  function normalizeAdapterId(value: unknown): string {
    return normalizeString(
      value,
      'Agent 配额 adapter ID',
      MAX_ADAPTER_ID_LENGTH,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    );
  }

  function normalizeCategory(value: unknown): string {
    return normalizeString(
      value,
      'Agent 配额 category',
      MAX_CATEGORY_LENGTH,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    );
  }

  function normalizeRunId(value: unknown): string {
    return normalizeString(value, 'Agent 配额 Run ID', MAX_RUN_ID_LENGTH);
  }

  function removeUnboundRecord(record: QuotaRecord): AgentLocalStorageQuotaReleaseResult {
    if (record.resourceRef) throw new Error('Agent resource 必须经过两阶段清理');
    unknownOccupancyRecordIds.delete(record.id);
    records.delete(record.id);
    return { released: true, state: 'released' };
  }

  function registerAdapter(adapterId: string, adapter: AgentLocalStorageResourceAdapter): void {
    if (closing) throw new Error('Agent 配额管理器正在关闭');
    const normalizedAdapterId = normalizeAdapterId(adapterId);
    if (!adapter || typeof adapter.remove !== 'function') {
      throw new Error('Agent 配额 resource adapter 无效');
    }
    adapters.set(normalizedAdapterId, adapter);
  }

  function unregisterAdapter(adapterId: string): boolean {
    if (closing) throw new Error('Agent 配额管理器正在关闭');
    return adapters.delete(normalizeAdapterId(adapterId));
  }

  function setAdmissionBlock(blockIdInput: string, blocked: boolean): Promise<void> {
    const blockId = normalizeString(
      blockIdInput,
      'Agent 配额 admission block ID',
      MAX_RESOURCE_REF_LENGTH,
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    );
    return enqueue(() => {
      if (blocked) admissionBlocks.add(blockId);
      else admissionBlocks.delete(blockId);
    });
  }

  async function reserve(
    ownerInput: AgentLocalStorageQuotaOwner,
    categoryInput: string,
    runIdInput: string,
    expectedBytesInput: number,
    ttlInput: number,
    adapterIdInput: string,
  ): Promise<string> {
    const owner = normalizeOwner(ownerInput);
    const category = normalizeCategory(categoryInput);
    const runId = normalizeRunId(runIdInput);
    const expectedBytes = normalizeBytes(expectedBytesInput, 'Agent reservation 预期字节');
    const ttlMs = normalizeTtl(ttlInput, maxTtlMs);
    const adapterId = normalizeAdapterId(adapterIdInput);
    return enqueueMutation(async () => {
      assertAdmissionOpen();
      if (!adapters.has(adapterId)) throw new Error('Agent 配额 resource adapter 不存在');
      assertNewReservationCapacity();
      if (expectedBytes === 0) await assertZeroByteReservationCapacity(category, runId);
      await assertCapacity(category, runId, 0, expectedBytes, true);
      const createdAt = now();
      const id = normalizeReservationId(createId());
      if (records.has(id) || issuedReservationIds.has(id)) {
        throw new Error('Agent reservation ID 冲突');
      }
      issuedReservationIds.add(id);
      records.set(id, {
        accountScope: owner.accountScope,
        actualBytes: null,
        adapterId,
        backendScope: owner.backendScope,
        category,
        createdAt,
        expectedBytes,
        expiresAt: createdAt + ttlMs,
        id,
        lastTouchedAt: createdAt,
        occupancyUnknown: false,
        runId,
        state: 'reserved',
        liveLeaseIds: new Set(),
      });
      return id;
    });
  }

  async function bindResource(
    reservationIdInput: string,
    resourceRefInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReservation> {
    const reservationId = normalizeReservationId(reservationIdInput);
    const resourceRef = normalizeResourceRef(resourceRefInput);
    return enqueueMutation(async () => {
      const record = records.get(reservationId);
      if (!record) throw new Error('Agent reservation 不存在或已经释放');
      assertRecordOwner(record, ownerInput);
      if (
        record.state === 'deleting'
        || record.state === 'committed'
        || hasPendingDeletionIntent(record)
      ) {
        throw new Error('Agent reservation 已经结束');
      }
      const existing = resourceIndex.get(resourceRef);
      if (existing && existing !== reservationId) throw new Error('Agent resource ref 已被占用');
      if (
        activeReleaseOperationsByResourceRef.has(resourceRef)
        || unreconciledDeletionIntents.has(resourceRef)
      ) {
        throw new Error('Agent resource ref 正在完成上一轮清理');
      }
      if (record.resourceRef && record.resourceRef !== resourceRef) {
        throw new Error('Agent reservation 只能绑定一个 resource ref');
      }
      record.resourceRef = resourceRef;
      record.state = 'bound';
      resourceIndex.set(resourceRef, reservationId);
      return cloneReservation(record);
    });
  }

  async function commit(
    reservationIdInput: string,
    resourceRefInput: string,
    actualBytesInput: number,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReservation> {
    const reservationId = normalizeReservationId(reservationIdInput);
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const actualBytes = normalizeBytes(actualBytesInput, 'Agent resource 实际字节');
    return enqueueMutation(async () => {
      const record = records.get(reservationId);
      if (!record) throw new Error('Agent reservation 不存在或已经释放');
      assertRecordOwner(record, ownerInput);
      if (hasPendingDeletionIntent(record)) throw new Error('Agent resource 正在清理');
      if (record.state === 'committed') {
        if (record.resourceRef === resourceRef && record.actualBytes === actualBytes) {
          return cloneReservation(record);
        }
        throw new Error('Agent resource 已经提交过');
      }
      if (record.state !== 'bound' || record.resourceRef !== resourceRef) {
        throw new Error('Agent resource 尚未绑定到当前 reservation');
      }
      if (actualBytes > accountedBytes(record)) assertAdmissionOpen();
      await assertCapacity(
        record.category,
        record.runId,
        record.expectedBytes,
        actualBytes,
        false,
      );
      record.actualBytes = actualBytes;
      record.expectedBytes = actualBytes;
      record.state = 'committed';
      record.lastTouchedAt = now();
      record.expiresAt = record.lastTouchedAt + Math.min(
        maxTtlMs,
        Math.max(1, record.expiresAt - record.createdAt),
      );
      return cloneReservation(record);
    });
  }

  async function adjust(
    targetInput: string,
    newExpectedOrActualBytesInput: number,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReservation> {
    const target = normalizeString(
      targetInput,
      'Agent 配额 reservation 或 resource ref',
      MAX_RESOURCE_REF_LENGTH,
    );
    const nextBytes = normalizeBytes(newExpectedOrActualBytesInput, 'Agent 配额新字节');
    return enqueueMutation(async () => {
      const record = getRecordByTarget(target);
      assertRecordOwner(record, ownerInput);
      if (record.state === 'deleting' || hasPendingDeletionIntent(record)) {
        throw new Error('Agent resource 正在清理');
      }
      if (record.state === 'reserved') throw new Error('Agent resource 尚未绑定');
      const previousBytes = accountedBytes(record);
      if (nextBytes > previousBytes) assertAdmissionOpen();
      await assertCapacity(
        record.category,
        record.runId,
        previousBytes,
        nextBytes,
        false,
      );
      record.actualBytes = nextBytes;
      record.expectedBytes = nextBytes;
      record.lastTouchedAt = now();
      record.expiresAt = record.lastTouchedAt + Math.min(
        maxTtlMs,
        Math.max(1, record.expiresAt - record.createdAt),
      );
      return cloneReservation(record);
    });
  }

  async function growReservation(
    targetInput: string,
    newExpectedBytesInput: number,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReservation> {
    const target = normalizeString(
      targetInput,
      'Agent 配额 reservation 或 resource ref',
      MAX_RESOURCE_REF_LENGTH,
    );
    const nextBytes = normalizeBytes(newExpectedBytesInput, 'Agent 配额新预留字节');
    return enqueueMutation(async () => {
      assertAdmissionOpen();
      const record = getRecordByTarget(target);
      assertRecordOwner(record, ownerInput);
      if (record.state === 'deleting' || record.state === 'committed') {
        throw new Error('Agent reservation 已经结束');
      }
      const previousBytes = accountedBytes(record);
      if (nextBytes < previousBytes) {
        throw new Error('Agent reservation 不能通过扩容接口缩小');
      }
      await assertCapacity(
        record.category,
        record.runId,
        previousBytes,
        nextBytes,
        true,
      );
      record.expectedBytes = nextBytes;
      record.lastTouchedAt = now();
      record.expiresAt = record.lastTouchedAt + Math.min(
        maxTtlMs,
        Math.max(1, record.expiresAt - record.createdAt),
      );
      return cloneReservation(record);
    });
  }

  async function touch(
    resourceRefInput: string,
    ttlInput: number,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<boolean> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const ttlMs = normalizeTtl(ttlInput, maxTtlMs);
    return enqueueMutation(async () => {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record || record.state === 'deleting' || hasPendingDeletionIntent(record)) return false;
      assertRecordOwner(record, ownerInput);
      const touchedAt = now();
      record.lastTouchedAt = touchedAt;
      record.expiresAt = touchedAt + ttlMs;
      return true;
    });
  }

  function markDeletingTargetWithinAdmission(
    target: ReleaseTarget,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
    allowDuringClose = false,
  ): Promise<boolean> {
    const observedOccupancyUnknown = observedBytesInput === 'unknown';
    const observedBytes = observedBytesInput === 'unknown'
      ? maxTotalBytes
      : observedBytesInput === undefined
        ? undefined
        : normalizeBytes(observedBytesInput, 'Agent resource 已观测字节');
    return enqueueMutation(() => {
      const record = getExactReleaseRecord(target);
      if (!record) return false;
      const pendingIntent = unreconciledDeletionIntents.get(target.resourceRef);
      if (pendingIntent && pendingIntent.reservationId !== target.reservationId) {
        throw new Error('Agent 配额清理意图资源身份冲突');
      }
      const pendingBytes = pendingIntent?.conservativeBytes ?? 0;
      const conservativeBytes = Math.max(
        accountedBytes(record),
        observedBytes ?? 0,
        pendingBytes,
      );
      const occupancyUnknown = Boolean(
        record.occupancyUnknown
        || observedOccupancyUnknown
        || pendingIntent?.occupancyUnknown
      );
      rememberUnreconciledDeletionIntent(
        target,
        conservativeBytes,
        occupancyUnknown,
      );
      record.actualBytes = conservativeBytes;
      record.expectedBytes = conservativeBytes;
      record.lastTouchedAt = now();
      record.occupancyUnknown = occupancyUnknown;
      record.state = 'deleting';
      if (occupancyUnknown) unknownOccupancyRecordIds.add(record.id);
      return true;
    }, allowDuringClose);
  }

  function normalizeObservedBytes(
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): AgentLocalStorageQuotaObservedBytes | undefined {
    if (observedBytesInput === undefined || observedBytesInput === 'unknown') {
      return observedBytesInput;
    }
    return normalizeBytes(observedBytesInput, 'Agent resource 已观测字节');
  }

  function mergeObservedBytes(
    current: AgentLocalStorageQuotaObservedBytes | undefined,
    next: AgentLocalStorageQuotaObservedBytes | undefined,
  ): AgentLocalStorageQuotaObservedBytes | undefined {
    if (current === 'unknown' || next === 'unknown') return 'unknown';
    if (current === undefined) return next;
    if (next === undefined) return current;
    return Math.max(current, next);
  }

  function releaseOperationKey(target: ReleaseTarget): string {
    return JSON.stringify([
      target.reservationId,
      target.resourceRef,
      target.owner.backendScope,
      target.owner.accountScope,
    ]);
  }

  function ensureReleaseObservationPersisted(
    target: ReleaseTarget,
    observation: ActiveReleaseOperation['observation'],
  ): Promise<boolean> {
    if (observation.flushPromise) return observation.flushPromise;
    const promise = (async () => {
      let resourceFound = true;
      while (observation.persistedRevision < observation.revision) {
        const targetRevision = observation.revision;
        const targetObservedBytes = observation.observedBytes;
        try {
          resourceFound = await markDeletingTargetWithinAdmission(
            target,
            targetObservedBytes,
            true,
          );
          observation.persistedRevision = targetRevision;
          if (!resourceFound) return false;
        } catch (error) {
          if (observation.revision !== targetRevision) continue;
          throw error;
        }
      }
      return resourceFound;
    })();
    observation.flushPromise = promise;
    void promise.then(
      () => {
        if (observation.flushPromise === promise) observation.flushPromise = null;
      },
      () => {
        if (observation.flushPromise === promise) observation.flushPromise = null;
      },
    );
    return promise;
  }

  async function drainReleaseObservation(
    target: ReleaseTarget,
    observation: ActiveReleaseOperation['observation'],
  ): Promise<void> {
    for (;;) {
      if (observation.persistedRevision >= observation.revision) {
        observation.sealed = true;
        return;
      }
      try {
        const resourceFound = await ensureReleaseObservationPersisted(target, observation);
        if (!resourceFound) {
          observation.sealed = true;
          return;
        }
      } catch {
        // A failed mark retains the strongest observation as an in-memory intent.
        // Persist that intent before retrying the exact target revision.
        await enqueueMutation(() => undefined, true);
      }
    }
  }

  async function removeMarkedResource(
    target: ReleaseTarget,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const attempt = await enqueueMutation(() => {
      const record = getExactReleaseRecord(target);
      if (!record) {
        return {
          kind: 'result' as const,
          result: { released: true, state: 'released' as const },
        };
      }
      record.state = 'deleting';
      if (record.liveLeaseIds.size > 0) {
        record.lastErrorCode = 'live_lease';
        return {
          kind: 'result' as const,
          result: { released: false, state: 'deleting' as const },
        };
      }
      const adapter = adapters.get(record.adapterId);
      if (!adapter) {
        record.lastErrorCode = 'adapter_unavailable';
        return {
          kind: 'result' as const,
          result: { released: false, state: 'deleting' as const },
        };
      }
      delete record.lastErrorCode;
      return { adapter, kind: 'adapter' as const };
    }, true);
    if (attempt.kind === 'result') return attempt.result;

    let removalError: unknown;
    try {
      await attempt.adapter.remove(target.resourceRef);
    } catch (error) {
      removalError = error;
    }

    return enqueueMutation(() => {
      const record = getExactReleaseRecord(target);
      if (!record) return { released: true, state: 'released' as const };
      if (removalError !== undefined) {
        record.lastErrorCode = normalizeErrorCode(removalError);
        record.state = 'deleting';
        return { released: false, state: 'deleting' as const };
      }
      resourceIndex.delete(target.resourceRef);
      unknownOccupancyRecordIds.delete(record.id);
      records.delete(record.id);
      return { released: true, state: 'released' as const };
    }, true);
  }

  function resolveCurrentReleaseTarget(
    resourceRef: string,
    owner: AgentLocalStorageQuotaOwner,
  ): ReleaseTarget | null {
    const reservationId = resourceIndex.get(resourceRef);
    const record = reservationId ? records.get(reservationId) : undefined;
    if (!record) return null;
    return createReleaseTarget(record, owner);
  }

  function markDeleting(
    resourceRefInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): Promise<boolean> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const owner = normalizeOwner(ownerInput);
    const observedBytes = normalizeObservedBytes(observedBytesInput);
    return runAdmittedMultiPhaseOperation(async () => {
      const target = await enqueue(
        () => resolveCurrentReleaseTarget(resourceRef, owner),
        true,
      );
      if (!target) return false;
      return markDeletingTargetWithinAdmission(target, observedBytes, true);
    });
  }

  function mergeActiveReleaseObservation(
    active: ActiveReleaseOperation,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const mergedObservedBytes = mergeObservedBytes(
      active.observation.observedBytes,
      observedBytesInput,
    );
    if (active.observation.sealed) {
      if (mergedObservedBytes === active.observation.observedBytes) return active.promise;
      return active.promise.then(
        result => result.released
          ? result
          : requestReleaseTargetWithinAdmission(active.target, mergedObservedBytes),
        () => requestReleaseTargetWithinAdmission(active.target, mergedObservedBytes),
      );
    }
    if (mergedObservedBytes !== active.observation.observedBytes) {
      active.observation.observedBytes = mergedObservedBytes;
      active.observation.revision += 1;
      void ensureReleaseObservationPersisted(
        active.target,
        active.observation,
      ).then(() => undefined, () => undefined);
    }
    return active.promise;
  }

  function requestReleaseTargetWithinAdmission(
    target: ReleaseTarget,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const operationKey = releaseOperationKey(target);
    const active = activeReleaseOperations.get(operationKey);
    if (active) return mergeActiveReleaseObservation(active, observedBytesInput);
    if (!getExactReleaseRecord(target)) {
      return Promise.resolve({ released: true, state: 'released' as const });
    }

    const activeForResource = activeReleaseOperationsByResourceRef.get(target.resourceRef);
    if (activeForResource) {
      if (!getExactReleaseRecord(target)) {
        return Promise.resolve({ released: true, state: 'released' as const });
      }
      return Promise.reject(new Error('Agent resource ref 正在完成上一轮清理'));
    }

    const observation: ActiveReleaseOperation['observation'] = {
      flushPromise: null,
      observedBytes: observedBytesInput,
      persistedRevision: -1,
      revision: 0,
      sealed: false,
    };
    const promise = Promise.resolve().then(async () => {
      try {
        const marked = await ensureReleaseObservationPersisted(
          target,
          observation,
        );
        if (!marked) return { released: true, state: 'released' as const };
        const result = await removeMarkedResource(target);
        await drainReleaseObservation(target, observation);
        return result;
      } catch (error) {
        try {
          await drainReleaseObservation(target, observation);
        } catch {
          // The latest failed mark still retains its in-memory deletion intent.
        }
        throw error;
      }
    });

    const operation: ActiveReleaseOperation = { observation, promise, target };
    activeReleaseOperations.set(operationKey, operation);
    activeReleaseOperationsByResourceRef.set(target.resourceRef, operation);
    void promise.then(
      () => {
        if (activeReleaseOperations.get(operationKey)?.promise === promise) {
          activeReleaseOperations.delete(operationKey);
        }
        if (activeReleaseOperationsByResourceRef.get(target.resourceRef)?.promise === promise) {
          activeReleaseOperationsByResourceRef.delete(target.resourceRef);
        }
      },
      () => {
        if (activeReleaseOperations.get(operationKey)?.promise === promise) {
          activeReleaseOperations.delete(operationKey);
        }
        if (activeReleaseOperationsByResourceRef.get(target.resourceRef)?.promise === promise) {
          activeReleaseOperationsByResourceRef.delete(target.resourceRef);
        }
      },
    );
    return promise;
  }

  async function requestReleaseWithinAdmission(
    resourceRef: string,
    owner: AgentLocalStorageQuotaOwner,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const activeBeforeLookup = activeReleaseOperationsByResourceRef.get(resourceRef);
    const currentReservationId = resourceIndex.get(resourceRef);
    if (
      activeBeforeLookup
      && (
        !currentReservationId
        || currentReservationId === activeBeforeLookup.target.reservationId
      )
    ) {
      if (
        activeBeforeLookup.target.owner.accountScope !== owner.accountScope
        || activeBeforeLookup.target.owner.backendScope !== owner.backendScope
      ) {
        throw new Error('当前账号无权操作该 Agent 配额资源');
      }
      return mergeActiveReleaseObservation(activeBeforeLookup, observedBytesInput);
    }
    const target = await enqueue(
      () => resolveCurrentReleaseTarget(resourceRef, owner),
      true,
    );
    if (target) {
      return requestReleaseTargetWithinAdmission(target, observedBytesInput);
    }
    const active = activeReleaseOperationsByResourceRef.get(resourceRef);
    if (!active) return { released: false, state: 'not_found' };
    if (
      active.target.owner.accountScope !== owner.accountScope
      || active.target.owner.backendScope !== owner.backendScope
    ) {
      throw new Error('当前账号无权操作该 Agent 配额资源');
    }
    return mergeActiveReleaseObservation(active, observedBytesInput);
  }

  function requestRelease(
    resourceRefInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
    observedBytesInput?: AgentLocalStorageQuotaObservedBytes,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const owner = normalizeOwner(ownerInput);
    const observedBytes = normalizeObservedBytes(observedBytesInput);
    return runAdmittedMultiPhaseOperation(() => (
      requestReleaseWithinAdmission(resourceRef, owner, observedBytes)
    ));
  }

  function cancelReservation(
    reservationIdInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const reservationId = normalizeReservationId(reservationIdInput);
    const owner = normalizeOwner(ownerInput);
    return runAdmittedMultiPhaseOperation(async () => {
      const cancellation = await enqueueMutation(async () => {
        const record = records.get(reservationId);
        if (!record) {
          return {
            kind: 'result' as const,
            result: { released: false, state: 'not_found' as const },
          };
        }
        assertRecordOwner(record, owner);
        if (record.resourceRef) {
          return {
            kind: 'resource' as const,
            target: createReleaseTarget(record, owner),
          };
        }
        return { kind: 'result' as const, result: removeUnboundRecord(record) };
      }, true);
      if (cancellation.kind === 'resource') {
        return requestReleaseTargetWithinAdmission(cancellation.target);
      }
      return cancellation.result;
    });
  }

  async function acquireLease(
    resourceRefInput: string,
    ttlInput: number,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaLease> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const ttlMs = normalizeTtl(ttlInput, maxTtlMs);
    return enqueueMutation(async () => {
      assertAdmissionOpen();
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record || record.state === 'deleting') {
        throw new Error('Agent 配额资源不存在或正在清理');
      }
      assertRecordOwner(record, ownerInput);
      const leaseId = normalizeReservationId(createId());
      if (record.liveLeaseIds.has(leaseId)) throw new Error('Agent 配额 lease ID 冲突');
      const touchedAt = now();
      record.liveLeaseIds.add(leaseId);
      record.lastTouchedAt = touchedAt;
      record.expiresAt = touchedAt + ttlMs;
      return { expiresAt: record.expiresAt, leaseId, resourceRef };
    });
  }

  async function releaseLease(
    resourceRefInput: string,
    leaseIdInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<boolean> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const leaseId = normalizeReservationId(leaseIdInput);
    return enqueue(() => {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record) return false;
      assertRecordOwner(record, ownerInput);
      return record.liveLeaseIds.delete(leaseId);
    });
  }

  function applyUnreconciledDeletionIntents(
    reconciledTargets: Array<Pick<ReleaseTarget, 'reservationId' | 'resourceRef'>>,
  ): void {
    for (const [resourceRef, intent] of unreconciledDeletionIntents) {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record || reservationId !== intent.reservationId) {
        reconciledTargets.push({ reservationId: intent.reservationId, resourceRef });
        continue;
      }
      if (!sameOwner(record, intent.owner)) {
        throw new Error('Agent 配额清理意图 owner 冲突');
      }
      const conservativeBytes = Math.max(
        accountedBytes(record),
        intent.conservativeBytes,
      );
      record.actualBytes = conservativeBytes;
      record.expectedBytes = conservativeBytes;
      record.lastTouchedAt = now();
      record.occupancyUnknown = Boolean(
        record.occupancyUnknown || intent.occupancyUnknown
      );
      record.state = 'deleting';
      if (record.occupancyUnknown) unknownOccupancyRecordIds.add(record.id);
      reconciledTargets.push({ reservationId: intent.reservationId, resourceRef });
    }
  }

  function clearReconciledDeletionIntents(
    targets: Array<Pick<ReleaseTarget, 'reservationId' | 'resourceRef'>>,
  ): void {
    for (const target of targets) {
      if (
        unreconciledDeletionIntents.get(target.resourceRef)?.reservationId
        === target.reservationId
      ) {
        unreconciledDeletionIntents.delete(target.resourceRef);
      }
    }
  }

  async function persistUnreconciledDeletionIntents(): Promise<void> {
    if (unreconciledDeletionIntents.size === 0) return;
    await enqueueMutation(() => undefined, true);
  }

  async function prepareSweepCandidates(cutoff: number, allowDuringClose: boolean): Promise<void> {
    await enqueueMutation(() => {
      for (const record of records.values()) {
        if (record.expiresAt <= cutoff && record.liveLeaseIds.size === 0) {
          record.state = 'deleting';
        }
      }
    }, allowDuringClose);
  }

  function sweep(reasonInput: string): Promise<AgentLocalStorageQuotaSweepResult> {
    const reason = normalizeString(reasonInput, 'Agent 配额 sweep reason', 120);
    const cutoff = now();
    return runAdmittedMultiPhaseOperation(async () => {
      await prepareSweepCandidates(cutoff, true);
      const candidates = await enqueue(() => (
        Array.from(records.values()).filter(record => (
          record.state === 'deleting'
          && record.liveLeaseIds.size === 0
        )).map((record) => {
          const owner = normalizeOwner(record);
          if (record.resourceRef) {
            return {
              kind: 'resource' as const,
              target: createReleaseTarget(record, owner),
            };
          }
          return { id: record.id, kind: 'reservation' as const, owner };
        })
      ), true);
      let released = 0;
      let failed = 0;
      for (const candidate of candidates) {
        let result: AgentLocalStorageQuotaReleaseResult;
        if (candidate.kind === 'resource') {
          result = await requestReleaseTargetWithinAdmission(candidate.target);
        } else {
          result = await enqueueMutation(() => {
            const record = records.get(candidate.id);
            if (!record) return { released: true, state: 'released' as const };
            assertRecordOwner(record, candidate.owner);
            if (record.resourceRef) {
              return { released: false, state: 'deleting' as const };
            }
            return removeUnboundRecord(record);
          }, true);
        }
        if (result.released) released += 1;
        else failed += 1;
      }
      return {
        attempted: candidates.length,
        failed,
        reason,
        released,
      };
    });
  }

  function getReservation(
    reservationIdInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): AgentLocalStorageQuotaReservation | null {
    const reservationId = normalizeReservationId(reservationIdInput);
    const record = records.get(reservationId);
    if (!record) return null;
    assertRecordOwner(record, ownerInput);
    return cloneReservation(record);
  }

  function getResource(
    resourceRefInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): AgentLocalStorageQuotaReservation | null {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    const reservationId = resourceIndex.get(resourceRef);
    const record = reservationId ? records.get(reservationId) : undefined;
    if (!record) return null;
    assertRecordOwner(record, ownerInput);
    return cloneReservation(record);
  }

  function hasManagedResource(
    adapterIdInput: string,
    resourceRefInput: string,
  ): Promise<boolean> {
    const adapterId = normalizeAdapterId(adapterIdInput);
    const resourceRef = normalizeResourceRef(resourceRefInput);
    return enqueue(() => {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      return Boolean(record && record.adapterId === adapterId);
    });
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      let lifecycleError: unknown;
      try {
        await ready;
        await Promise.allSettled(Array.from(admittedMultiPhaseOperations));
        await tail;
        await persistUnreconciledDeletionIntents();
      } catch (error) {
        lifecycleError = error;
      }
      try {
        await options.persistence?.close?.();
      } catch (error) {
        if (lifecycleError === undefined) throw error;
      }
      if (lifecycleError !== undefined) throw lifecycleError;
    })();
    return closePromise;
  }

  return {
    adjust,
    acquireLease,
    bindResource,
    cancelReservation,
    close,
    commit,
    getReservation,
    getResource,
    getUsage: readUsage,
    growReservation,
    hasManagedResource,
    markDeleting,
    registerAdapter,
    requestRelease,
    releaseLease,
    ready,
    reserve,
    setAdmissionBlock,
    sweep,
    touch,
    unregisterAdapter,
  };
}

export const agentLocalStorageQuotaManager = createAgentLocalStorageQuotaManager();
export type AgentLocalStorageQuotaManager = ReturnType<typeof createAgentLocalStorageQuotaManager>;

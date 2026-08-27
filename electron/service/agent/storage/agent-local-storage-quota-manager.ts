import crypto from 'node:crypto';

import {
  normalizeAgentOwnerScope,
} from '../../../../src/shared/agent/agent-owner-scope';
import type { AgentOwnerScope } from '../../../../src/shared/agent/agent.types';

const DEFAULT_MAX_SINGLE_RESOURCE_BYTES = 2 * 1024 * 1024 * 1024;
// Four maximum-sized resources keep the default aligned with the Agent
// architecture contract: 2 GiB per resource and 8 GiB in total.
const DEFAULT_MAX_TOTAL_BYTES = 4 * DEFAULT_MAX_SINGLE_RESOURCE_BYTES;
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
  resourceRef?: string;
  runId: string;
  state: AgentLocalStorageQuotaState;
  actualBytes: number | null;
  liveLeaseIds: Set<string>;
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
  let tail = Promise.resolve();

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
    for (const input of snapshot) {
      const id = normalizeReservationId(input.id);
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
      if (expectedBytes > maxSingleResourceBytes
        || (actualBytes !== null && actualBytes > maxSingleResourceBytes)) {
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
        ...(resourceRef ? { resourceRef } : {}),
        runId,
        state: input.state,
        liveLeaseIds: new Set(),
      };
      records.set(id, record);
      if (resourceRef) resourceIndex.set(resourceRef, id);
    }
    const usage = readUsage();
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

  function enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = tail.then(() => ready).then(operation);
    tail = next.then(() => undefined, () => undefined);
    return next;
  }

  function enqueueMutation<T>(operation: () => Promise<T> | T): Promise<T> {
    return enqueue(async () => {
      const before = options.persistence ? snapshotRecords() : null;
      const liveLeasesBefore = options.persistence ? snapshotLiveLeases() : null;
      try {
        const result = await operation();
        if (options.persistence) await options.persistence.replace(snapshotRecords());
        return result;
      } catch (error) {
        if (before) {
          restoreRecords(before);
          if (liveLeasesBefore) restoreLiveLeases(liveLeasesBefore);
        }
        throw error;
      }
    });
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

  function accountedBytes(record: QuotaRecord): number {
    return record.actualBytes ?? record.expectedBytes;
  }

  function readUsage(): AgentLocalStorageQuotaUsage {
    const byCategory: Record<string, number> = {};
    const byRun: Record<string, number> = {};
    let totalBytes = 0;
    for (const record of records.values()) {
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
    if (options.getAvailableDiskBytes && minFreeBytes > 0) {
      return Promise.resolve(options.getAvailableDiskBytes()).then((availableBytes) => {
        const available = normalizeBytes(availableBytes, 'Agent 可用磁盘空间');
        if (available - delta < minFreeBytes) {
          throw new Error('Agent 可用磁盘空间低于安全水位');
        }
      });
    }
    return Promise.resolve();
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

  async function removeRecord(record: QuotaRecord): Promise<AgentLocalStorageQuotaReleaseResult> {
    if (record.liveLeaseIds.size > 0) {
      record.state = 'deleting';
      record.lastErrorCode = 'live_lease';
      return { released: false, state: 'deleting' };
    }
    if (!record.resourceRef) {
      records.delete(record.id);
      return { released: true, state: 'released' };
    }
    record.state = 'deleting';
    const adapter = adapters.get(record.adapterId);
    if (!adapter) {
      record.lastErrorCode = 'adapter_unavailable';
      return { released: false, state: 'deleting' };
    }
    try {
      await adapter.remove(record.resourceRef);
      resourceIndex.delete(record.resourceRef);
      records.delete(record.id);
      return { released: true, state: 'released' };
    } catch (error) {
      record.lastErrorCode = normalizeErrorCode(error);
      return { released: false, state: 'deleting' };
    }
  }

  function registerAdapter(adapterId: string, adapter: AgentLocalStorageResourceAdapter): void {
    const normalizedAdapterId = normalizeAdapterId(adapterId);
    if (!adapter || typeof adapter.remove !== 'function') {
      throw new Error('Agent 配额 resource adapter 无效');
    }
    adapters.set(normalizedAdapterId, adapter);
  }

  function unregisterAdapter(adapterId: string): boolean {
    return adapters.delete(normalizeAdapterId(adapterId));
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
      if (!adapters.has(adapterId)) throw new Error('Agent 配额 resource adapter 不存在');
      await assertCapacity(category, runId, 0, expectedBytes);
      const createdAt = now();
      const id = normalizeReservationId(createId());
      if (records.has(id)) throw new Error('Agent reservation ID 冲突');
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
      if (record.state === 'deleting' || record.state === 'committed') {
        throw new Error('Agent reservation 已经结束');
      }
      const existing = resourceIndex.get(resourceRef);
      if (existing && existing !== reservationId) throw new Error('Agent resource ref 已被占用');
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
      if (record.state === 'committed') {
        if (record.resourceRef === resourceRef && record.actualBytes === actualBytes) {
          return cloneReservation(record);
        }
        throw new Error('Agent resource 已经提交过');
      }
      if (record.state !== 'bound' || record.resourceRef !== resourceRef) {
        throw new Error('Agent resource 尚未绑定到当前 reservation');
      }
      await assertCapacity(
        record.category,
        record.runId,
        record.expectedBytes,
        actualBytes,
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
      if (record.state === 'deleting') throw new Error('Agent resource 正在清理');
      const previousBytes = accountedBytes(record);
      await assertCapacity(
        record.category,
        record.runId,
        previousBytes,
        nextBytes,
      );
      if (record.state === 'committed') record.actualBytes = nextBytes;
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
      if (!record || record.state === 'deleting') return false;
      assertRecordOwner(record, ownerInput);
      const touchedAt = now();
      record.lastTouchedAt = touchedAt;
      record.expiresAt = touchedAt + ttlMs;
      return true;
    });
  }

  async function requestRelease(
    resourceRefInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const resourceRef = normalizeResourceRef(resourceRefInput);
    return enqueueMutation(async () => {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record) return { released: false, state: 'not_found' };
      assertRecordOwner(record, ownerInput);
      return removeRecord(record);
    });
  }

  async function cancelReservation(
    reservationIdInput: string,
    ownerInput: AgentLocalStorageQuotaOwner,
  ): Promise<AgentLocalStorageQuotaReleaseResult> {
    const reservationId = normalizeReservationId(reservationIdInput);
    return enqueueMutation(async () => {
      const record = records.get(reservationId);
      if (!record) return { released: false, state: 'not_found' };
      assertRecordOwner(record, ownerInput);
      return removeRecord(record);
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
    return enqueueMutation(async () => {
      const reservationId = resourceIndex.get(resourceRef);
      const record = reservationId ? records.get(reservationId) : undefined;
      if (!record) return false;
      assertRecordOwner(record, ownerInput);
      return record.liveLeaseIds.delete(leaseId);
    });
  }

  async function sweep(reasonInput: string): Promise<AgentLocalStorageQuotaSweepResult> {
    const reason = normalizeString(reasonInput, 'Agent 配额 sweep reason', 120);
    return enqueueMutation(async () => {
      const cutoff = now();
      const candidates = Array.from(records.values()).filter(record => (
        (record.state === 'deleting' || record.expiresAt <= cutoff)
        && record.liveLeaseIds.size === 0
      ));
      let released = 0;
      let failed = 0;
      for (const record of candidates) {
        const result = await removeRecord(record);
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

  async function close(): Promise<void> {
    let initializationError: unknown;
    try {
      await ready;
    } catch (error) {
      initializationError = error;
    }
    await tail;
    try {
      await options.persistence?.close?.();
    } catch (error) {
      if (initializationError === undefined) throw error;
    }
    if (initializationError !== undefined) throw initializationError;
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
    hasManagedResource,
    registerAdapter,
    requestRelease,
    releaseLease,
    ready,
    reserve,
    sweep,
    touch,
    unregisterAdapter,
  };
}

export const agentLocalStorageQuotaManager = createAgentLocalStorageQuotaManager();
export type AgentLocalStorageQuotaManager = ReturnType<typeof createAgentLocalStorageQuotaManager>;

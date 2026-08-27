import crypto from 'node:crypto';
import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  agentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaOwner,
} from '../storage/agent-local-storage-quota-manager';
import { normalizeAgentOwnerScope } from '../../../../src/shared/agent/agent-owner-scope';

const MAX_LOGICAL_PATH_BYTES = 1_024;
const MAX_WORKSPACE_ID_LENGTH = 200;
const MAX_RUN_ID_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_PROVENANCE_ID_LENGTH = 512;
const MAX_MANIFEST_ENTRIES = 10_000;
const MAX_MANIFEST_UPDATE_ENTRIES = 1_000;
const MAX_MANIFEST_UPDATE_REMOVALS = 1_000;
const MAX_PROVENANCE_ENTRIES = 256;
const DEFAULT_WORKSPACE_TTL_MS = 30 * 60 * 1_000;
const WORKSPACE_DIRECTORY_PREFIX = 'workspace-';
const WORKSPACE_ROOTS = ['input', 'work', 'output', 'tmp', 'home'] as const;
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export type AgentShellWorkspaceRoot = (typeof WORKSPACE_ROOTS)[number];

export interface AgentShellWorkspaceOwner extends AgentLocalStorageQuotaOwner {
  sessionId: string;
}

export interface AgentShellWorkspaceManifestEntry {
  contentHash?: string;
  kind: 'directory' | 'file';
  logicalPath: string;
  sizeBytes: number;
}

export interface AgentShellWorkspaceManifest {
  entries: AgentShellWorkspaceManifestEntry[];
  generation: number;
  provenance: string[];
  workspaceId: string;
}

export interface AgentShellWorkspace {
  generation: number;
  logicalRoots: readonly AgentShellWorkspaceRoot[];
  manifest: AgentShellWorkspaceManifest;
  owner: AgentShellWorkspaceOwner;
  runId: string;
  workspaceId: string;
}

export interface AgentShellWorkspaceManifestEntryInput {
  contentHash?: string;
  kind: 'directory' | 'file';
  logicalPath: string;
  sizeBytes: number;
}

export interface AgentShellWorkspaceManifestUpdate {
  entries?: AgentShellWorkspaceManifestEntryInput[];
  expectedGeneration?: number;
  provenance?: string[];
  remove?: string[];
}

export interface AgentShellWorkspaceStoreOptions {
  adapterId?: string;
  createId?: () => string;
  persistence?: AgentShellWorkspacePersistence;
  quotaManager?: AgentLocalStorageQuotaManager;
  rootPath: string;
  ttlMs?: number;
}

export interface AgentShellWorkspacePersistedRecord {
  generation: number;
  manifest: AgentShellWorkspaceManifest;
  owner: AgentShellWorkspaceOwner;
  quotaResourceRef: string;
  runId: string;
  status: 'active' | 'deleting';
  workspaceId: string;
}

export interface AgentShellWorkspacePersistence {
  load: () => Promise<AgentShellWorkspacePersistedRecord[]>;
  replace: (records: AgentShellWorkspacePersistedRecord[]) => Promise<void>;
  close?: () => Promise<void>;
}

interface WorkspaceRecord {
  generation: number;
  manifestEntries: Map<string, AgentShellWorkspaceManifestEntry>;
  owner: AgentShellWorkspaceOwner;
  provenance: Set<string>;
  quotaResourceRef: string;
  rootPath: string;
  runId: string;
  status: 'active' | 'deleting';
  workspaceId: string;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function normalizeString(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\u0000')) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizeOwner(owner: AgentShellWorkspaceOwner): AgentShellWorkspaceOwner {
  const scope = normalizeAgentOwnerScope(owner);
  return {
    ...scope,
    sessionId: normalizeString(owner?.sessionId, 'Agent workspace Session ID', MAX_SESSION_ID_LENGTH),
  };
}

function normalizeBytes(value: unknown): number {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Agent workspace 字节数无效');
  return bytes;
}

function normalizeWorkspaceId(value: unknown): string {
  const workspaceId = normalizeString(value, 'Agent workspace ID', MAX_WORKSPACE_ID_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(workspaceId)) {
    throw new Error('Agent workspace ID 无效');
  }
  return workspaceId;
}

function normalizeRunId(value: unknown): string {
  return normalizeString(value, 'Agent workspace Run ID', MAX_RUN_ID_LENGTH);
}

function normalizeLogicalPath(value: unknown): string {
  const logicalPath = normalizeString(value, 'Agent workspace 逻辑路径', MAX_LOGICAL_PATH_BYTES);
  if (
    utf8Length(logicalPath) > MAX_LOGICAL_PATH_BYTES
    || logicalPath.includes('\\')
    || logicalPath.startsWith('/')
    || logicalPath.startsWith('\\')
    || /^[A-Za-z]:/u.test(logicalPath)
    || path.win32.isAbsolute(logicalPath)
  ) {
    throw new Error('Agent workspace 逻辑路径无效');
  }
  const segments = logicalPath.split('/');
  if (
    segments.some(segment => !segment || segment === '.' || segment === '..')
    || segments.length === 0
    || !WORKSPACE_ROOTS.includes(segments[0] as AgentShellWorkspaceRoot)
  ) {
    throw new Error('Agent workspace 逻辑路径越界');
  }
  return segments.join('/');
}

function normalizeProvenance(value: unknown): string {
  return normalizeString(value, 'Agent workspace provenance', MAX_PROVENANCE_ID_LENGTH);
}

function normalizeContentHash(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const hash = normalizeString(value, 'Agent workspace content hash', 71);
  if (!CONTENT_HASH_PATTERN.test(hash)) throw new Error('Agent workspace content hash 无效');
  return hash;
}

function normalizeEntryKind(value: unknown): AgentShellWorkspaceManifestEntry['kind'] {
  if (value !== 'file' && value !== 'directory') throw new Error('Agent workspace manifest 类型无效');
  return value;
}

function cloneOwner(owner: AgentShellWorkspaceOwner): AgentShellWorkspaceOwner {
  return { ...owner };
}

function cloneManifest(record: WorkspaceRecord): AgentShellWorkspaceManifest {
  return {
    entries: Array.from(record.manifestEntries.values())
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
      .map(entry => ({ ...entry })),
    generation: record.generation,
    provenance: Array.from(record.provenance).sort(),
    workspaceId: record.workspaceId,
  };
}

function cloneWorkspace(record: WorkspaceRecord): AgentShellWorkspace {
  return {
    generation: record.generation,
    logicalRoots: [...WORKSPACE_ROOTS],
    manifest: cloneManifest(record),
    owner: cloneOwner(record.owner),
    runId: record.runId,
    workspaceId: record.workspaceId,
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function toPersistedRecord(record: WorkspaceRecord): AgentShellWorkspacePersistedRecord {
  return {
    generation: record.generation,
    manifest: cloneManifest(record),
    owner: cloneOwner(record.owner),
    quotaResourceRef: record.quotaResourceRef,
    runId: record.runId,
    status: record.status,
    workspaceId: record.workspaceId,
  };
}

export function createAgentShellWorkspaceStore(options: AgentShellWorkspaceStoreOptions) {
  const createId = options.createId || crypto.randomUUID;
  const quotaManager = options.quotaManager || agentLocalStorageQuotaManager;
  const ttlMs = Number(options.ttlMs ?? DEFAULT_WORKSPACE_TTL_MS);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Agent workspace TTL 无效');
  const rootPath = path.resolve(normalizeString(options.rootPath, 'Agent workspace root', 4_096));
  const records = new Map<string, WorkspaceRecord>();
  const adapterId = options.adapterId
    ? normalizeString(options.adapterId, 'Agent workspace adapter ID', 128)
    : `workspace:${normalizeWorkspaceId(createId())}`;

  function snapshotRecords(): AgentShellWorkspacePersistedRecord[] {
    return Array.from(records.values(), toPersistedRecord);
  }

  function restoreRecords(snapshot: AgentShellWorkspacePersistedRecord[]): void {
    records.clear();
    for (const input of snapshot) {
      const workspaceId = normalizeWorkspaceId(input.workspaceId);
      const runId = normalizeRunId(input.runId);
      const owner = normalizeOwner(input.owner);
      const quotaResourceRef = normalizeString(
        input.quotaResourceRef,
        'Agent workspace quota resource ref',
        256,
      );
      if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
        throw new Error('Agent workspace generation 无效');
      }
      if (input.status !== 'active' && input.status !== 'deleting') {
        throw new Error('Agent workspace 状态无效');
      }
      if (records.has(workspaceId)) throw new Error('Agent workspace 持久化 ID 重复');
      const manifestEntries = new Map<string, AgentShellWorkspaceManifestEntry>();
      if (!input.manifest || input.manifest.workspaceId !== workspaceId
        || input.manifest.generation !== input.generation
        || !Array.isArray(input.manifest.entries)
        || !Array.isArray(input.manifest.provenance)) {
        throw new Error('Agent workspace 持久化 manifest 无效');
      }
      if (input.manifest.entries.length > MAX_MANIFEST_ENTRIES
        || input.manifest.provenance.length > MAX_PROVENANCE_ENTRIES) {
        throw new Error('Agent workspace 持久化 manifest 过大');
      }
      for (const entry of input.manifest.entries) {
        const logicalPath = normalizeLogicalPath(entry.logicalPath);
        const kind = normalizeEntryKind(entry.kind);
        const sizeBytes = normalizeBytes(entry.sizeBytes);
        if (logicalPath.split('/').length === 1 && kind !== 'directory') {
          throw new Error('Agent workspace 持久化根目录无效');
        }
        if (manifestEntries.has(logicalPath)) throw new Error('Agent workspace manifest 路径重复');
        manifestEntries.set(logicalPath, {
          ...(normalizeContentHash(entry.contentHash) ? { contentHash: normalizeContentHash(entry.contentHash) } : {}),
          kind,
          logicalPath,
          sizeBytes,
        });
      }
      const provenance = new Set(input.manifest.provenance.map(normalizeProvenance));
      records.set(workspaceId, {
        generation: input.generation,
        manifestEntries,
        owner,
        provenance,
        quotaResourceRef,
        rootPath: path.join(rootPath, `${WORKSPACE_DIRECTORY_PREFIX}${workspaceId}`),
        runId,
        status: input.status,
        workspaceId,
      });
    }
  }

  const ready = (async () => {
    await quotaManager.ready;
    if (options.persistence) restoreRecords(await options.persistence.load());
    await assertControlledRoot();
    let changed = false;
    const managedCleanup: WorkspaceRecord[] = [];
    const unmanagedCleanup: WorkspaceRecord[] = [];
    for (const record of records.values()) {
      const hasManagedQuotaResource = await quotaManager.hasManagedResource(
        adapterId,
        record.quotaResourceRef,
      );
      let quotaResource: ReturnType<AgentLocalStorageQuotaManager['getResource']> = null;
      try {
        quotaResource = quotaManager.getResource(record.quotaResourceRef, record.owner);
      } catch {
        // A mismatched owner is not allowed to claim another ledger resource.
      }
      const hasMatchingQuotaResource = Boolean(
        quotaResource
        && quotaResource.adapterId === adapterId
        && quotaResource.runId === record.runId,
      );
      let physicalWorkspaceValid = true;
      try {
        const workspaceStat = await lstat(record.rootPath);
        if (workspaceStat.isSymbolicLink() || !workspaceStat.isDirectory()) {
          physicalWorkspaceValid = false;
        }
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        physicalWorkspaceValid = false;
      }
      if (
        record.status === 'deleting'
        || quotaResource?.state === 'deleting'
        || !physicalWorkspaceValid
        || !hasMatchingQuotaResource
      ) {
        record.status = 'deleting';
        changed = true;
        if (hasMatchingQuotaResource) managedCleanup.push(record);
        else if (!hasManagedQuotaResource) unmanagedCleanup.push(record);
      }
    }
    if (changed) await persist();
    for (const record of managedCleanup) {
      await quotaManager.requestRelease(record.quotaResourceRef, record.owner);
    }
    for (const record of unmanagedCleanup) {
      try {
        await rm(record.rootPath, { force: true, recursive: true });
        records.delete(record.workspaceId);
      } catch {
        // Keep the deleting metadata so the next startup can retry safely.
      }
    }
    if (managedCleanup.length > 0 || unmanagedCleanup.length > 0) await persist();
  })();

  async function persist(): Promise<void> {
    await options.persistence?.replace(snapshotRecords());
  }

  quotaManager.registerAdapter(adapterId, {
    async remove(resourceRef) {
      const record = Array.from(records.values()).find(
        candidate => candidate.quotaResourceRef === resourceRef,
      );
      const workspaceId = resourceRef.startsWith('workspace:')
        ? resourceRef.slice('workspace:'.length)
        : '';
      const workspaceRoot = record?.rootPath
        || (workspaceId ? path.join(rootPath, `${WORKSPACE_DIRECTORY_PREFIX}${workspaceId}`) : null);
      if (workspaceRoot) await rm(workspaceRoot, { force: true, recursive: true });
      if (record) records.delete(record.workspaceId);
      if (options.persistence) await options.persistence.replace(snapshotRecords());
    },
  });

  async function assertControlledRoot(): Promise<void> {
    await mkdir(rootPath, { recursive: true });
    const rootStat = await lstat(rootPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error('Agent workspace root 不是受控目录');
    }
  }

  function getRecord(workspaceIdInput: string): WorkspaceRecord {
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    const record = records.get(workspaceId);
    if (!record) throw new Error('Agent workspace 不存在或已经清理');
    if (record.status === 'deleting') throw new Error('Agent workspace 正在清理');
    return record;
  }

  function assertWorkspaceOwner(
    record: WorkspaceRecord,
    ownerInput: AgentShellWorkspaceOwner,
  ): void {
    const owner = normalizeOwner(ownerInput);
    if (
      record.owner.accountScope !== owner.accountScope
      || record.owner.backendScope !== owner.backendScope
      || record.owner.sessionId !== owner.sessionId
    ) {
      throw new Error('当前 Agent Session 无权操作该工作区');
    }
  }

  async function assertNoSymlinkEscape(record: WorkspaceRecord, logicalPath: string): Promise<void> {
    const segments = logicalPath.split('/');
    let currentPath = record.rootPath;
    const rootStat = await lstat(currentPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error('Agent workspace root 无效');
    }
    for (let index = 0; index < segments.length; index += 1) {
      currentPath = path.join(currentPath, segments[index]);
      try {
        const currentStat = await lstat(currentPath);
        if (currentStat.isSymbolicLink()) throw new Error('Agent workspace 不允许 symlink');
        if (index < segments.length - 1 && !currentStat.isDirectory()) {
          throw new Error('Agent workspace 路径中间节点不是目录');
        }
      } catch (error) {
        if (!isMissingFileError(error) || index < segments.length - 1) throw error;
        break;
      }
    }
  }

  async function resolveLogicalPath(
    workspaceIdInput: string,
    logicalPathInput: string,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<{ logicalPath: string; workspaceId: string }> {
    await ready;
    const record = getRecord(workspaceIdInput);
    assertWorkspaceOwner(record, ownerInput);
    const logicalPath = normalizeLogicalPath(logicalPathInput);
    const physicalPath = path.resolve(record.rootPath, ...logicalPath.split('/'));
    if (physicalPath !== record.rootPath && !physicalPath.startsWith(`${record.rootPath}${path.sep}`)) {
      throw new Error('Agent workspace 逻辑路径越界');
    }
    await assertNoSymlinkEscape(record, logicalPath);
    return { logicalPath, workspaceId: record.workspaceId };
  }

  async function create(runIdInput: string, ownerInput: AgentShellWorkspaceOwner): Promise<AgentShellWorkspace> {
    await ready;
    const runId = normalizeRunId(runIdInput);
    const owner = normalizeOwner(ownerInput);
    await assertControlledRoot();
    const workspaceId = normalizeWorkspaceId(createId());
    if (!workspaceId) throw new Error('Agent workspace ID 无效');
    if (records.has(workspaceId)) throw new Error('Agent workspace ID 冲突');
    const quotaResourceRef = `workspace:${workspaceId}`;
    const reservationId = await quotaManager.reserve(
      owner,
      'workspace',
      runId,
      0,
      ttlMs,
      adapterId,
    );
    const workspaceRoot = path.join(rootPath, `${WORKSPACE_DIRECTORY_PREFIX}${workspaceId}`);
    let workspaceRootCreated = false;
    try {
      await mkdir(workspaceRoot, { recursive: false });
      workspaceRootCreated = true;
      for (const logicalRoot of WORKSPACE_ROOTS) {
        await mkdir(path.join(workspaceRoot, logicalRoot));
      }
      await quotaManager.bindResource(reservationId, quotaResourceRef, owner);
      await quotaManager.commit(reservationId, quotaResourceRef, 0, owner);
      const manifestEntries = new Map<string, AgentShellWorkspaceManifestEntry>();
      for (const logicalRoot of WORKSPACE_ROOTS) {
        manifestEntries.set(logicalRoot, {
          kind: 'directory',
          logicalPath: logicalRoot,
          sizeBytes: 0,
        });
      }
      const record: WorkspaceRecord = {
        generation: 1,
        manifestEntries,
        owner,
        provenance: new Set(),
        quotaResourceRef,
        rootPath: workspaceRoot,
        runId,
        status: 'active',
        workspaceId,
      };
      records.set(workspaceId, record);
      try {
        await persist();
      } catch (error) {
        records.delete(workspaceId);
        throw error;
      }
      return cloneWorkspace(record);
    } catch (error) {
      await quotaManager.cancelReservation(reservationId, owner);
      if (workspaceRootCreated) {
        await rm(workspaceRoot, { force: true, recursive: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  async function updateManifest(
    workspaceIdInput: string,
    update: AgentShellWorkspaceManifestUpdate,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<AgentShellWorkspaceManifest> {
    await ready;
    const record = getRecord(workspaceIdInput);
    assertWorkspaceOwner(record, ownerInput);
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error('Agent workspace manifest 更新无效');
    }
    if (
      update.expectedGeneration !== undefined
      && update.expectedGeneration !== record.generation
    ) {
      throw new Error('Agent workspace generation 已变化');
    }
    const entries = update.entries || [];
    const removals = update.remove || [];
    if (!Array.isArray(entries) || entries.length > MAX_MANIFEST_UPDATE_ENTRIES) {
      throw new Error('Agent workspace manifest 更新条目过多');
    }
    if (!Array.isArray(removals) || removals.length > MAX_MANIFEST_UPDATE_REMOVALS) {
      throw new Error('Agent workspace manifest 删除条目过多');
    }
    if (
      update.provenance !== undefined
      && (!Array.isArray(update.provenance) || update.provenance.length > MAX_PROVENANCE_ENTRIES)
    ) {
      throw new Error('Agent workspace provenance 条目过多');
    }
    const uniqueEntryPaths = new Set(entries.map(entry => String(entry?.logicalPath ?? '')));
    const uniqueRemovalPaths = new Set(removals.map(entry => String(entry ?? '')));
    const nextEntryCount = record.manifestEntries.size
      - Array.from(uniqueRemovalPaths).filter(logicalPath => record.manifestEntries.has(logicalPath)).length
      + Array.from(uniqueEntryPaths).filter(logicalPath => !record.manifestEntries.has(logicalPath)).length;
    if (nextEntryCount > MAX_MANIFEST_ENTRIES) {
      throw new Error('Agent workspace manifest 条目过多');
    }
    const normalizedEntries = await Promise.all(entries.map(async (entry) => {
      const logicalPath = (await resolveLogicalPath(record.workspaceId, entry.logicalPath, ownerInput)).logicalPath;
      const segments = logicalPath.split('/');
      const kind = normalizeEntryKind(entry.kind);
      if (segments.length === 1 && kind !== 'directory') {
        throw new Error('Agent workspace 根目录不能是文件');
      }
      return {
        contentHash: normalizeContentHash(entry.contentHash),
        kind,
        logicalPath,
        sizeBytes: normalizeBytes(entry.sizeBytes),
      } satisfies AgentShellWorkspaceManifestEntry;
    }));
    const normalizedRemovals = await Promise.all(removals.map(async logicalPath => (
      (await resolveLogicalPath(record.workspaceId, logicalPath, ownerInput)).logicalPath
    )));
    if (records.get(record.workspaceId) !== record || record.status !== 'active') {
      throw new Error('Agent workspace 不存在或已经清理');
    }
    if (
      update.expectedGeneration !== undefined
      && update.expectedGeneration !== record.generation
    ) {
      throw new Error('Agent workspace generation 已变化');
    }
    for (const logicalPath of normalizedRemovals) {
      if (!logicalPath.includes('/')) throw new Error('Agent workspace 根目录不能删除');
    }
    const before = snapshotRecords();
    for (const entry of normalizedEntries) record.manifestEntries.set(entry.logicalPath, entry);
    for (const logicalPath of normalizedRemovals) record.manifestEntries.delete(logicalPath);
    for (const provenance of update.provenance || []) record.provenance.add(normalizeProvenance(provenance));
    record.generation += 1;
    try {
      await persist();
    } catch (error) {
      restoreRecords(before);
      throw error;
    }
    return cloneManifest(record);
  }

  async function reportUsage(
    workspaceIdInput: string,
    actualBytesInput: number,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<AgentShellWorkspaceManifest> {
    await ready;
    const record = getRecord(workspaceIdInput);
    assertWorkspaceOwner(record, ownerInput);
    const actualBytes = normalizeBytes(actualBytesInput);
    await quotaManager.adjust(record.quotaResourceRef, actualBytes, record.owner);
    record.generation += 1;
    try {
      await persist();
    } catch (error) {
      record.generation -= 1;
      throw error;
    }
    return cloneManifest(record);
  }

  async function touch(
    workspaceIdInput: string,
    requestedTtlMs: number,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<boolean> {
    await ready;
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    const record = records.get(workspaceId);
    if (!record || record.status === 'deleting') return false;
    assertWorkspaceOwner(record, ownerInput);
    const touched = await quotaManager.touch(record.quotaResourceRef, requestedTtlMs, record.owner);
    if (touched) await persist();
    return touched;
  }

  async function requestCleanup(
    workspaceIdInput: string,
    ownerInput: AgentShellWorkspaceOwner,
  ) {
    await ready;
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    const record = records.get(workspaceId);
    if (!record) return { released: false, state: 'not_found' as const };
    assertWorkspaceOwner(record, ownerInput);
    record.status = 'deleting';
    const result = await quotaManager.requestRelease(record.quotaResourceRef, record.owner);
    await persist();
    return result;
  }

  function get(
    workspaceIdInput: string,
    ownerInput: AgentShellWorkspaceOwner,
  ): AgentShellWorkspace | null {
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    const record = records.get(workspaceId);
    if (!record || record.status !== 'active') return null;
    assertWorkspaceOwner(record, ownerInput);
    return cloneWorkspace(record);
  }

  async function dispose(): Promise<void> {
    quotaManager.unregisterAdapter(adapterId);
    await options.persistence?.close?.();
  }

  return {
    create,
    dispose,
    get,
    ready,
    reportUsage,
    requestCleanup,
    resolveLogicalPath,
    touch,
    updateManifest,
  };
}

export type AgentShellWorkspaceStore = ReturnType<typeof createAgentShellWorkspaceStore>;

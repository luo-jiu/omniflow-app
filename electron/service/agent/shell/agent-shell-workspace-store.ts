import crypto from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  agentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaObservedBytes,
  type AgentLocalStorageQuotaOwner,
} from '../storage/agent-local-storage-quota-manager';
import {
  assertAgentManagedRoot,
  captureAgentManagedRootChildDirectory,
  establishAgentManagedRoot,
  removeAgentManagedRootChild,
  resolveAgentManagedRootChild,
  type AgentManagedRoot,
} from '../storage/agent-managed-root';
import { normalizeAgentOwnerScope } from '../../../../src/shared/agent/agent-owner-scope';
import { normalizeAgentShellLogicalPath } from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION,
  scanAgentShellWorkspaceContent,
  type AgentShellWorkspaceContentSnapshot,
} from './agent-shell-workspace-content-scanner';

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

/** Main-only resolution used while freezing a Shell prepared action. */
export interface AgentShellWorkspacePreparationContext {
  generation: number;
  logicalCwd: string;
  owner: AgentShellWorkspaceOwner;
  workspaceMetadataIdentity: string;
  workspaceContentIdentity: string;
  workspaceContentScannerRevision: typeof AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION;
  workspaceEntryCount: number;
  workspaceTotalBytes: number;
  physicalCwdPath: string;
  physicalHomePath: string;
  physicalTempPath: string;
  runId: string;
  workspaceId: string;
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
  return normalizeAgentShellLogicalPath(value);
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

function hashManifestMetadata(
  record: WorkspaceRecord,
  workspaceContentIdentity: string,
): string {
  const manifest = cloneManifest(record);
  return `v2:${crypto.createHash('sha256').update(JSON.stringify({
    contentIdentity: workspaceContentIdentity,
    domain: 'omniflow.agent.shell.workspace-manifest',
    entries: manifest.entries,
    generation: manifest.generation,
    provenance: manifest.provenance,
    version: 2,
    workspaceId: manifest.workspaceId,
  })).digest('hex')}`;
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
  const configuredRootPath = path.resolve(
    normalizeString(options.rootPath, 'Agent workspace root', 4_096),
  );
  let rootPath = configuredRootPath;
  let managedRoot: AgentManagedRoot | null = null;
  const records = new Map<string, WorkspaceRecord>();
  const activeAdapterOperations = new Set<Promise<unknown>>();
  const activePublicOperations = new Set<Promise<unknown>>();
  let adapterAdmissionOpen = true;
  let closing = false;
  let disposePromise: Promise<void> | null = null;
  let mutationTail: Promise<void> = Promise.resolve();
  const adapterId = options.adapterId
    ? normalizeString(options.adapterId, 'Agent workspace adapter ID', 128)
    : `workspace:${normalizeWorkspaceId(createId())}`;

  function enqueueMutation<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = mutationTail.then(operation);
    mutationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  function trackOperation<T>(
    operations: Set<Promise<unknown>>,
    operation: Promise<T>,
  ): Promise<T> {
    operations.add(operation);
    void operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation),
    );
    return operation;
  }

  function runAdmittedOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new Error('Agent workspace store 正在关闭'));
    try {
      return trackOperation(activePublicOperations, operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function waitForOperations(operations: Set<Promise<unknown>>): Promise<void> {
    while (operations.size > 0) {
      await Promise.allSettled(Array.from(operations));
    }
  }

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
    await assertControlledRoot();
    const cleanup = await enqueueMutation(async () => {
      const before = snapshotRecords();
      try {
        if (options.persistence) restoreRecords(await options.persistence.load());
        let changed = false;
        const managed: Array<Pick<WorkspaceRecord, 'owner' | 'quotaResourceRef'>> = [];
        const unmanaged: string[] = [];
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
            await captureWorkspaceRoot(record);
          } catch {
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
            if (hasMatchingQuotaResource) {
              managed.push({
                owner: cloneOwner(record.owner),
                quotaResourceRef: record.quotaResourceRef,
              });
            } else if (!hasManagedQuotaResource) {
              unmanaged.push(record.workspaceId);
            }
          }
        }
        if (changed) await persist();
        return { managed, unmanaged };
      } catch (error) {
        restoreRecords(before);
        throw error;
      }
    });
    for (const target of cleanup.managed) {
      await quotaManager.requestRelease(target.quotaResourceRef, target.owner, 'unknown');
    }
    for (const workspaceId of cleanup.unmanaged) {
      await enqueueMutation(async () => {
        const record = records.get(workspaceId);
        if (!record || record.status !== 'deleting') return;
        try {
          await removeWorkspaceRoot(workspaceId);
        } catch {
          // Keep the deleting metadata so the next startup can retry safely.
          return;
        }
        const before = snapshotRecords();
        records.delete(workspaceId);
        try {
          await persist();
        } catch (error) {
          restoreRecords(before);
          throw error;
        }
      });
    }
    await enqueueMutation(removeUnmanagedCrashResidue);
  })();

  async function persist(): Promise<void> {
    await options.persistence?.replace(snapshotRecords());
  }

  quotaManager.registerAdapter(adapterId, {
    remove(resourceRef) {
      if (!adapterAdmissionOpen) {
        return Promise.reject(new Error('Agent workspace adapter 正在关闭'));
      }
      return trackOperation(activeAdapterOperations, enqueueMutation(async () => {
        const record = Array.from(records.values()).find(
          candidate => candidate.quotaResourceRef === resourceRef,
        );
        const workspaceId = resourceRef.startsWith('workspace:')
          ? resourceRef.slice('workspace:'.length)
          : '';
        const resolvedWorkspaceId = record?.workspaceId || workspaceId;
        if (resolvedWorkspaceId) await removeWorkspaceRoot(resolvedWorkspaceId);
        if (record) records.delete(record.workspaceId);
        try {
          await persist();
        } catch (error) {
          if (record) {
            record.status = 'deleting';
            records.set(record.workspaceId, record);
          }
          throw error;
        }
      }));
    },
  });

  async function assertControlledRoot(): Promise<AgentManagedRoot> {
    if (!managedRoot) {
      managedRoot = await establishAgentManagedRoot({
        createIfMissing: true,
        label: 'Agent workspace root',
        rootPath: configuredRootPath,
      });
      if (!managedRoot) throw new Error('Agent workspace root 不存在');
      rootPath = managedRoot.canonicalPath;
    } else {
      await assertAgentManagedRoot(managedRoot);
    }
    return managedRoot;
  }

  function workspaceDirectoryName(workspaceIdInput: string): string {
    return `${WORKSPACE_DIRECTORY_PREFIX}${normalizeWorkspaceId(workspaceIdInput)}`;
  }

  async function captureWorkspaceRoot(record: WorkspaceRecord) {
    const root = await assertControlledRoot();
    const expectedPath = resolveAgentManagedRootChild(root, workspaceDirectoryName(record.workspaceId));
    if (record.rootPath !== expectedPath) throw new Error('Agent workspace root 身份已变化');
    return captureAgentManagedRootChildDirectory(root, workspaceDirectoryName(record.workspaceId));
  }

  async function removeWorkspaceRoot(workspaceIdInput: string): Promise<void> {
    const root = await assertControlledRoot();
    await removeAgentManagedRootChild(root, workspaceDirectoryName(workspaceIdInput));
  }

  async function removeUnmanagedCrashResidue(): Promise<void> {
    const root = await assertControlledRoot();
    const entries = await readdir(root.canonicalPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith(WORKSPACE_DIRECTORY_PREFIX)) continue;
      let workspaceId: string;
      try {
        workspaceId = normalizeWorkspaceId(entry.name.slice(WORKSPACE_DIRECTORY_PREFIX.length));
      } catch {
        continue;
      }
      if (records.has(workspaceId)) continue;
      const resourceRef = `workspace:${workspaceId}`;
      if (await quotaManager.hasManagedResource(adapterId, resourceRef)) continue;
      await removeAgentManagedRootChild(root, workspaceDirectoryName(workspaceId));
    }
    await assertAgentManagedRoot(root);
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
    await captureWorkspaceRoot(record);
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
    await captureWorkspaceRoot(record);
    const logicalPath = normalizeLogicalPath(logicalPathInput);
    const physicalPath = path.resolve(record.rootPath, ...logicalPath.split('/'));
    if (physicalPath !== record.rootPath && !physicalPath.startsWith(`${record.rootPath}${path.sep}`)) {
      throw new Error('Agent workspace 逻辑路径越界');
    }
    await assertNoSymlinkEscape(record, logicalPath);
    return { logicalPath, workspaceId: record.workspaceId };
  }

  async function resolvePreparationContext(
    workspaceIdInput: string,
    logicalCwdInput: string,
    expectedRunIdInput: string,
    ownerInput: AgentShellWorkspaceOwner,
    signal?: AbortSignal,
  ): Promise<AgentShellWorkspacePreparationContext> {
    await ready;
    const record = getRecord(workspaceIdInput);
    assertWorkspaceOwner(record, ownerInput);
    const expectedRunId = normalizeRunId(expectedRunIdInput);
    if (record.runId !== expectedRunId) throw new Error('Agent workspace Run 不匹配');
    const quotaLease = await quotaManager.acquireLease(record.quotaResourceRef, ttlMs, record.owner);
    let cleanupRequiredOnFailure = false;
    let contentSnapshot: AgentShellWorkspaceContentSnapshot | undefined;
    let deletionObservedBytes: AgentLocalStorageQuotaObservedBytes = 'unknown';
    let preparationContext: AgentShellWorkspacePreparationContext | undefined;
    let preparationError: unknown;
    let quarantineRequired = false;
    try {
      const initialGeneration = record.generation;
      cleanupRequiredOnFailure = true;
      const workspaceRootIdentity = await captureWorkspaceRoot(record);
      cleanupRequiredOnFailure = false;
      const logicalPath = normalizeLogicalPath(logicalCwdInput);
      const physicalCwdPath = path.resolve(record.rootPath, ...logicalPath.split('/'));
      const physicalHomePath = path.join(record.rootPath, 'home');
      const physicalTempPath = path.join(record.rootPath, 'tmp');
      const cwdStat = await lstat(physicalCwdPath).catch((error) => {
        if (isMissingFileError(error)) throw new Error('Agent workspace cwd 不存在');
        throw error;
      });
      if (cwdStat.isSymbolicLink() || !cwdStat.isDirectory()) {
        throw new Error('Agent workspace cwd 不是目录');
      }
      cleanupRequiredOnFailure = true;
      const [homeStat, tempStat] = await Promise.all([
        lstat(physicalHomePath),
        lstat(physicalTempPath),
      ]);
      if (
        homeStat.isSymbolicLink()
        || !homeStat.isDirectory()
        || tempStat.isSymbolicLink()
        || !tempStat.isDirectory()
      ) {
        throw new Error('Agent workspace home 或 tmp 不是受控目录');
      }
      const [canonicalRoot, canonicalCwd, canonicalHome, canonicalTemp] = await Promise.all([
        realpath(record.rootPath),
        realpath(physicalCwdPath),
        realpath(physicalHomePath),
        realpath(physicalTempPath),
      ]);
      const rootPrefix = `${canonicalRoot}${path.sep}`;
      const expectedHome = path.join(canonicalRoot, 'home');
      const expectedTemp = path.join(canonicalRoot, 'tmp');
      if (
        (canonicalCwd !== canonicalRoot && !canonicalCwd.startsWith(rootPrefix))
        || canonicalHome !== expectedHome
        || canonicalTemp !== expectedTemp
      ) {
        throw new Error('Agent workspace cwd 已逃逸受控目录');
      }
      contentSnapshot = await scanAgentShellWorkspaceContent({
        expectedRootIdentity: workspaceRootIdentity,
        logicalRoots: WORKSPACE_ROOTS,
        provenance: Array.from(record.provenance),
        rootPath: record.rootPath,
        signal,
      });
      const [finalRoot, finalCwd, finalHome, finalTemp] = await Promise.all([
        realpath(record.rootPath),
        realpath(physicalCwdPath),
        realpath(physicalHomePath),
        realpath(physicalTempPath),
      ]);
      const finalWorkspaceRootIdentity = await captureWorkspaceRoot(record);
      if (records.get(record.workspaceId)?.status === 'deleting') {
        throw new Error('Agent workspace 正在清理');
      }
      if (
        finalRoot !== canonicalRoot
        || finalWorkspaceRootIdentity.canonicalPath !== workspaceRootIdentity.canonicalPath
        || finalWorkspaceRootIdentity.device !== workspaceRootIdentity.device
        || finalWorkspaceRootIdentity.inode !== workspaceRootIdentity.inode
        || finalCwd !== canonicalCwd
        || finalHome !== canonicalHome
        || finalTemp !== canonicalTemp
        || records.get(record.workspaceId) !== record
        || record.generation !== initialGeneration
      ) {
        throw new Error('Agent workspace generation 已变化');
      }
      deletionObservedBytes = contentSnapshot.totalBytes;
      await quotaManager.adjust(
        record.quotaResourceRef,
        contentSnapshot.totalBytes,
        record.owner,
      );
      if (records.get(record.workspaceId)?.status === 'deleting') {
        deletionObservedBytes = 'unknown';
        throw new Error('Agent workspace 正在清理');
      }
      if (
        records.get(record.workspaceId) !== record
        || record.generation !== initialGeneration
      ) {
        deletionObservedBytes = 'unknown';
        throw new Error('Agent workspace generation 已变化');
      }
      preparationContext = Object.freeze({
        generation: record.generation,
        logicalCwd: logicalPath,
        owner: Object.freeze(cloneOwner(record.owner)),
        physicalCwdPath: canonicalCwd,
        physicalHomePath: canonicalHome,
        physicalTempPath: canonicalTemp,
        runId: record.runId,
        workspaceContentIdentity: contentSnapshot.identity,
        workspaceContentScannerRevision: contentSnapshot.scannerRevision,
        workspaceEntryCount: contentSnapshot.entryCount,
        workspaceId: record.workspaceId,
        workspaceMetadataIdentity: hashManifestMetadata(record, contentSnapshot.identity),
        workspaceTotalBytes: contentSnapshot.totalBytes,
      });
    } catch (error) {
      preparationError = error;
      quarantineRequired = cleanupRequiredOnFailure;
    }
    await enqueueMutation(async () => {
      const current = records.get(record.workspaceId);
      if (!current) {
        if (preparationContext) {
          preparationContext = undefined;
          preparationError = new Error('Agent workspace generation 已变化');
        }
        return;
      }
      if (
        preparationContext
        && (current !== record || current.generation !== preparationContext.generation)
      ) {
        preparationContext = undefined;
        preparationError = new Error('Agent workspace generation 已变化');
        quarantineRequired = true;
      }
      if (quarantineRequired && current.status === 'active') current.status = 'deleting';
      if (current.status !== 'deleting') return;
      try {
        await quotaManager.markDeleting(
          current.quotaResourceRef,
          current.owner,
          deletionObservedBytes,
        );
        await persist();
      } catch {
        try {
          await persist();
        } catch {
          preparationError = new Error('Agent workspace 无法持久化失败清理意图');
        }
      }
    });
    let released = false;
    try {
      released = await quotaManager.releaseLease(
        record.quotaResourceRef,
        quotaLease.leaseId,
        record.owner,
      );
    } catch {
      throw new Error('Agent workspace 扫描 lease 释放失败');
    }
    if (!released) throw new Error('Agent workspace 扫描 lease 释放失败');
    const cleanupTarget = await enqueueMutation(() => {
      const current = records.get(record.workspaceId);
      if (!current || current.status !== 'deleting') return null;
      return {
        owner: cloneOwner(current.owner),
        quotaResourceRef: current.quotaResourceRef,
      };
    });
    if (cleanupTarget) {
      if (!preparationError) preparationError = new Error('Agent workspace generation 已变化');
      try {
        await quotaManager.requestRelease(
          cleanupTarget.quotaResourceRef,
          cleanupTarget.owner,
          deletionObservedBytes,
        );
      } catch {
        throw new Error('Agent workspace 扫描后清理失败');
      }
    }
    if (preparationError) throw preparationError;
    if (!preparationContext) throw new Error('Agent workspace preparation context 缺失');
    return preparationContext;
  }

  async function create(runIdInput: string, ownerInput: AgentShellWorkspaceOwner): Promise<AgentShellWorkspace> {
    await ready;
    const runId = normalizeRunId(runIdInput);
    const owner = normalizeOwner(ownerInput);
    const root = await assertControlledRoot();
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
    const workspaceRoot = resolveAgentManagedRootChild(root, workspaceDirectoryName(workspaceId));
    let workspaceRootCreated = false;
    try {
      await mkdir(workspaceRoot, { recursive: false });
      workspaceRootCreated = true;
      for (const logicalRoot of WORKSPACE_ROOTS) {
        await mkdir(path.join(workspaceRoot, logicalRoot));
      }
      await captureAgentManagedRootChildDirectory(root, workspaceDirectoryName(workspaceId));
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
      return await enqueueMutation(async () => {
        if (records.has(workspaceId)) throw new Error('Agent workspace ID 冲突');
        records.set(workspaceId, record);
        try {
          await persist();
        } catch (error) {
          records.delete(workspaceId);
          throw error;
        }
        return cloneWorkspace(record);
      });
    } catch (error) {
      await quotaManager.cancelReservation(reservationId, owner);
      if (workspaceRootCreated) {
        await removeAgentManagedRootChild(root, workspaceDirectoryName(workspaceId))
          .catch(() => undefined);
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
    return enqueueMutation(async () => {
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
      const normalizedEntries = await Promise.all(entries.map(async (entry) => {
        const logicalPath = (
          await resolveLogicalPath(record.workspaceId, entry.logicalPath, ownerInput)
        ).logicalPath;
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
      for (const logicalPath of normalizedRemovals) {
        if (!logicalPath.includes('/')) throw new Error('Agent workspace 根目录不能删除');
      }
      const uniqueEntryPaths = new Set(normalizedEntries.map(entry => entry.logicalPath));
      const uniqueRemovalPaths = new Set(normalizedRemovals);
      const nextEntryCount = record.manifestEntries.size
        - Array.from(uniqueRemovalPaths)
          .filter(logicalPath => record.manifestEntries.has(logicalPath)).length
        + Array.from(uniqueEntryPaths)
          .filter(logicalPath => !record.manifestEntries.has(logicalPath)).length;
      if (nextEntryCount > MAX_MANIFEST_ENTRIES) {
        throw new Error('Agent workspace manifest 条目过多');
      }
      const normalizedProvenance = (update.provenance || []).map(normalizeProvenance);
      const nextProvenance = new Set(record.provenance);
      for (const provenance of normalizedProvenance) nextProvenance.add(provenance);
      if (nextProvenance.size > MAX_PROVENANCE_ENTRIES) {
        throw new Error('Agent workspace provenance 条目过多');
      }
      const previousGeneration = record.generation;
      const previousManifestEntries = record.manifestEntries;
      const previousProvenance = record.provenance;
      record.manifestEntries = new Map(record.manifestEntries);
      for (const entry of normalizedEntries) record.manifestEntries.set(entry.logicalPath, entry);
      for (const logicalPath of normalizedRemovals) record.manifestEntries.delete(logicalPath);
      record.provenance = nextProvenance;
      record.generation += 1;
      try {
        await persist();
      } catch (error) {
        record.generation = previousGeneration;
        record.manifestEntries = previousManifestEntries;
        record.provenance = previousProvenance;
        throw error;
      }
      return cloneManifest(record);
    });
  }

  async function reportUsage(
    workspaceIdInput: string,
    actualBytesInput: number,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<AgentShellWorkspaceManifest> {
    await ready;
    const actualBytes = normalizeBytes(actualBytesInput);
    return enqueueMutation(async () => {
      const record = getRecord(workspaceIdInput);
      assertWorkspaceOwner(record, ownerInput);
      const previousGeneration = record.generation;
      await quotaManager.adjust(record.quotaResourceRef, actualBytes, record.owner);
      record.generation += 1;
      try {
        await persist();
      } catch (error) {
        record.generation = previousGeneration;
        throw error;
      }
      return cloneManifest(record);
    });
  }

  async function touch(
    workspaceIdInput: string,
    requestedTtlMs: number,
    ownerInput: AgentShellWorkspaceOwner,
  ): Promise<boolean> {
    await ready;
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    return enqueueMutation(async () => {
      const record = records.get(workspaceId);
      if (!record || record.status === 'deleting') return false;
      assertWorkspaceOwner(record, ownerInput);
      const touched = await quotaManager.touch(
        record.quotaResourceRef,
        requestedTtlMs,
        record.owner,
      );
      if (touched) await persist();
      return touched;
    });
  }

  async function requestCleanup(
    workspaceIdInput: string,
    ownerInput: AgentShellWorkspaceOwner,
  ) {
    await ready;
    const workspaceId = normalizeWorkspaceId(workspaceIdInput);
    const cleanupTarget = await enqueueMutation(async () => {
      const record = records.get(workspaceId);
      if (!record) return null;
      assertWorkspaceOwner(record, ownerInput);
      const previousStatus = record.status;
      record.status = 'deleting';
      try {
        await persist();
      } catch (error) {
        record.status = previousStatus;
        throw error;
      }
      return {
        owner: cloneOwner(record.owner),
        quotaResourceRef: record.quotaResourceRef,
      };
    });
    if (!cleanupTarget) return { released: false, state: 'not_found' as const };
    return quotaManager.requestRelease(
      cleanupTarget.quotaResourceRef,
      cleanupTarget.owner,
      'unknown',
    );
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

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    closing = true;
    disposePromise = (async () => {
      await ready.catch(() => undefined);
      await waitForOperations(activePublicOperations);
      adapterAdmissionOpen = false;
      await waitForOperations(activeAdapterOperations);
      await mutationTail;
      quotaManager.unregisterAdapter(adapterId);
      await options.persistence?.close?.();
    })();
    return disposePromise;
  }

  function admit<TArguments extends unknown[], TResult>(
    operation: (...args: TArguments) => Promise<TResult>,
  ): (...args: TArguments) => Promise<TResult> {
    return (...args) => runAdmittedOperation(() => operation(...args));
  }

  const admittedCreate = admit(create);
  const admittedReportUsage = admit(reportUsage);
  const admittedRequestCleanup = admit(requestCleanup);
  const admittedResolveLogicalPath = admit(resolveLogicalPath);
  const admittedResolvePreparationContext = admit(resolvePreparationContext);
  const admittedTouch = admit(touch);
  const admittedUpdateManifest = admit(updateManifest);

  function admittedGet(...args: Parameters<typeof get>): ReturnType<typeof get> {
    if (closing) return null;
    return get(...args);
  }

  return {
    create: admittedCreate,
    dispose,
    get: admittedGet,
    ready,
    reportUsage: admittedReportUsage,
    requestCleanup: admittedRequestCleanup,
    resolveLogicalPath: admittedResolveLogicalPath,
    resolvePreparationContext: admittedResolvePreparationContext,
    touch: admittedTouch,
    updateManifest: admittedUpdateManifest,
  };
}

export type AgentShellWorkspaceStore = ReturnType<typeof createAgentShellWorkspaceStore>;

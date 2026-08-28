import crypto from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  type FileHandle,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

import type { AgentOwnerScope } from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import {
  normalizeStagedFileName,
  resolveTempImportStagingRoot,
} from '../stagedFilePolicy';
import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaManager,
} from './storage/agent-local-storage-quota-manager';
import {
  assertAgentManagedRoot,
  captureAgentManagedRootChildDirectory,
  establishAgentManagedRoot,
  removeAgentManagedRootChild,
  resolveAgentManagedRootChild,
  type AgentManagedRoot,
} from './storage/agent-managed-root';
import { getAgentPersistenceRuntime } from './agent-persistence-runtime';

export const AGENT_MEDIA_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_ARTIFACT_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_ACTIVE_ARTIFACTS = 4;
const AGENT_MEDIA_DIRECTORY_PREFIX = 'agent-media-';
const AGENT_MEDIA_QUOTA_ADAPTER_ID = 'media-artifact';
const AGENT_MEDIA_QUOTA_CATEGORY = 'artifact';
const AGENT_MEDIA_RESOURCE_REF_PREFIX = `${AGENT_MEDIA_QUOTA_ADAPTER_ID}:`;
const MAX_ARTIFACT_ID_LENGTH = 128;

export interface AgentMediaArtifactOwner {
  executionId: string;
  ownerScope: AgentOwnerScope;
  ownerWebContentsId: number;
  runId: string;
  sessionId: string;
}

export interface AgentMediaArtifact {
  artifactId: string;
  directoryPath: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

export interface AgentMediaOwnedFile {
  artifact: AgentMediaArtifact;
  fileHandle: FileHandle;
  verifyUnchanged: () => Promise<void>;
}

interface AgentMediaArtifactRecord extends AgentMediaArtifact, AgentMediaArtifactOwner {
  createdAt: number;
  allocatedBytes?: number;
  fileIdentity?: {
    ctimeNs: bigint;
    device: bigint;
    inode: bigint;
  };
  quotaLeaseId?: string;
  quotaReservationId: string;
  resourceRef: string;
}

interface AgentMediaArtifactStoreOptions {
  createId?: () => string;
  legacyRootPaths?: string[];
  maxActiveArtifacts?: number;
  now?: () => number;
  quotaManager?: AgentLocalStorageQuotaManager;
  resolveQuotaManager?: () => AgentLocalStorageQuotaManager | Promise<AgentLocalStorageQuotaManager>;
  resolveRootPath?: () => string;
  rootPath?: string;
  ttlMs?: number;
}

function normalizeArtifactId(value: unknown): string {
  const artifactId = String(value ?? '').trim();
  if (
    !artifactId
    || artifactId.length > MAX_ARTIFACT_ID_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(artifactId)
  ) {
    throw new Error('Agent 媒体临时产物 ID 无效');
  }
  return artifactId;
}

function normalizeOwner(owner: AgentMediaArtifactOwner): AgentMediaArtifactOwner {
  return {
    executionId: String(owner.executionId || '').trim(),
    ownerScope: normalizeAgentOwnerScope(owner.ownerScope),
    ownerWebContentsId: Number(owner.ownerWebContentsId),
    runId: String(owner.runId || '').trim(),
    sessionId: String(owner.sessionId || '').trim(),
  };
}

function sameOwner(
  record: AgentMediaArtifactRecord,
  owner: AgentMediaArtifactOwner,
): boolean {
  return record.executionId === owner.executionId
    && record.ownerScope.accountScope === owner.ownerScope.accountScope
    && record.ownerScope.backendScope === owner.ownerScope.backendScope
    && record.ownerWebContentsId === owner.ownerWebContentsId
    && record.runId === owner.runId
    && record.sessionId === owner.sessionId;
}

function toArtifact(record: AgentMediaArtifactRecord): AgentMediaArtifact {
  return {
    artifactId: record.artifactId,
    directoryPath: record.directoryPath,
    fileName: record.fileName,
    filePath: record.filePath,
    sizeBytes: record.sizeBytes,
  };
}

function sameFileIdentity(
  stat: Pick<BigIntStats, 'dev' | 'ino'>,
  identity: { device: bigint; inode: bigint },
): boolean {
  return stat.dev === identity.device && stat.ino === identity.inode;
}

export function createAgentMediaArtifactStore(
  options: AgentMediaArtifactStoreOptions = {},
) {
  const createId = options.createId || crypto.randomUUID;
  const maxActiveArtifacts = Math.max(
    1,
    Math.min(Number(options.maxActiveArtifacts) || DEFAULT_MAX_ACTIVE_ARTIFACTS, 16),
  );
  const now = options.now || Date.now;
  let configuredRootPath = options.rootPath
    ? path.resolve(options.rootPath)
    : options.resolveRootPath
      ? null
      : path.resolve(resolveTempImportStagingRoot(os.tmpdir()));
  const configuredLegacyRootPaths = Array.from(new Set(
    (options.legacyRootPaths || []).map(legacyRootPath => path.resolve(legacyRootPath)),
  ));
  const ttlMs = Math.max(1_000, Number(options.ttlMs) || DEFAULT_ARTIFACT_TTL_MS);
  const records = new Map<string, AgentMediaArtifactRecord>();
  const fallbackQuotaManager = options.quotaManager || options.resolveQuotaManager
    ? null
    : createAgentLocalStorageQuotaManager({ now });
  let quotaManagerInstance: AgentLocalStorageQuotaManager | null = null;
  let quotaManagerPromise: Promise<AgentLocalStorageQuotaManager> | null = null;
  let managedRootsPromise: Promise<{
    readonly current: AgentManagedRoot;
    readonly legacy: readonly AgentManagedRoot[];
  }> | null = null;
  let pendingCreateCount = 0;
  let sweepPromise: Promise<void> | null = null;
  const artifactOperationTails = new Map<string, Promise<void>>();

  async function withArtifactOperation<T>(
    artifactIdInput: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const artifactId = String(artifactIdInput || '').trim();
    const previous = artifactOperationTails.get(artifactId) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    artifactOperationTails.set(artifactId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (artifactOperationTails.get(artifactId) === tail) {
        artifactOperationTails.delete(artifactId);
      }
    }
  }

  function getConfiguredRootPath(): string {
    if (!configuredRootPath) {
      const resolved = String(options.resolveRootPath?.() || '').trim();
      if (!resolved) throw new Error('Agent 媒体临时产物根目录无效');
      configuredRootPath = path.resolve(resolved);
    }
    return configuredRootPath;
  }

  async function resolveManagedRoots() {
    if (!managedRootsPromise) {
      managedRootsPromise = (async () => {
        const currentConfiguredRoot = getConfiguredRootPath();
        const current = await establishAgentManagedRoot({
          createIfMissing: true,
          label: 'Agent 媒体临时产物根目录',
          rootPath: currentConfiguredRoot,
        });
        if (!current) throw new Error('Agent 媒体临时产物根目录不存在');
        const legacy = (await Promise.all(configuredLegacyRootPaths
          .filter(legacyRootPath => legacyRootPath !== currentConfiguredRoot)
          .map(async (legacyRootPath) => {
            try {
              return await establishAgentManagedRoot({
                createIfMissing: false,
                label: 'Agent 媒体旧临时产物根目录',
                rootPath: legacyRootPath,
              });
            } catch {
              return null;
            }
          }))).filter((root): root is AgentManagedRoot => Boolean(root));
        return Object.freeze({ current, legacy: Object.freeze(legacy) });
      })().catch((error) => {
        managedRootsPromise = null;
        throw error;
      });
    }
    return managedRootsPromise!;
  }

  async function getVerifiedManagedRoots(): Promise<{
    readonly current: AgentManagedRoot;
    readonly legacy: readonly AgentManagedRoot[];
  }> {
    const roots = await resolveManagedRoots();
    await assertAgentManagedRoot(roots.current);
    for (const root of roots.legacy) {
      await assertAgentManagedRoot(root);
    }
    return roots;
  }

  function resourceRefForArtifact(artifactId: string): string {
    return `${AGENT_MEDIA_RESOURCE_REF_PREFIX}${normalizeArtifactId(artifactId)}`;
  }

  function artifactIdFromResourceRef(resourceRef: string): string {
    if (!resourceRef.startsWith(AGENT_MEDIA_RESOURCE_REF_PREFIX)) {
      throw new Error('Agent 媒体临时产物引用无效');
    }
    return normalizeArtifactId(resourceRef.slice(AGENT_MEDIA_RESOURCE_REF_PREFIX.length));
  }

  function directoryNameForArtifact(artifactId: string): string {
    return `${AGENT_MEDIA_DIRECTORY_PREFIX}${normalizeArtifactId(artifactId)}`;
  }

  function directoryPathForArtifactAtRoot(root: AgentManagedRoot, artifactId: string): string {
    return resolveAgentManagedRootChild(root, directoryNameForArtifact(artifactId));
  }

  async function removePhysicalResource(resourceRef: string): Promise<void> {
    const artifactId = artifactIdFromResourceRef(resourceRef);
    const roots = await getVerifiedManagedRoots();
    await removeAgentManagedRootChild(roots.current, directoryNameForArtifact(artifactId));
    await Promise.all(roots.legacy.map(root => (
      removeAgentManagedRootChild(root, directoryNameForArtifact(artifactId))
    )));
    const record = records.get(artifactId);
    if (record?.resourceRef === resourceRef) records.delete(artifactId);
  }

  async function resolveQuotaManager(): Promise<AgentLocalStorageQuotaManager> {
    if (quotaManagerInstance) return quotaManagerInstance;
    if (!quotaManagerPromise) {
      quotaManagerPromise = Promise.resolve(
        options.quotaManager
          || options.resolveQuotaManager?.()
          || fallbackQuotaManager,
      ).then(async (quotaManager) => {
        if (!quotaManager) throw new Error('Agent 媒体临时产物配额不可用');
        await quotaManager.ready;
        quotaManager.registerAdapter(AGENT_MEDIA_QUOTA_ADAPTER_ID, {
          remove: removePhysicalResource,
        });
        quotaManagerInstance = quotaManager;
        return quotaManager;
      }).catch((error) => {
        quotaManagerPromise = null;
        throw error;
      });
    }
    return quotaManagerPromise;
  }

  async function removeRecord(record: AgentMediaArtifactRecord): Promise<void> {
    records.delete(record.artifactId);
    const quotaManager = await resolveQuotaManager();
    if (record.quotaLeaseId) {
      await quotaManager.releaseLease(
        record.resourceRef,
        record.quotaLeaseId,
        record.ownerScope,
      ).catch(() => false);
      delete record.quotaLeaseId;
    }
    const result = await quotaManager.requestRelease(record.resourceRef, record.ownerScope);
    if (result.state === 'not_found') {
      await removePhysicalResource(record.resourceRef);
    }
  }

  async function verifyArtifactFileHandle(
    record: AgentMediaArtifactRecord,
    fileHandle: FileHandle,
  ): Promise<{
    allocatedBytes: number;
    ctimeNs: bigint;
    device: bigint;
    inode: bigint;
    sizeBytes: number;
  } | null> {
    const roots = await getVerifiedManagedRoots();
    const directoryIdentity = await captureAgentManagedRootChildDirectory(
      roots.current,
      directoryNameForArtifact(record.artifactId),
    );
    const expectedFilePath = path.join(directoryIdentity.canonicalPath, record.fileName);
    if (path.resolve(record.filePath) !== expectedFilePath) return null;

    const pathStat = await lstat(record.filePath, { bigint: true }).catch(() => null);
    if (!pathStat?.isFile() || pathStat.isSymbolicLink()) return null;
    const handleStat = await fileHandle.stat({ bigint: true }).catch(() => null);
    if (
      !handleStat?.isFile()
      || !sameFileIdentity(handleStat, { device: pathStat.dev, inode: pathStat.ino })
    ) {
      return null;
    }
    const canonicalFilePath = await realpath(record.filePath).catch(() => null);
    if (canonicalFilePath !== expectedFilePath) return null;
    const finalPathStat = await lstat(record.filePath, { bigint: true }).catch(() => null);
    if (
      !finalPathStat?.isFile()
      || finalPathStat.isSymbolicLink()
      || !sameFileIdentity(finalPathStat, { device: handleStat.dev, inode: handleStat.ino })
    ) {
      return null;
    }
    const finalDirectoryIdentity = await captureAgentManagedRootChildDirectory(
      roots.current,
      directoryNameForArtifact(record.artifactId),
    );
    if (
      finalDirectoryIdentity.canonicalPath !== directoryIdentity.canonicalPath
      || finalDirectoryIdentity.device !== directoryIdentity.device
      || finalDirectoryIdentity.inode !== directoryIdentity.inode
    ) {
      return null;
    }
    if (record.fileIdentity && !sameFileIdentity(handleStat, record.fileIdentity)) return null;
    if (record.fileIdentity && handleStat.ctimeNs !== record.fileIdentity.ctimeNs) return null;
    const sizeBytes = Number(handleStat.size);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;
    const allocatedBytes = Number(
      handleStat.blocks * 512n > handleStat.size
        ? handleStat.blocks * 512n
        : handleStat.size,
    );
    if (!Number.isSafeInteger(allocatedBytes) || allocatedBytes < sizeBytes) return null;
    return {
      allocatedBytes,
      ctimeNs: handleStat.ctimeNs,
      device: handleStat.dev,
      inode: handleStat.ino,
      sizeBytes,
    };
  }

  async function openArtifactFile(record: AgentMediaArtifactRecord): Promise<{
    fileHandle: FileHandle;
    identity: NonNullable<Awaited<ReturnType<typeof verifyArtifactFileHandle>>>;
  } | null> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const fileHandle = await open(record.filePath, constants.O_RDONLY | noFollow).catch(() => null);
    if (!fileHandle) return null;
    const identity = await verifyArtifactFileHandle(record, fileHandle).catch(() => null);
    if (!identity) {
      await fileHandle.close().catch(() => undefined);
      return null;
    }
    return { fileHandle, identity };
  }

  async function inspectArtifactFile(
    record: AgentMediaArtifactRecord,
  ): Promise<NonNullable<Awaited<ReturnType<typeof verifyArtifactFileHandle>>> | null> {
    const opened = await openArtifactFile(record);
    if (!opened) return null;
    try {
      return opened.identity;
    } finally {
      await opened.fileHandle.close();
    }
  }

  async function removeUnmanagedCrashResidue(
    quotaManager: AgentLocalStorageQuotaManager,
  ): Promise<void> {
    const cutoff = now() - ttlMs;
    const activeDirectories = new Set(Array.from(records.values()).map(record => record.directoryPath));
    const roots = await getVerifiedManagedRoots();
    await Promise.all([roots.current, ...roots.legacy].map(async (managedRoot) => {
      const entries = await readdir(managedRoot.canonicalPath, { withFileTypes: true });
      await Promise.all(entries
        .filter(entry => entry.name.startsWith(AGENT_MEDIA_DIRECTORY_PREFIX))
        .map(async (entry) => {
          const directoryPath = resolveAgentManagedRootChild(managedRoot, entry.name);
          if (activeDirectories.has(directoryPath)) return;
          const artifactId = entry.name.slice(AGENT_MEDIA_DIRECTORY_PREFIX.length);
          let managed = false;
          try {
            managed = await quotaManager.hasManagedResource(
              AGENT_MEDIA_QUOTA_ADAPTER_ID,
              resourceRefForArtifact(artifactId),
            );
          } catch {
            // Legacy random directories can contain IDs outside the current safe format.
          }
          if (managed) return;
          const directoryStat = await lstat(directoryPath).catch(() => null);
          if (!directoryStat || directoryStat.mtimeMs > cutoff) return;
          await removeAgentManagedRootChild(managedRoot, entry.name);
        }));
      await assertAgentManagedRoot(managedRoot);
    }));
  }

  async function sweepExpired(): Promise<void> {
    if (!sweepPromise) {
      sweepPromise = (async () => {
        const quotaManager = await resolveQuotaManager();
        await quotaManager.sweep('media-artifact-expired');
        await removeUnmanagedCrashResidue(quotaManager);
      })().finally(() => {
        sweepPromise = null;
      });
    }
    return sweepPromise;
  }

  async function create(
    fileName: string,
    ownerInput: AgentMediaArtifactOwner,
  ): Promise<AgentMediaArtifact> {
    await sweepExpired();
    if (records.size + pendingCreateCount >= maxActiveArtifacts) {
      throw new Error(`Agent 媒体临时产物数量已达到上限：${maxActiveArtifacts}`);
    }
    pendingCreateCount += 1;
    const owner = normalizeOwner(ownerInput);
    const quotaManager = await resolveQuotaManager();
    let quotaReservationId: string | null = null;
    let pendingQuotaLeaseId: string | null = null;
    let pendingDirectoryPath: string | null = null;
    let pendingDirectoryName: string | null = null;
    let pendingResourceRef: string | null = null;
    let pendingDirectoryCreated = false;
    let resourceBound = false;
    try {
      const artifactId = normalizeArtifactId(createId());
      const resourceRef = resourceRefForArtifact(artifactId);
      const roots = await getVerifiedManagedRoots();
      const directoryName = directoryNameForArtifact(artifactId);
      const directoryPath = directoryPathForArtifactAtRoot(roots.current, artifactId);
      const normalizedFileName = normalizeStagedFileName(fileName, 'extracted-audio.m4a');
      pendingDirectoryPath = directoryPath;
      pendingDirectoryName = directoryName;
      pendingResourceRef = resourceRef;
      quotaReservationId = await quotaManager.reserve(
        owner.ownerScope,
        AGENT_MEDIA_QUOTA_CATEGORY,
        owner.runId,
        AGENT_MEDIA_MAX_ARTIFACT_BYTES,
        ttlMs,
        AGENT_MEDIA_QUOTA_ADAPTER_ID,
      );
      await mkdir(directoryPath);
      pendingDirectoryCreated = true;
      await captureAgentManagedRootChildDirectory(roots.current, directoryName);
      await quotaManager.bindResource(quotaReservationId, resourceRef, owner.ownerScope);
      resourceBound = true;
      const lease = await quotaManager.acquireLease(resourceRef, ttlMs, owner.ownerScope);
      pendingQuotaLeaseId = lease.leaseId;
      const record: AgentMediaArtifactRecord = {
        ...owner,
        artifactId,
        createdAt: now(),
        directoryPath,
        fileName: normalizedFileName,
        filePath: path.join(directoryPath, normalizedFileName),
        quotaLeaseId: lease.leaseId,
        quotaReservationId,
        resourceRef,
        sizeBytes: 0,
      };
      records.set(record.artifactId, record);
      return toArtifact(record);
    } catch (error) {
      if (resourceBound && pendingQuotaLeaseId && pendingResourceRef) {
        await quotaManager.releaseLease(
          pendingResourceRef,
          pendingQuotaLeaseId,
          owner.ownerScope,
        ).catch(() => false);
      }
      if (quotaReservationId) {
        await quotaManager.cancelReservation(quotaReservationId, owner.ownerScope).catch(() => undefined);
      }
      if (!resourceBound && pendingDirectoryCreated && pendingDirectoryPath && pendingDirectoryName) {
        const roots = await resolveManagedRoots().catch(() => null);
        if (roots) {
          await removeAgentManagedRootChild(roots.current, pendingDirectoryName)
            .catch(() => undefined);
        }
      }
      throw error;
    } finally {
      pendingCreateCount -= 1;
    }
  }

  async function finalize(artifactId: string): Promise<AgentMediaArtifact> {
    return withArtifactOperation(artifactId, async () => {
      const record = records.get(String(artifactId || '').trim());
      if (!record) throw new Error('Agent 媒体临时产物不存在或已经失效');
      const fileIdentity = await inspectArtifactFile(record);
      if (!fileIdentity || fileIdentity.sizeBytes <= 0) {
        await removeRecord(record);
        throw new Error('ffmpeg 未生成有效的音频文件');
      }
      if (fileIdentity.allocatedBytes > AGENT_MEDIA_MAX_ARTIFACT_BYTES) {
        await removeRecord(record);
        throw new Error('提取后的音频文件超过 2 GiB 上限');
      }
      const quotaManager = await resolveQuotaManager();
      try {
        await quotaManager.commit(
          record.quotaReservationId,
          record.resourceRef,
          fileIdentity.allocatedBytes,
          record.ownerScope,
        );
        if (record.quotaLeaseId) {
          const released = await quotaManager.releaseLease(
            record.resourceRef,
            record.quotaLeaseId,
            record.ownerScope,
          );
          if (!released) throw new Error('Agent 媒体临时产物已经进入清理流程');
          delete record.quotaLeaseId;
        }
        const quotaResource = quotaManager.getResource(record.resourceRef, record.ownerScope);
        if (
          records.get(record.artifactId) !== record
          || !quotaResource
          || quotaResource.state === 'deleting'
        ) {
          throw new Error('Agent 媒体临时产物已经进入清理流程');
        }
      } catch (error) {
        await removeRecord(record).catch(() => undefined);
        throw error;
      }
      record.createdAt = now();
      record.allocatedBytes = fileIdentity.allocatedBytes;
      record.fileIdentity = {
        ctimeNs: fileIdentity.ctimeNs,
        device: fileIdentity.device,
        inode: fileIdentity.inode,
      };
      record.sizeBytes = fileIdentity.sizeBytes;
      return toArtifact(record);
    });
  }

  async function release(
    artifactId: string,
    ownerInput?: AgentMediaArtifactOwner,
  ): Promise<boolean> {
    return withArtifactOperation(artifactId, async () => {
      const record = records.get(String(artifactId || '').trim());
      if (!record) return false;
      const owner = ownerInput ? normalizeOwner(ownerInput) : undefined;
      if (owner && !sameOwner(record, owner)) {
        throw new Error('当前窗口无权释放该 Agent 媒体临时产物');
      }
      await removeRecord(record);
      return true;
    });
  }

  function getOwned(
    artifactId: string,
    ownerInput: AgentMediaArtifactOwner,
  ): AgentMediaArtifact {
    const record = records.get(String(artifactId || '').trim());
    if (!record) throw new Error('Agent 媒体临时产物不存在或已经失效');
    const owner = normalizeOwner(ownerInput);
    if (!sameOwner(record, owner)) {
      throw new Error('当前窗口无权读取该 Agent 媒体临时产物');
    }
    const quotaResource = quotaManagerInstance?.getResource(record.resourceRef, record.ownerScope);
    if (!quotaResource || quotaResource.state === 'deleting') {
      records.delete(record.artifactId);
      throw new Error('Agent 媒体临时产物不存在或已经失效');
    }
    record.createdAt = now();
    if (quotaManagerInstance) {
      void quotaManagerInstance.touch(record.resourceRef, ttlMs, record.ownerScope)
        .catch(() => undefined);
    }
    return toArtifact(record);
  }

  async function withOwnedFile<T>(
    artifactId: string,
    ownerInput: AgentMediaArtifactOwner,
    consumer: (ownedFile: AgentMediaOwnedFile) => Promise<T>,
  ): Promise<T> {
    return withArtifactOperation(artifactId, async () => {
      const record = records.get(String(artifactId || '').trim());
      if (!record) throw new Error('Agent 媒体临时产物不存在或已经失效');
      const owner = normalizeOwner(ownerInput);
      if (!sameOwner(record, owner)) {
        throw new Error('当前窗口无权读取该 Agent 媒体临时产物');
      }
      if (!record.fileIdentity || record.allocatedBytes === undefined) {
        throw new Error('Agent 媒体临时产物不存在或已经失效');
      }

      const quotaManager = await resolveQuotaManager();
      const quotaResource = quotaManager.getResource(record.resourceRef, record.ownerScope);
      if (!quotaResource || quotaResource.state === 'deleting') {
        records.delete(record.artifactId);
        throw new Error('Agent 媒体临时产物不存在或已经失效');
      }

      let consumptionLeaseId: string | null = null;
      let opened: Awaited<ReturnType<typeof openArtifactFile>> = null;
      let completedSuccessfully = false;
      let invalidateRecord = false;
      let result!: T;
      let releaseLeaseError: Error | null = null;
      try {
        const lease = await quotaManager.acquireLease(
          record.resourceRef,
          ttlMs,
          record.ownerScope,
        );
        consumptionLeaseId = lease.leaseId;
        opened = await openArtifactFile(record);
        if (
          !opened
          || opened.identity.sizeBytes !== record.sizeBytes
          || opened.identity.allocatedBytes !== record.allocatedBytes
        ) {
          invalidateRecord = true;
          throw new Error('Agent 媒体临时产物不存在或已经失效');
        }
        const touched = await quotaManager.touch(record.resourceRef, ttlMs, record.ownerScope);
        if (!touched) {
          invalidateRecord = true;
          throw new Error('Agent 媒体临时产物不存在或已经失效');
        }
        record.createdAt = now();

        const verifyUnchanged = async () => {
          if (!opened) throw new Error('Agent 媒体临时产物不存在或已经失效');
          const finalIdentity = await verifyArtifactFileHandle(record, opened.fileHandle)
            .catch(() => null);
          if (
            !finalIdentity
            || finalIdentity.sizeBytes !== opened.identity.sizeBytes
            || finalIdentity.allocatedBytes !== opened.identity.allocatedBytes
            || finalIdentity.ctimeNs !== opened.identity.ctimeNs
            || finalIdentity.device !== opened.identity.device
            || finalIdentity.inode !== opened.identity.inode
          ) {
            invalidateRecord = true;
            throw new Error('Agent 媒体临时产物在读取期间发生变化');
          }
        };
        result = await consumer({
          artifact: toArtifact(record),
          fileHandle: opened.fileHandle,
          verifyUnchanged,
        });
        await verifyUnchanged();
        completedSuccessfully = true;
      } finally {
        await opened?.fileHandle.close().catch(() => undefined);
        let leaseReleased = true;
        if (consumptionLeaseId) {
          leaseReleased = await quotaManager.releaseLease(
            record.resourceRef,
            consumptionLeaseId,
            record.ownerScope,
          ).catch(() => false);
        }
        if (!leaseReleased) invalidateRecord = true;
        if (invalidateRecord) {
          await removeRecord(record).catch(() => undefined);
        }
        if (!leaseReleased && completedSuccessfully) {
          releaseLeaseError = new Error('Agent 媒体临时产物已经进入清理流程');
        }
      }
      if (releaseLeaseError) throw releaseLeaseError;
      return result;
    });
  }

  async function touchExecution(ownerInput: AgentMediaArtifactOwner): Promise<boolean> {
    const owner = normalizeOwner(ownerInput);
    const record = Array.from(records.values()).find(candidate => sameOwner(candidate, owner));
    if (!record) return false;
    const roots = await getVerifiedManagedRoots();
    await captureAgentManagedRootChildDirectory(
      roots.current,
      directoryNameForArtifact(record.artifactId),
    );
    const quotaManager = await resolveQuotaManager();
    const touched = await quotaManager.touch(record.resourceRef, ttlMs, record.ownerScope);
    if (!touched) {
      records.delete(record.artifactId);
      return false;
    }
    record.createdAt = now();
    return true;
  }

  async function releaseRun(runId: string): Promise<void> {
    await Promise.all(Array.from(records.values())
      .filter(record => record.runId === runId)
      .map(record => release(record.artifactId)));
  }

  async function releaseOwner(ownerWebContentsId: number): Promise<void> {
    await Promise.all(Array.from(records.values())
      .filter(record => record.ownerWebContentsId === ownerWebContentsId)
      .map(record => release(record.artifactId)));
  }

  return {
    create,
    finalize,
    getOwned,
    release,
    releaseOwner,
    releaseRun,
    sweepExpired,
    touchExecution,
    withOwnedFile,
  };
}

export const agentMediaArtifactStore = createAgentMediaArtifactStore({
  legacyRootPaths: [resolveTempImportStagingRoot(os.tmpdir())],
  resolveQuotaManager: async () => {
    return (await getAgentPersistenceRuntime()).shellStorage.quotaManager;
  },
  resolveRootPath: () => path.join(app.getPath('userData'), 'agent-media-artifacts'),
});
export type AgentMediaArtifactStore = ReturnType<typeof createAgentMediaArtifactStore>;

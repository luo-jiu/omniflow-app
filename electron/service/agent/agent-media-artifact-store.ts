import crypto from 'node:crypto';
import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

interface AgentMediaArtifactRecord extends AgentMediaArtifact, AgentMediaArtifactOwner {
  createdAt: number;
  quotaLeaseId?: string;
  quotaReservationId: string;
  resourceRef: string;
}

interface AgentMediaArtifactStoreOptions {
  createId?: () => string;
  maxActiveArtifacts?: number;
  now?: () => number;
  quotaManager?: AgentLocalStorageQuotaManager;
  resolveQuotaManager?: () => AgentLocalStorageQuotaManager | Promise<AgentLocalStorageQuotaManager>;
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

export function createAgentMediaArtifactStore(
  options: AgentMediaArtifactStoreOptions = {},
) {
  const createId = options.createId || crypto.randomUUID;
  const maxActiveArtifacts = Math.max(
    1,
    Math.min(Number(options.maxActiveArtifacts) || DEFAULT_MAX_ACTIVE_ARTIFACTS, 16),
  );
  const now = options.now || Date.now;
  const rootPath = path.resolve(
    options.rootPath || resolveTempImportStagingRoot(os.tmpdir()),
  );
  const ttlMs = Math.max(1_000, Number(options.ttlMs) || DEFAULT_ARTIFACT_TTL_MS);
  const records = new Map<string, AgentMediaArtifactRecord>();
  const fallbackQuotaManager = options.quotaManager || options.resolveQuotaManager
    ? null
    : createAgentLocalStorageQuotaManager({ now });
  let quotaManagerInstance: AgentLocalStorageQuotaManager | null = null;
  let quotaManagerPromise: Promise<AgentLocalStorageQuotaManager> | null = null;
  let pendingCreateCount = 0;

  function resourceRefForArtifact(artifactId: string): string {
    return `${AGENT_MEDIA_RESOURCE_REF_PREFIX}${normalizeArtifactId(artifactId)}`;
  }

  function artifactIdFromResourceRef(resourceRef: string): string {
    if (!resourceRef.startsWith(AGENT_MEDIA_RESOURCE_REF_PREFIX)) {
      throw new Error('Agent 媒体临时产物引用无效');
    }
    return normalizeArtifactId(resourceRef.slice(AGENT_MEDIA_RESOURCE_REF_PREFIX.length));
  }

  function directoryPathForArtifact(artifactId: string): string {
    const directoryPath = path.resolve(rootPath, `${AGENT_MEDIA_DIRECTORY_PREFIX}${normalizeArtifactId(artifactId)}`);
    if (path.dirname(directoryPath) !== rootPath) {
      throw new Error('Agent 媒体临时产物目录越界');
    }
    return directoryPath;
  }

  async function removePhysicalResource(resourceRef: string): Promise<void> {
    const artifactId = artifactIdFromResourceRef(resourceRef);
    await rm(directoryPathForArtifact(artifactId), { force: true, recursive: true });
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

  async function removeUnmanagedCrashResidue(
    quotaManager: AgentLocalStorageQuotaManager,
  ): Promise<void> {
    const cutoff = now() - ttlMs;

    await mkdir(rootPath, { recursive: true });
    const activeDirectories = new Set(Array.from(records.values()).map(record => record.directoryPath));
    const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter(entry => entry.name.startsWith(AGENT_MEDIA_DIRECTORY_PREFIX))
      .map(async (entry) => {
        const directoryPath = path.join(rootPath, entry.name);
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
        await rm(directoryPath, { force: true, recursive: true }).catch(() => undefined);
      }));
  }

  async function sweepExpired(): Promise<void> {
    const quotaManager = await resolveQuotaManager();
    await quotaManager.sweep('media-artifact-expired');
    await removeUnmanagedCrashResidue(quotaManager);
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
    let pendingResourceRef: string | null = null;
    let pendingDirectoryCreated = false;
    let resourceBound = false;
    try {
      const artifactId = normalizeArtifactId(createId());
      const resourceRef = resourceRefForArtifact(artifactId);
      const directoryPath = directoryPathForArtifact(artifactId);
      const normalizedFileName = normalizeStagedFileName(fileName, 'extracted-audio.m4a');
      pendingDirectoryPath = directoryPath;
      pendingResourceRef = resourceRef;
      quotaReservationId = await quotaManager.reserve(
        owner.ownerScope,
        AGENT_MEDIA_QUOTA_CATEGORY,
        owner.runId,
        AGENT_MEDIA_MAX_ARTIFACT_BYTES,
        ttlMs,
        AGENT_MEDIA_QUOTA_ADAPTER_ID,
      );
      await mkdir(rootPath, { recursive: true });
      await mkdir(directoryPath);
      pendingDirectoryCreated = true;
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
      if (!resourceBound && pendingDirectoryCreated && pendingDirectoryPath) {
        await rm(pendingDirectoryPath, { force: true, recursive: true }).catch(() => undefined);
      }
      throw error;
    } finally {
      pendingCreateCount -= 1;
    }
  }

  async function finalize(artifactId: string): Promise<AgentMediaArtifact> {
    const record = records.get(String(artifactId || '').trim());
    if (!record) throw new Error('Agent 媒体临时产物不存在或已经失效');
    const fileStat = await stat(record.filePath).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size <= 0) {
      await removeRecord(record);
      throw new Error('ffmpeg 未生成有效的音频文件');
    }
    if (fileStat.size > AGENT_MEDIA_MAX_ARTIFACT_BYTES) {
      await removeRecord(record);
      throw new Error('提取后的音频文件超过 2 GiB 上限');
    }
    const quotaManager = await resolveQuotaManager();
    try {
      await quotaManager.commit(
        record.quotaReservationId,
        record.resourceRef,
        fileStat.size,
        record.ownerScope,
      );
      if (record.quotaLeaseId) {
        await quotaManager.releaseLease(
          record.resourceRef,
          record.quotaLeaseId,
          record.ownerScope,
        );
        delete record.quotaLeaseId;
      }
    } catch (error) {
      await removeRecord(record).catch(() => undefined);
      throw error;
    }
    record.createdAt = now();
    record.sizeBytes = fileStat.size;
    return toArtifact(record);
  }

  async function release(
    artifactId: string,
    ownerInput?: AgentMediaArtifactOwner,
  ): Promise<boolean> {
    const record = records.get(String(artifactId || '').trim());
    if (!record) return false;
    const owner = ownerInput ? normalizeOwner(ownerInput) : undefined;
    if (owner && !sameOwner(record, owner)) {
      throw new Error('当前窗口无权释放该 Agent 媒体临时产物');
    }
    await removeRecord(record);
    return true;
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

  async function touchExecution(ownerInput: AgentMediaArtifactOwner): Promise<boolean> {
    const owner = normalizeOwner(ownerInput);
    const record = Array.from(records.values()).find(candidate => sameOwner(candidate, owner));
    if (!record) return false;
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
      .map(removeRecord));
  }

  async function releaseOwner(ownerWebContentsId: number): Promise<void> {
    await Promise.all(Array.from(records.values())
      .filter(record => record.ownerWebContentsId === ownerWebContentsId)
      .map(removeRecord));
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
  };
}

export const agentMediaArtifactStore = createAgentMediaArtifactStore({
  resolveQuotaManager: async () => {
    return (await getAgentPersistenceRuntime()).shellStorage.quotaManager;
  },
});
export type AgentMediaArtifactStore = ReturnType<typeof createAgentMediaArtifactStore>;

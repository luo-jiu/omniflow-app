import crypto from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeStagedFileName,
  resolveTempImportStagingRoot,
} from '../stagedFilePolicy';

export const AGENT_MEDIA_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_ARTIFACT_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_ACTIVE_ARTIFACTS = 4;
const AGENT_MEDIA_DIRECTORY_PREFIX = 'agent-media-';

export interface AgentMediaArtifactOwner {
  executionId: string;
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
}

interface AgentMediaArtifactStoreOptions {
  createId?: () => string;
  maxActiveArtifacts?: number;
  maxTotalArtifactBytes?: number;
  now?: () => number;
  rootPath?: string;
  ttlMs?: number;
}

function sameOwner(
  record: AgentMediaArtifactRecord,
  owner: AgentMediaArtifactOwner,
): boolean {
  return record.executionId === owner.executionId
    && record.ownerWebContentsId === owner.ownerWebContentsId
    && record.runId === owner.runId
    && record.sessionId === owner.sessionId;
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
  const maxTotalArtifactBytes = Math.max(
    AGENT_MEDIA_MAX_ARTIFACT_BYTES,
    Number(options.maxTotalArtifactBytes)
      || maxActiveArtifacts * AGENT_MEDIA_MAX_ARTIFACT_BYTES,
  );
  const rootPath = path.resolve(
    options.rootPath || resolveTempImportStagingRoot(os.tmpdir()),
  );
  const ttlMs = Math.max(1_000, Number(options.ttlMs) || DEFAULT_ARTIFACT_TTL_MS);
  const records = new Map<string, AgentMediaArtifactRecord>();
  let pendingCreateCount = 0;

  async function removeRecord(record: AgentMediaArtifactRecord): Promise<void> {
    records.delete(record.artifactId);
    await rm(record.directoryPath, { force: true, recursive: true }).catch(() => undefined);
  }

  async function sweepExpired(): Promise<void> {
    const cutoff = now() - ttlMs;
    await Promise.all(Array.from(records.values())
      .filter(record => record.sizeBytes > 0 && record.createdAt <= cutoff)
      .map(removeRecord));

    await mkdir(rootPath, { recursive: true });
    const activeDirectories = new Set(Array.from(records.values()).map(record => record.directoryPath));
    const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(AGENT_MEDIA_DIRECTORY_PREFIX))
      .map(async (entry) => {
        const directoryPath = path.join(rootPath, entry.name);
        if (activeDirectories.has(directoryPath)) return;
        const directoryStat = await stat(directoryPath).catch(() => null);
        if (directoryStat && directoryStat.mtimeMs > cutoff) return;
        await rm(directoryPath, { force: true, recursive: true }).catch(() => undefined);
      }));
  }

  async function measureCrashResidueBytes(): Promise<number> {
    await mkdir(rootPath, { recursive: true });
    const activeDirectories = new Set(Array.from(records.values()).map(record => record.directoryPath));
    const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
    const directoryBytes = await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(AGENT_MEDIA_DIRECTORY_PREFIX))
      .map(async (entry) => {
        const directoryPath = path.join(rootPath, entry.name);
        if (activeDirectories.has(directoryPath)) return 0;
        const files = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
        const sizes = await Promise.all(files
          .filter(file => file.isFile())
          .map(async file => (await stat(path.join(directoryPath, file.name)).catch(() => null))?.size || 0));
        return sizes.reduce((total, size) => total + size, 0);
      }));
    return directoryBytes.reduce((total, size) => total + size, 0);
  }

  async function create(
    fileName: string,
    owner: AgentMediaArtifactOwner,
  ): Promise<AgentMediaArtifact> {
    await sweepExpired();
    if (records.size + pendingCreateCount >= maxActiveArtifacts) {
      throw new Error(`Agent 媒体临时产物数量已达到上限：${maxActiveArtifacts}`);
    }
    pendingCreateCount += 1;
    try {
      const crashResidueBytes = await measureCrashResidueBytes();
      const reservedBytes = (
        records.size + pendingCreateCount
      ) * AGENT_MEDIA_MAX_ARTIFACT_BYTES;
      if (crashResidueBytes + reservedBytes > maxTotalArtifactBytes) {
        throw new Error('Agent 媒体临时产物总量已达到上限，请稍后重试');
      }
      await mkdir(rootPath, { recursive: true });
      const directoryPath = await mkdtemp(path.join(rootPath, AGENT_MEDIA_DIRECTORY_PREFIX));
      const normalizedFileName = normalizeStagedFileName(fileName, 'extracted-audio.m4a');
      const record: AgentMediaArtifactRecord = {
        ...owner,
        artifactId: createId(),
        createdAt: now(),
        directoryPath,
        fileName: normalizedFileName,
        filePath: path.join(directoryPath, normalizedFileName),
        sizeBytes: 0,
      };
      records.set(record.artifactId, record);
      return { ...record };
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
    record.createdAt = now();
    record.sizeBytes = fileStat.size;
    return { ...record };
  }

  async function release(
    artifactId: string,
    owner?: AgentMediaArtifactOwner,
  ): Promise<boolean> {
    const record = records.get(String(artifactId || '').trim());
    if (!record) return false;
    if (owner && !sameOwner(record, owner)) {
      throw new Error('当前窗口无权释放该 Agent 媒体临时产物');
    }
    await removeRecord(record);
    return true;
  }

  function getOwned(
    artifactId: string,
    owner: AgentMediaArtifactOwner,
  ): AgentMediaArtifact {
    const record = records.get(String(artifactId || '').trim());
    if (!record) throw new Error('Agent 媒体临时产物不存在或已经失效');
    if (!sameOwner(record, owner)) {
      throw new Error('当前窗口无权读取该 Agent 媒体临时产物');
    }
    record.createdAt = now();
    return { ...record };
  }

  function touchExecution(owner: AgentMediaArtifactOwner): boolean {
    const record = Array.from(records.values()).find(candidate => sameOwner(candidate, owner));
    if (!record) return false;
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

export const agentMediaArtifactStore = createAgentMediaArtifactStore();
export type AgentMediaArtifactStore = ReturnType<typeof createAgentMediaArtifactStore>;

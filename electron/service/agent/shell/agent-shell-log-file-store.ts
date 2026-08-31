import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

import {
  assertAgentManagedRoot,
  captureAgentManagedRootChildDirectory,
  establishAgentManagedRoot,
  removeAgentManagedRootChild,
  resolveAgentManagedRootChild,
  type AgentManagedRoot,
} from '../storage/agent-managed-root';
import type { AgentLocalStorageQuotaManager } from '../storage/agent-local-storage-quota-manager';

export const AGENT_SHELL_LOG_FILE_ADAPTER_ID = 'shell-log';
export const AGENT_SHELL_LOG_FILE_NAME = 'detailed.ndjson';
export const AGENT_SHELL_LOG_MAX_BYTES = 64 * 1024 * 1024;

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_READ_BYTES = 256 * 1024;
const LOG_DIRECTORY_PREFIX = 'agent-shell-log-';
const RESIDUE_ADMISSION_BLOCK_ID = 'shell-log-unmanaged-residue';
const MAX_ROOT_PATH_LENGTH = 4_096;
const MAX_RESOURCE_REF_LENGTH = 128;
const LOG_REF_PREFIX = 'log:v1:';
const LOG_REF_PATTERN = /^log:v1:[a-f0-9]{64}$/u;
const LOG_SUFFIX_PATTERN = /^[a-f0-9]{64}$/u;

type QuotaManager = Pick<
  AgentLocalStorageQuotaManager,
  | 'hasManagedResource'
  | 'ready'
  | 'registerAdapter'
  | 'setAdmissionBlock'
  | 'unregisterAdapter'
>;

export interface AgentShellLogFileStoreOptions {
  readonly adapterId?: string;
  readonly legacyRootPaths?: readonly string[];
  readonly maxFileBytes?: number;
  readonly maxReadBytes?: number;
  readonly now?: () => number;
  readonly quotaManager?: QuotaManager;
  readonly resolveRootPath?: () => string;
  readonly rootPath?: string;
  readonly ttlMs?: number;
}

export interface AgentShellLogFileAppendResult {
  readonly acceptedBytes: number;
  readonly droppedBytes: number;
  readonly sizeBytes: number;
}

export interface AgentShellLogFileReadRequest {
  readonly maxBytes?: number;
  readonly offset?: number;
}

export interface AgentShellLogFileReadResult {
  readonly data: Uint8Array;
  readonly eof: boolean;
  readonly nextOffset: number;
  readonly offset: number;
  readonly sizeBytes: number;
}

export interface AgentShellLogFileHandle {
  readonly append: (data: Uint8Array | string) => Promise<AgentShellLogFileAppendResult>;
  readonly getSize: () => Promise<number>;
  readonly logRef: string;
  readonly read: (request?: AgentShellLogFileReadRequest) => Promise<AgentShellLogFileReadResult>;
}

interface LogFileRecord {
  readonly logRef: string;
  readonly root: AgentManagedRoot;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function normalizeString(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\u0000')) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function normalizeLogRef(value: unknown): string {
  const logRef = normalizeString(value, 'Agent Shell logRef', MAX_RESOURCE_REF_LENGTH);
  if (!LOG_REF_PATTERN.test(logRef)) throw new Error('Agent Shell logRef 无效');
  return logRef;
}

function normalizePositiveLimit(value: number | undefined, fallback: number, label: string): number {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(`${label}无效`);
  return normalized;
}

function normalizeTtl(value: number | undefined): number {
  const ttlMs = normalizePositiveLimit(value, DEFAULT_TTL_MS, 'Agent Shell 日志 TTL');
  if (ttlMs > MAX_TTL_MS) throw new Error('Agent Shell 日志 TTL 无效');
  return ttlMs;
}

function normalizeOffset(value: number | undefined): number {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Agent Shell 日志读取偏移无效');
  return offset;
}

function toBuffer(data: Uint8Array | string): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (!(data instanceof Uint8Array)) throw new Error('Agent Shell 日志写入正文无效');
  return Buffer.from(data);
}

function sameFileIdentity(
  stat: Pick<BigIntStats, 'dev' | 'ino'>,
  identity: Pick<BigIntStats, 'dev' | 'ino'>,
): boolean {
  return stat.dev === identity.dev && stat.ino === identity.ino;
}

function createResourceDigest(logRef: string): string {
  return logRef.slice(LOG_REF_PREFIX.length);
}

function logRefFromDirectoryName(directoryName: string): string | null {
  if (!directoryName.startsWith(LOG_DIRECTORY_PREFIX)) return null;
  const suffix = directoryName.slice(LOG_DIRECTORY_PREFIX.length);
  if (!LOG_SUFFIX_PATTERN.test(suffix)) return null;
  return `${LOG_REF_PREFIX}${suffix}`;
}

export function createAgentShellLogFileStore(options: AgentShellLogFileStoreOptions) {
  const adapterId = normalizeString(
    options.adapterId || AGENT_SHELL_LOG_FILE_ADAPTER_ID,
    'Agent Shell 日志 adapter ID',
    128,
  );
  const maxFileBytes = normalizePositiveLimit(
    options.maxFileBytes,
    AGENT_SHELL_LOG_MAX_BYTES,
    'Agent Shell 日志文件上限',
  );
  const maxReadBytes = Math.min(
    maxFileBytes,
    normalizePositiveLimit(options.maxReadBytes, DEFAULT_READ_BYTES, 'Agent Shell 日志读取上限'),
  );
  const ttlMs = normalizeTtl(options.ttlMs);
  const now = options.now || Date.now;
  const quotaManager = options.quotaManager;
  let configuredRootPath = options.rootPath
    ? path.resolve(normalizeString(options.rootPath, 'Agent Shell 日志根目录', MAX_ROOT_PATH_LENGTH))
    : null;
  if (!configuredRootPath && !options.resolveRootPath) {
    throw new Error('Agent Shell 日志根目录缺失');
  }
  const legacyRootPaths = Array.from(new Set((options.legacyRootPaths || []).map(rootPath => (
    path.resolve(normalizeString(rootPath, 'Agent Shell 日志旧根目录', MAX_ROOT_PATH_LENGTH))
  ))));
  const records = new Map<string, LogFileRecord>();
  const operationTails = new Map<string, Promise<void>>();
  const publicOperations = new Set<Promise<unknown>>();
  const adapterOperations = new Set<Promise<unknown>>();
  let rootsPromise: Promise<{ current: AgentManagedRoot; legacy: readonly AgentManagedRoot[] }> | null = null;
  let adapterRegistered = false;
  let adapterAdmissionOpen = true;
  let closing = false;
  let disposePromise: Promise<void> | null = null;

  function getConfiguredRootPath(): string {
    if (!configuredRootPath) {
      const resolved = String(options.resolveRootPath?.() || '').trim();
      if (!resolved) throw new Error('Agent Shell 日志根目录无效');
      configuredRootPath = path.resolve(resolved);
    }
    return configuredRootPath;
  }

  async function resolveManagedRoots(): Promise<{
    readonly current: AgentManagedRoot;
    readonly legacy: readonly AgentManagedRoot[];
  }> {
    if (!rootsPromise) {
      rootsPromise = (async () => {
        const current = await establishAgentManagedRoot({
          createIfMissing: true,
          label: 'Agent Shell 日志根目录',
          rootPath: getConfiguredRootPath(),
        });
        if (!current) throw new Error('Agent Shell 日志根目录不存在');
        const legacy = (await Promise.all(legacyRootPaths
          .filter(rootPath => rootPath !== current.configuredPath)
          .map(async rootPath => {
            try {
              return await establishAgentManagedRoot({
                createIfMissing: false,
                label: 'Agent Shell 日志旧根目录',
                rootPath,
              });
            } catch {
              return null;
            }
          }))).filter((root): root is AgentManagedRoot => Boolean(root));
        return Object.freeze({ current, legacy: Object.freeze(legacy) });
      })().catch(error => {
        rootsPromise = null;
        throw error;
      });
    }
    return rootsPromise;
  }

  async function getVerifiedManagedRoots(): Promise<{
    readonly current: AgentManagedRoot;
    readonly legacy: readonly AgentManagedRoot[];
  }> {
    const roots = await resolveManagedRoots();
    await assertAgentManagedRoot(roots.current);
    for (const root of roots.legacy) await assertAgentManagedRoot(root);
    return roots;
  }

  function directoryNameForLogRef(logRefInput: string): string {
    return `${LOG_DIRECTORY_PREFIX}${createResourceDigest(normalizeLogRef(logRefInput))}`;
  }

  function filePathForDirectory(directoryPath: string): string {
    return path.join(directoryPath, AGENT_SHELL_LOG_FILE_NAME);
  }

  async function captureLogDirectory(logRef: string, root: AgentManagedRoot): Promise<{
    readonly directoryPath: string;
  }> {
    const directoryName = directoryNameForLogRef(logRef);
    const directoryPath = resolveAgentManagedRootChild(root, directoryName);
    const identity = await captureAgentManagedRootChildDirectory(root, directoryName);
    if (identity.canonicalPath !== directoryPath) throw new Error('Agent Shell 日志目录身份已变化');
    return { directoryPath: identity.canonicalPath };
  }

  async function openVerifiedFile(
    record: LogFileRecord,
    flags: number,
  ): Promise<{ fileHandle: FileHandle; identity: Pick<BigIntStats, 'dev' | 'ino'>; sizeBytes: number } | null> {
    await getVerifiedManagedRoots();
    const directory = await captureLogDirectory(record.logRef, record.root);
    const filePath = filePathForDirectory(directory.directoryPath);
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const fileHandle = await open(filePath, flags | noFollow, 0o600).catch(error => {
      if (isMissingFileError(error) && (flags & constants.O_CREAT) === 0) return null;
      throw error;
    });
    if (!fileHandle) return null;
    const pathStat = await lstat(filePath, { bigint: true }).catch(() => null);
    const handleStat = await fileHandle.stat({ bigint: true }).catch(() => null);
    const canonicalFilePath = await realpath(filePath).catch(() => null);
    const expectedFilePath = path.join(directory.directoryPath, AGENT_SHELL_LOG_FILE_NAME);
    if (
      !pathStat
      || !handleStat
      || !pathStat.isFile()
      || pathStat.isSymbolicLink()
      || !handleStat.isFile()
      || canonicalFilePath !== expectedFilePath
      || !sameFileIdentity(pathStat, handleStat)
      || !Number.isSafeInteger(Number(handleStat.size))
      || Number(handleStat.size) < 0
    ) {
      await fileHandle.close().catch(() => undefined);
      throw new Error('Agent Shell 日志文件身份无效');
    }
    return {
      fileHandle,
      identity: { dev: handleStat.dev, ino: handleStat.ino },
      sizeBytes: Number(handleStat.size),
    };
  }

  async function withResourceOperation<T>(logRef: string, operation: () => Promise<T>): Promise<T> {
    const previous = operationTails.get(logRef) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    operationTails.set(logRef, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (operationTails.get(logRef) === tail) operationTails.delete(logRef);
    }
  }

  function trackOperation<T>(set: Set<Promise<unknown>>, operation: Promise<T>): Promise<T> {
    set.add(operation);
    void operation.then(() => set.delete(operation), () => set.delete(operation));
    return operation;
  }

  async function waitForOperations(set: Set<Promise<unknown>>): Promise<void> {
    while (set.size > 0) await Promise.allSettled(Array.from(set));
  }

  function requireRecord(logRefInput: string): LogFileRecord {
    const logRef = normalizeLogRef(logRefInput);
    const record = records.get(logRef);
    if (!record) throw new Error('Agent Shell 日志物理资源不存在或已经清理');
    return record;
  }

  function admitPublic<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new Error('Agent Shell 日志文件 Store 正在关闭'));
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    return trackOperation(publicOperations, promise);
  }

  async function removePhysicalResource(resourceRefInput: string): Promise<void> {
    const logRef = normalizeLogRef(resourceRefInput);
    await withResourceOperation(logRef, async () => {
      const roots = await getVerifiedManagedRoots();
      const directoryName = directoryNameForLogRef(logRef);
      await removeAgentManagedRootChild(roots.current, directoryName);
      await Promise.all(roots.legacy.map(root => removeAgentManagedRootChild(root, directoryName)));
      records.delete(logRef);
    });
  }

  async function removeUnmanagedResidue(): Promise<number> {
    if (!quotaManager) return 0;
    const cutoff = now() - ttlMs;
    const roots = await getVerifiedManagedRoots();
    let removed = 0;
    for (const root of [roots.current, ...roots.legacy]) {
      const entries = await readdir(root.canonicalPath, { withFileTypes: true });
      for (const entry of entries) {
        const logRef = logRefFromDirectoryName(entry.name);
        if (!logRef || records.has(logRef)) continue;
        if (await quotaManager.hasManagedResource(adapterId, logRef)) continue;
        const directoryPath = resolveAgentManagedRootChild(root, entry.name);
        const directoryStat = await lstat(directoryPath).catch(() => null);
        if (!directoryStat || directoryStat.mtimeMs > cutoff) continue;
        await removeAgentManagedRootChild(root, entry.name);
        removed += 1;
      }
    }
    return removed;
  }

  async function initialize(): Promise<void> {
    await getVerifiedManagedRoots();
    if (!quotaManager) return;
    await quotaManager.ready;
    quotaManager.registerAdapter(adapterId, { remove: removePhysicalResource });
    adapterRegistered = true;
    let blocked = false;
    try {
      await quotaManager.setAdmissionBlock(RESIDUE_ADMISSION_BLOCK_ID, true);
      blocked = true;
      await removeUnmanagedResidue();
    } catch (error) {
      if (blocked) await quotaManager.setAdmissionBlock(RESIDUE_ADMISSION_BLOCK_ID, false).catch(() => undefined);
      if (adapterRegistered) {
        quotaManager.unregisterAdapter(adapterId);
        adapterRegistered = false;
      }
      throw error;
    }
    if (blocked) {
      try {
        await quotaManager.setAdmissionBlock(RESIDUE_ADMISSION_BLOCK_ID, false);
      } catch (error) {
        if (adapterRegistered) {
          quotaManager.unregisterAdapter(adapterId);
          adapterRegistered = false;
        }
        throw error;
      }
    }
  }

  const ready = initialize();

  async function create(logRefInput: string): Promise<AgentShellLogFileHandle> {
    const logRef = normalizeLogRef(logRefInput);
    return admitPublic(async () => {
      await ready;
      return withResourceOperation(logRef, async () => {
        if (records.has(logRef)) throw new Error('Agent Shell 日志物理资源已经打开');
        const roots = await getVerifiedManagedRoots();
        const directoryName = directoryNameForLogRef(logRef);
        const directoryPath = resolveAgentManagedRootChild(roots.current, directoryName);
        try {
          await mkdir(directoryPath);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
            throw new Error('Agent Shell 日志物理资源已经存在');
          }
          throw error;
        }
        try {
          await captureLogDirectory(logRef, roots.current);
          const record = { logRef, root: roots.current };
          records.set(logRef, record);
          return createHandle(record);
        } catch (error) {
          await removeAgentManagedRootChild(roots.current, directoryName).catch(() => undefined);
          throw error;
        }
      });
    });
  }

  async function openExisting(logRefInput: string): Promise<AgentShellLogFileHandle> {
    const logRef = normalizeLogRef(logRefInput);
    return admitPublic(async () => {
      await ready;
      return withResourceOperation(logRef, async () => {
        const existing = records.get(logRef);
        if (existing) return createHandle(existing);
        const roots = await getVerifiedManagedRoots();
        let selectedRoot: AgentManagedRoot | null = null;
        for (const root of [roots.current, ...roots.legacy]) {
          try {
            await captureLogDirectory(logRef, root);
            selectedRoot = root;
            break;
          } catch (error) {
            if (!isMissingFileError(error)) throw error;
          }
        }
        if (!selectedRoot) throw new Error('Agent Shell 日志物理资源不存在或已经清理');
        const record = { logRef, root: selectedRoot };
        records.set(logRef, record);
        return createHandle(record);
      });
    });
  }

  function createHandle(record: LogFileRecord): AgentShellLogFileHandle {
    return Object.freeze({
      append: (data: Uint8Array | string) => admitPublic(async () => {
        await ready;
        return withResourceOperation(record.logRef, async () => {
          requireRecord(record.logRef);
          const input = toBuffer(data);
          if (input.length === 0) {
            const current = await getSize(record);
            return Object.freeze({ acceptedBytes: 0, droppedBytes: 0, sizeBytes: current });
          }
          const opened = await openVerifiedFile(record, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
          if (!opened) throw new Error('Agent Shell 日志文件打开失败');
          try {
            if (opened.sizeBytes > maxFileBytes) throw new Error('Agent Shell 日志文件超过上限');
            const writableBytes = Math.min(input.length, maxFileBytes - opened.sizeBytes);
            let written = 0;
            while (written < writableBytes) {
              const result = await opened.fileHandle.write(input, written, writableBytes - written, null);
              if (!result.bytesWritten) throw new Error('Agent Shell 日志文件写入失败');
              written += result.bytesWritten;
            }
            const finalStat = await opened.fileHandle.stat({ bigint: true });
            if (
              !finalStat.isFile()
              || !sameFileIdentity(finalStat, opened.identity)
              || Number(finalStat.size) !== opened.sizeBytes + written
            ) {
              throw new Error('Agent Shell 日志文件身份已变化');
            }
            const sizeBytes = Number(finalStat.size);
            if (!Number.isSafeInteger(sizeBytes) || sizeBytes > maxFileBytes) {
              throw new Error('Agent Shell 日志文件超过上限');
            }
            return Object.freeze({
              acceptedBytes: written,
              droppedBytes: input.length - written,
              sizeBytes,
            });
          } finally {
            await opened.fileHandle.close().catch(() => undefined);
          }
        });
      }),
      getSize: () => admitPublic(async () => {
        await ready;
        return withResourceOperation(record.logRef, () => getSize(record));
      }),
      logRef: record.logRef,
      read: (request: AgentShellLogFileReadRequest = {}) => admitPublic(async () => {
        await ready;
        return withResourceOperation(record.logRef, async () => {
          requireRecord(record.logRef);
          const offset = normalizeOffset(request.offset);
          const requestedBytes = normalizePositiveLimit(
            request.maxBytes,
            maxReadBytes,
            'Agent Shell 日志读取上限',
          );
          const maxBytes = Math.min(requestedBytes, maxReadBytes);
          const opened = await openVerifiedFile(record, constants.O_RDONLY);
          if (!opened) {
            return Object.freeze({
              data: new Uint8Array(),
              eof: true,
              nextOffset: 0,
              offset,
              sizeBytes: 0,
            });
          }
          try {
            const boundedOffset = Math.min(offset, opened.sizeBytes);
            const readableBytes = Math.min(maxBytes, opened.sizeBytes - boundedOffset);
            const output = Buffer.allocUnsafe(readableBytes);
            let read = 0;
            while (read < readableBytes) {
              const result = await opened.fileHandle.read(
                output,
                read,
                readableBytes - read,
                boundedOffset + read,
              );
              if (!result.bytesRead) break;
              read += result.bytesRead;
            }
            const finalStat = await opened.fileHandle.stat({ bigint: true });
            if (
              !finalStat.isFile()
              || !sameFileIdentity(finalStat, opened.identity)
              || Number(finalStat.size) !== opened.sizeBytes
            ) {
              throw new Error('Agent Shell 日志文件身份已变化');
            }
            const dataResult = new Uint8Array(output.subarray(0, read));
            const nextOffset = boundedOffset + read;
            return Object.freeze({
              data: dataResult,
              eof: nextOffset >= opened.sizeBytes,
              nextOffset,
              offset,
              sizeBytes: opened.sizeBytes,
            });
          } finally {
            await opened.fileHandle.close().catch(() => undefined);
          }
        });
      }),
    });
  }

  async function getSize(record: LogFileRecord): Promise<number> {
    const opened = await openVerifiedFile(record, constants.O_RDONLY);
    if (!opened) return 0;
    await opened.fileHandle.close().catch(() => undefined);
    return opened.sizeBytes;
  }

  async function remove(resourceRef: string): Promise<void> {
    if (!adapterAdmissionOpen) return Promise.reject(new Error('Agent Shell 日志 adapter 正在关闭'));
    const operation = removePhysicalResource(resourceRef);
    return trackOperation(adapterOperations, operation);
  }

  async function sweep(): Promise<number> {
    return admitPublic(async () => {
      await ready;
      return removeUnmanagedResidue();
    });
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    closing = true;
    disposePromise = (async () => {
      await ready.catch(() => undefined);
      await waitForOperations(publicOperations);
      adapterAdmissionOpen = false;
      await waitForOperations(adapterOperations);
      if (quotaManager && adapterRegistered) {
        quotaManager.unregisterAdapter(adapterId);
        adapterRegistered = false;
      }
    })();
    return disposePromise;
  }

  return Object.freeze({
    create,
    dispose,
    open: openExisting,
    ready,
    remove,
    sweep,
  });
}

export type AgentShellLogFileStore = ReturnType<typeof createAgentShellLogFileStore>;

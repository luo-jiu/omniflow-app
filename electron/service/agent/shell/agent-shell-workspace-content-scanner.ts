import crypto from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { normalizeAgentShellLogicalPath } from '../../../../src/shared/agent/shell/agent-shell.types';
import type { AgentManagedDirectoryIdentity } from '../storage/agent-managed-root';

export const AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION =
  'workspace-content-scanner-v3';
export const AGENT_SHELL_WORKSPACE_CONTENT_SCAN_TIMEOUT_MS = 25_000;
// xattrs, resource forks, ACLs and platform file flags need a native handle-based adapter
// before this identity can authorize reusable Shell rules.
export const AGENT_SHELL_WORKSPACE_PERSISTENT_RULE_IDENTITY_READY = false as const;

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface AgentShellWorkspaceContentEntry {
  allocatedBytes: number;
  changeTimeNs: string;
  contentHash?: string;
  kind: 'directory' | 'file';
  logicalPath: string;
  mode: number;
  sizeBytes: number;
}

export interface AgentShellWorkspaceContentSnapshot {
  entries: readonly AgentShellWorkspaceContentEntry[];
  entryCount: number;
  identity: string;
  provenance: readonly string[];
  rootAllocatedBytes: number;
  rootChangeTimeNs: string;
  rootMode: number;
  scannerRevision: typeof AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION;
  totalBytes: number;
}

export interface AgentShellWorkspaceContentScanOptions {
  expectedRootIdentity?: AgentManagedDirectoryIdentity;
  logicalRoots: readonly string[];
  maxDepth?: number;
  maxDurationMs?: number;
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  provenance: readonly string[];
  rootPath: string;
  signal?: AbortSignal;
}

interface StatFingerprint {
  blocks: bigint;
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
}

interface ObservedPath {
  absolutePath: string;
  canonicalPath: string;
  childNames?: readonly string[];
  fingerprint: StatFingerprint;
  kind: AgentShellWorkspaceContentEntry['kind'];
  logicalPath: string;
}

class AgentShellWorkspaceContentScanError extends Error {
  constructor(message: string) {
    super(`Agent workspace 内容扫描${message}`);
    this.name = 'AgentShellWorkspaceContentScanError';
  }
}

function scanError(message: string): never {
  throw new AgentShellWorkspaceContentScanError(message);
}

function abortError(): Error {
  const error = new Error('Agent workspace 内容扫描已取消');
  error.name = 'AbortError';
  return error;
}

function positiveLimit(value: unknown, fallback: number, label: string): number {
  const normalized = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sortedNames(names: readonly string[]): string[] {
  return [...names].sort(compareUtf8);
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fingerprint(stat: BigIntStats): StatFingerprint {
  return {
    blocks: stat.blocks,
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    mtimeNs: stat.mtimeNs,
    nlink: stat.nlink,
    size: stat.size,
  };
}

function sameFingerprint(left: StatFingerprint, right: StatFingerprint): boolean {
  return left.blocks === right.blocks
    && left.ctimeNs === right.ctimeNs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.nlink === right.nlink
    && left.size === right.size;
}

function publicMode(stat: BigIntStats): number {
  return Number(stat.mode & 0o7777n);
}

function publicChangeTimeNs(stat: BigIntStats): string {
  return stat.ctimeNs.toString(10);
}

function publicAllocatedBytes(stat: BigIntStats): number {
  const bytes = stat.blocks * 512n;
  if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    scanError('文件分配大小无效');
  }
  return Number(bytes);
}

function isInsideRoot(canonicalRoot: string, candidate: string): boolean {
  const relative = path.relative(canonicalRoot, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertExpectedRootIdentity(
  stat: BigIntStats,
  canonicalPath: string,
  expected: AgentManagedDirectoryIdentity | undefined,
): void {
  if (!expected) return;
  if (
    canonicalPath !== expected.canonicalPath
    || stat.dev !== expected.device
    || stat.ino !== expected.inode
  ) {
    scanError('根目录身份已变化');
  }
}

function assertLogicalRoots(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 16) {
    throw new Error('Agent workspace 逻辑根无效');
  }
  const roots = input.map((value) => {
    const root = normalizeAgentShellLogicalPath(value);
    if (root.includes('/')) throw new Error('Agent workspace 逻辑根无效');
    return root;
  });
  if (new Set(roots).size !== roots.length) throw new Error('Agent workspace 逻辑根重复');
  return Object.freeze(sortedNames(roots));
}

function assertNoCaseCollision(names: readonly string[]): void {
  if (process.platform !== 'win32') return;
  const folded = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (folded.has(key)) scanError('发现 Windows 大小写冲突');
    folded.add(key);
  }
}

function normalizeProvenance(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length > 256) {
    throw new Error('Agent workspace provenance 无效');
  }
  const values = input.map((value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > 512 || normalized.includes('\0')) {
      throw new Error('Agent workspace provenance 无效');
    }
    return normalized;
  });
  return Object.freeze(sortedNames(Array.from(new Set(values))));
}

async function safeLstat(absolutePath: string): Promise<BigIntStats> {
  try {
    return await lstat(absolutePath, { bigint: true });
  } catch {
    scanError('无法读取文件状态');
  }
}

async function safeRealpath(absolutePath: string): Promise<string> {
  try {
    return await realpath(absolutePath);
  } catch {
    scanError('无法确认真实路径');
  }
}

function decodeDirectoryEntryName(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length === 0) scanError('文件名编码无效');
  const decoded = value.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(value)) scanError('文件名不是规范 UTF-8');
  return decoded;
}

async function safeReadDirectory(input: {
  absolutePath: string;
  checkBudget: () => void;
  maxNames: number;
  overflowMessage: string;
}): Promise<string[]> {
  let directory: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    directory = await opendir(input.absolutePath, {
      bufferSize: 32,
      // Node supports Buffer names here although the current @types/node declaration is narrower.
      encoding: 'buffer' as BufferEncoding,
    });
    const names: string[] = [];
    const uniqueNames = new Set<string>();
    input.checkBudget();
    let entry = await directory.read();
    while (entry) {
      if (names.length >= input.maxNames) scanError(input.overflowMessage);
      const name = decodeDirectoryEntryName(entry.name as unknown);
      if (uniqueNames.has(name)) scanError('文件名解码冲突');
      uniqueNames.add(name);
      names.push(name);
      input.checkBudget();
      entry = await directory.read();
    }
    names.sort(compareUtf8);
    assertNoCaseCollision(names);
    return names;
  } catch (error) {
    if (
      error instanceof AgentShellWorkspaceContentScanError
      || (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    throw new AgentShellWorkspaceContentScanError('无法枚举目录');
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

async function safeOpenFile(absolutePath: string): Promise<FileHandle> {
  const noFollow = process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number'
    ? 0
    : constants.O_NOFOLLOW;
  const nonBlocking = process.platform === 'win32' || typeof constants.O_NONBLOCK !== 'number'
    ? 0
    : constants.O_NONBLOCK;
  try {
    return await open(absolutePath, constants.O_RDONLY | noFollow | nonBlocking);
  } catch {
    scanError('无法安全打开文件');
  }
}

function assertRegularFile(stat: BigIntStats): void {
  if (stat.isSymbolicLink()) scanError('不允许符号链接或 junction');
  if (!stat.isFile()) scanError('不允许特殊文件');
  if (stat.nlink !== 1n) scanError('不允许硬链接');
}

function assertDirectory(stat: BigIntStats): void {
  if (stat.isSymbolicLink()) scanError('不允许符号链接或 junction');
  if (!stat.isDirectory()) scanError('目录结构无效');
}

async function hashOpenFile(input: {
  buffer: Buffer;
  checkBudget: () => void;
  expected: StatFingerprint;
  handle: FileHandle;
  maxFileBytes: number;
}): Promise<{ bytesRead: number; contentHash: string; finalFingerprint: StatFingerprint }> {
  const digest = crypto.createHash('sha256');
  let total = 0;
  let reachedEnd = false;
  while (!reachedEnd) {
    input.checkBudget();
    const result = await input.handle.read(input.buffer, 0, input.buffer.byteLength, null);
    if (result.bytesRead === 0) {
      reachedEnd = true;
      continue;
    }
    total += result.bytesRead;
    if (total > input.maxFileBytes) scanError('单文件大小超限');
    digest.update(input.buffer.subarray(0, result.bytesRead));
  }
  const finalStat = await input.handle.stat({ bigint: true });
  assertRegularFile(finalStat);
  const finalFingerprint = fingerprint(finalStat);
  if (!sameFingerprint(input.expected, finalFingerprint) || BigInt(total) !== finalStat.size) {
    scanError('期间文件发生变化');
  }
  return {
    bytesRead: total,
    contentHash: `sha256:${digest.digest('hex')}`,
    finalFingerprint,
  };
}

export async function scanAgentShellWorkspaceContent(
  options: AgentShellWorkspaceContentScanOptions,
): Promise<AgentShellWorkspaceContentSnapshot> {
  if (process.platform === 'win32') {
    scanError('Windows 平台尚未通过完整内容身份校验');
  }
  const maxDepth = positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH, 'Agent workspace 扫描深度');
  const maxDurationMs = positiveLimit(
    options.maxDurationMs,
    AGENT_SHELL_WORKSPACE_CONTENT_SCAN_TIMEOUT_MS,
    'Agent workspace 扫描超时',
  );
  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES, 'Agent workspace 扫描条目');
  const maxFileBytes = positiveLimit(
    options.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    'Agent workspace 单文件上限',
  );
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    'Agent workspace 总大小上限',
  );
  const logicalRoots = assertLogicalRoots(options.logicalRoots);
  const provenance = normalizeProvenance(options.provenance);
  const rawRootPath = String(options.rootPath ?? '').trim();
  if (!rawRootPath || rawRootPath.includes('\0')) {
    throw new Error('Agent workspace 扫描根目录无效');
  }
  const rootPath = path.resolve(rawRootPath);
  const deadline = performance.now() + maxDurationMs;
  const entries: AgentShellWorkspaceContentEntry[] = [];
  const observed: ObservedPath[] = [];
  const readBuffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  const seenLogicalPaths = new Set<string>();
  let canonicalRoot = '';
  let discoveredEntries = logicalRoots.length;
  let totalBytes = 0;

  function checkBudget(): void {
    if (options.signal?.aborted) throw abortError();
    if (performance.now() > deadline) scanError('超时');
  }

  function addEntry(entry: AgentShellWorkspaceContentEntry): void {
    if (entries.length >= maxEntries) scanError('条目过多');
    if (seenLogicalPaths.has(entry.logicalPath)) scanError('逻辑路径重复');
    seenLogicalPaths.add(entry.logicalPath);
    entries.push(Object.freeze({ ...entry }));
  }

  function accountBytes(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxTotalBytes - totalBytes) {
      scanError('总大小超限');
    }
    totalBytes += bytes;
  }

  async function visit(absolutePath: string, logicalPath: string): Promise<void> {
    checkBudget();
    const depth = logicalPath.split('/').length;
    if (depth > maxDepth) scanError('目录深度超限');
    const normalizedLogicalPath = normalizeAgentShellLogicalPath(logicalPath);
    if (normalizedLogicalPath !== logicalPath) scanError('逻辑路径不规范');
    const initialStat = await safeLstat(absolutePath);
    if (initialStat.isSymbolicLink()) scanError('不允许符号链接或 junction');
    const canonicalPath = await safeRealpath(absolutePath);
    if (!isInsideRoot(canonicalRoot, canonicalPath)) scanError('真实路径逃逸');

    if (initialStat.isDirectory()) {
      assertDirectory(initialStat);
      const allocatedBytes = publicAllocatedBytes(initialStat);
      accountBytes(allocatedBytes);
      addEntry({
        allocatedBytes,
        changeTimeNs: publicChangeTimeNs(initialStat),
        kind: 'directory',
        logicalPath,
        mode: publicMode(initialStat),
        sizeBytes: 0,
      });
      const childNames = await safeReadDirectory({
        absolutePath,
        checkBudget,
        maxNames: maxEntries - discoveredEntries,
        overflowMessage: '条目过多',
      });
      discoveredEntries += childNames.length;
      observed.push({
        absolutePath,
        canonicalPath,
        childNames: Object.freeze([...childNames]),
        fingerprint: fingerprint(initialStat),
        kind: 'directory',
        logicalPath,
      });
      for (const name of childNames) {
        await visit(path.join(absolutePath, name), `${logicalPath}/${name}`);
      }
      return;
    }

    assertRegularFile(initialStat);
    if (initialStat.size > BigInt(maxFileBytes)) scanError('单文件大小超限');
    const anticipatedAccountedBytes = Math.max(
      Number(initialStat.size),
      publicAllocatedBytes(initialStat),
    );
    if (anticipatedAccountedBytes > maxTotalBytes - totalBytes) scanError('总大小超限');
    const handle = await safeOpenFile(absolutePath);
    let contentHash: string;
    let bytesRead: number;
    let handleFingerprint: StatFingerprint;
    try {
      const handleStat = await handle.stat({ bigint: true });
      assertRegularFile(handleStat);
      const initialFingerprint = fingerprint(initialStat);
      const openedFingerprint = fingerprint(handleStat);
      if (!sameFingerprint(initialFingerprint, openedFingerprint)) {
        scanError('打开前文件发生变化');
      }
      const hashed = await hashOpenFile({
        buffer: readBuffer,
        checkBudget,
        expected: openedFingerprint,
        handle,
        maxFileBytes,
      });
      ({ bytesRead, contentHash, finalFingerprint: handleFingerprint } = hashed);
    } finally {
      await handle.close().catch(() => undefined);
    }
    const finalPathStat = await safeLstat(absolutePath);
    assertRegularFile(finalPathStat);
    const finalPathFingerprint = fingerprint(finalPathStat);
    if (!sameFingerprint(handleFingerprint!, finalPathFingerprint)) {
      scanError('读取后文件发生变化');
    }
    const finalCanonicalPath = await safeRealpath(absolutePath);
    if (finalCanonicalPath !== canonicalPath || !isInsideRoot(canonicalRoot, finalCanonicalPath)) {
      scanError('读取后真实路径发生变化');
    }
    const allocatedBytes = publicAllocatedBytes(finalPathStat);
    accountBytes(Math.max(bytesRead!, allocatedBytes));
    addEntry({
      allocatedBytes,
      changeTimeNs: publicChangeTimeNs(finalPathStat),
      contentHash: contentHash!,
      kind: 'file',
      logicalPath,
      mode: publicMode(finalPathStat),
      sizeBytes: bytesRead!,
    });
    observed.push({
      absolutePath,
      canonicalPath: finalCanonicalPath,
      fingerprint: finalPathFingerprint,
      kind: 'file',
      logicalPath,
    });
  }

  try {
    checkBudget();
    const rootStat = await safeLstat(rootPath);
    assertDirectory(rootStat);
    canonicalRoot = await safeRealpath(rootPath);
    assertExpectedRootIdentity(rootStat, canonicalRoot, options.expectedRootIdentity);
    const rootNames = await safeReadDirectory({
      absolutePath: rootPath,
      checkBudget,
      maxNames: logicalRoots.length,
      overflowMessage: '逻辑根集合不匹配',
    });
    if (!sameNames(rootNames, logicalRoots)) scanError('逻辑根集合不匹配');
    const rootFingerprint = fingerprint(rootStat);
    const rootAllocatedBytes = publicAllocatedBytes(rootStat);
    const rootChangeTimeNs = publicChangeTimeNs(rootStat);
    const rootMode = publicMode(rootStat);
    accountBytes(rootAllocatedBytes);

    for (const logicalRoot of logicalRoots) {
      await visit(path.join(rootPath, logicalRoot), logicalRoot);
    }

    checkBudget();
    const finalRootStat = await safeLstat(rootPath);
    assertDirectory(finalRootStat);
    const finalCanonicalRoot = await safeRealpath(rootPath);
    assertExpectedRootIdentity(finalRootStat, finalCanonicalRoot, options.expectedRootIdentity);
    const finalRootNames = await safeReadDirectory({
      absolutePath: rootPath,
      checkBudget,
      maxNames: rootNames.length,
      overflowMessage: '期间根目录发生变化',
    });
    if (
      finalCanonicalRoot !== canonicalRoot
      || !sameFingerprint(rootFingerprint, fingerprint(finalRootStat))
      || !sameNames(rootNames, finalRootNames)
    ) {
      scanError('期间根目录发生变化');
    }

    for (const item of observed) {
      checkBudget();
      const currentStat = await safeLstat(item.absolutePath);
      if (item.kind === 'file') assertRegularFile(currentStat);
      else assertDirectory(currentStat);
      const currentCanonicalPath = await safeRealpath(item.absolutePath);
      if (
        currentCanonicalPath !== item.canonicalPath
        || !isInsideRoot(canonicalRoot, currentCanonicalPath)
        || !sameFingerprint(item.fingerprint, fingerprint(currentStat))
      ) {
        scanError('期间内容发生变化');
      }
      if (item.childNames) {
        const currentChildNames = await safeReadDirectory({
          absolutePath: item.absolutePath,
          checkBudget,
          maxNames: item.childNames.length,
          overflowMessage: '期间目录发生变化',
        });
        if (!sameNames(item.childNames, currentChildNames)) scanError('期间目录发生变化');
      }
    }

    const sortedEntries = Object.freeze([...entries].sort((left, right) => (
      compareUtf8(left.logicalPath, right.logicalPath)
    )));
    const identity = `v3:${crypto.createHash('sha256').update(JSON.stringify({
      domain: 'omniflow.agent.shell.workspace-content',
      entries: sortedEntries,
      logicalRoots,
      provenance,
      rootAllocatedBytes,
      rootChangeTimeNs,
      rootMode,
      scannerRevision: AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION,
      version: 3,
    })).digest('hex')}`;
    return Object.freeze({
      entries: sortedEntries,
      entryCount: sortedEntries.length,
      identity,
      provenance,
      rootAllocatedBytes,
      rootChangeTimeNs,
      rootMode,
      scannerRevision: AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION,
      totalBytes,
    });
  } catch (error) {
    if (
      error instanceof AgentShellWorkspaceContentScanError
      || (error instanceof Error && error.name === 'AbortError')
    ) {
      throw error;
    }
    throw new AgentShellWorkspaceContentScanError('失败');
  }
}

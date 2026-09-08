import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';

import { AGENT_SHELL_WORKSPACE_MAX_FILE_BYTES } from '../shell/agent-shell-workspace-content-scanner';

const MAX_LOCAL_PATH_BYTES = 4_096;

export type AgentLocalPathKind =
  | 'home-relative'
  | 'posix-absolute'
  | 'windows-drive-absolute'
  | 'windows-unc'
  | 'windows-device'
  | 'relative';

export interface AgentLocalPathExpression {
  absolutePath: string;
  displayPath: string;
  kind: Exclude<AgentLocalPathKind, 'relative' | 'windows-device' | 'windows-unc'>;
}

interface AgentLocalFileStatIdentity {
  ctimeNs: string;
  device: string;
  inode: string;
  mode: number;
  mtimeNs: string;
  nlink: number;
  sizeBytes: number;
}

export interface AgentLocalFileSnapshot extends AgentLocalPathExpression {
  canonicalPath: string;
  fileName: string;
  identityHash: string;
  statIdentity: AgentLocalFileStatIdentity;
}

export interface AgentOpenedLocalFile {
  fileHandle: FileHandle;
  snapshot: AgentLocalFileSnapshot;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('本机文件访问已取消');
  error.name = 'AbortError';
  throw error;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function classifyAgentLocalPath(value: unknown): AgentLocalPathKind {
  if (typeof value !== 'string') return 'relative';
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    return 'home-relative';
  }
  if (/^(?:\\\\\?|\\\\\.)\\/u.test(value)) return 'windows-device';
  if (/^\\\\[^\\]+\\[^\\]+/u.test(value)) return 'windows-unc';
  if (/^[A-Za-z]:[\\/]/u.test(value)) return 'windows-drive-absolute';
  if (value.startsWith('/')) return 'posix-absolute';
  return 'relative';
}

function homeDisplayPath(
  absolutePath: string,
  homePath: string,
  platform: NodeJS.Platform,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const relative = pathApi.relative(homePath, absolutePath);
  const outsideHome = relative === '..'
    || relative.startsWith(`..${pathApi.sep}`)
    || pathApi.isAbsolute(relative);
  if (outsideHome) return absolutePath;
  return relative ? `~/${relative.split(pathApi.sep).join('/')}` : '~';
}

export function normalizeAgentLocalPathExpression(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
  homePath = homedir(),
): AgentLocalPathExpression {
  if (
    typeof value !== 'string'
    || !value
    || utf8Length(value) > MAX_LOCAL_PATH_BYTES
    || Array.from(value).some(character => character.charCodeAt(0) < 32)
  ) {
    throw new Error('本机文件路径无效');
  }
  const kind = classifyAgentLocalPath(value);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  let absolutePath = value;
  if (kind === 'home-relative') {
    const suffix = value.slice(1).replace(/^[\\/]+/u, '');
    absolutePath = pathApi.resolve(homePath, suffix);
  } else if (platform === 'win32' && kind === 'windows-drive-absolute') {
    absolutePath = path.win32.normalize(value);
  } else if (platform !== 'win32' && kind === 'posix-absolute') {
    absolutePath = path.posix.normalize(value);
  } else {
    throw new Error('本机文件路径必须是当前平台的绝对路径或 ~/ 路径');
  }
  if (platform === 'win32' && absolutePath.slice(2).includes(':')) {
    throw new Error('本机文件路径不支持 NTFS 备用数据流');
  }
  if (!pathApi.isAbsolute(absolutePath) || utf8Length(absolutePath) > MAX_LOCAL_PATH_BYTES) {
    throw new Error('本机文件路径无效');
  }
  return Object.freeze({
    absolutePath,
    displayPath: homeDisplayPath(absolutePath, pathApi.resolve(homePath), platform),
    kind: kind === 'home-relative' ? kind : platform === 'win32'
      ? 'windows-drive-absolute'
      : 'posix-absolute',
  });
}

function safeReadFlags(): number {
  const noFollow = process.platform === 'win32' || typeof constants.O_NOFOLLOW !== 'number'
    ? 0
    : constants.O_NOFOLLOW;
  const nonBlocking = process.platform === 'win32' || typeof constants.O_NONBLOCK !== 'number'
    ? 0
    : constants.O_NONBLOCK;
  return constants.O_RDONLY | noFollow | nonBlocking;
}

function statIdentity(stat: Awaited<ReturnType<FileHandle['stat']>>): AgentLocalFileStatIdentity {
  const bigintStat = stat as unknown as {
    ctimeNs: bigint;
    dev: bigint;
    ino: bigint;
    mode: bigint;
    mtimeNs: bigint;
    nlink: bigint;
    size: bigint;
  };
  const sizeBytes = Number(bigintStat.size);
  const nlink = Number(bigintStat.nlink);
  if (
    !stat.isFile()
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > AGENT_SHELL_WORKSPACE_MAX_FILE_BYTES
    || nlink !== 1
  ) {
    throw new Error('本机来源必须是大小受限的单链接普通文件');
  }
  return Object.freeze({
    ctimeNs: String(bigintStat.ctimeNs),
    device: String(bigintStat.dev),
    inode: String(bigintStat.ino),
    mode: Number(bigintStat.mode),
    mtimeNs: String(bigintStat.mtimeNs),
    nlink,
    sizeBytes,
  });
}

function sameStatIdentity(
  left: AgentLocalFileStatIdentity,
  right: AgentLocalFileStatIdentity,
): boolean {
  return left.ctimeNs === right.ctimeNs
    && left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.nlink === right.nlink
    && left.sizeBytes === right.sizeBytes;
}

export async function openAgentLocalFile(
  value: unknown,
  signal?: AbortSignal,
): Promise<AgentOpenedLocalFile> {
  throwIfAborted(signal);
  const expression = normalizeAgentLocalPathExpression(value);
  const initialPathStat = await lstat(expression.absolutePath, { bigint: true });
  if (initialPathStat.isSymbolicLink()) throw new Error('本机来源不能是符号链接');
  const initialPathIdentity = statIdentity(initialPathStat as never);
  const canonicalPath = await realpath(expression.absolutePath);
  throwIfAborted(signal);
  const fileHandle = await open(expression.absolutePath, safeReadFlags());
  try {
    const openedIdentity = statIdentity(await fileHandle.stat({ bigint: true }) as never);
    const verifiedCanonicalPath = await realpath(expression.absolutePath);
    if (
      canonicalPath !== verifiedCanonicalPath
      || !sameStatIdentity(initialPathIdentity, openedIdentity)
    ) {
      throw new Error('本机来源文件在打开期间已经变化');
    }
    const identityHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify({
      canonicalPath,
      ...openedIdentity,
    })).digest('hex')}`;
    return Object.freeze({
      fileHandle,
      snapshot: Object.freeze({
        ...expression,
        canonicalPath,
        fileName: path.basename(canonicalPath),
        identityHash,
        statIdentity: openedIdentity,
      }),
    });
  } catch (error) {
    await fileHandle.close().catch(() => undefined);
    throw error;
  }
}

export async function verifyAgentLocalFileSnapshot(
  opened: AgentOpenedLocalFile,
  expected: AgentLocalFileSnapshot,
): Promise<void> {
  const current = opened.snapshot;
  if (
    current.absolutePath !== expected.absolutePath
    || current.canonicalPath !== expected.canonicalPath
    || current.identityHash !== expected.identityHash
    || current.fileName !== expected.fileName
    || !sameStatIdentity(current.statIdentity, expected.statIdentity)
  ) {
    throw new Error('本机来源文件已经变化，请重新准备');
  }
}

export async function verifyOpenedAgentLocalFileUnchanged(
  opened: AgentOpenedLocalFile,
): Promise<void> {
  const currentIdentity = statIdentity(await opened.fileHandle.stat({ bigint: true }) as never);
  if (!sameStatIdentity(currentIdentity, opened.snapshot.statIdentity)) {
    throw new Error('本机来源文件在读取期间已经变化');
  }
}

export const AGENT_LOCAL_PATH_MAX_BYTES = MAX_LOCAL_PATH_BYTES;

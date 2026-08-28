import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface AgentManagedRoot {
  readonly canonicalPath: string;
  readonly configuredPath: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly label: string;
}

export interface AgentManagedDirectoryIdentity {
  readonly canonicalPath: string;
  readonly device: bigint;
  readonly inode: bigint;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function assertDirectoryStat(stat: BigIntStats, label: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label}不是受控目录`);
  }
}

function sameIdentity(
  stat: Pick<BigIntStats, 'dev' | 'ino'>,
  identity: Pick<AgentManagedDirectoryIdentity, 'device' | 'inode'>,
): boolean {
  return stat.dev === identity.device && stat.ino === identity.inode;
}

async function readDirectoryIdentity(
  directoryPath: string,
  label: string,
): Promise<AgentManagedDirectoryIdentity> {
  const pathStat = await lstat(directoryPath, { bigint: true });
  assertDirectoryStat(pathStat, label);
  const canonicalPath = await realpath(directoryPath);
  const canonicalStat = await lstat(canonicalPath, { bigint: true });
  assertDirectoryStat(canonicalStat, label);
  if (!sameIdentity(canonicalStat, { device: pathStat.dev, inode: pathStat.ino })) {
    throw new Error(`${label}身份不一致`);
  }
  return Object.freeze({
    canonicalPath,
    device: canonicalStat.dev,
    inode: canonicalStat.ino,
  });
}

export async function establishAgentManagedRoot(input: {
  createIfMissing: boolean;
  label: string;
  rootPath: string;
}): Promise<AgentManagedRoot | null> {
  const configuredPath = path.resolve(input.rootPath);
  if (input.createIfMissing) await mkdir(configuredPath, { recursive: true });
  let identity: AgentManagedDirectoryIdentity;
  try {
    identity = await readDirectoryIdentity(configuredPath, input.label);
  } catch (error) {
    if (!input.createIfMissing && isMissingFileError(error)) return null;
    throw error;
  }
  const root = Object.freeze({
    ...identity,
    configuredPath,
    label: input.label,
  });
  await assertAgentManagedRoot(root);
  return root;
}

export async function assertAgentManagedRoot(root: AgentManagedRoot): Promise<void> {
  let configuredIdentity: AgentManagedDirectoryIdentity;
  let canonicalIdentity: AgentManagedDirectoryIdentity;
  try {
    [configuredIdentity, canonicalIdentity] = await Promise.all([
      readDirectoryIdentity(root.configuredPath, root.label),
      readDirectoryIdentity(root.canonicalPath, root.label),
    ]);
  } catch {
    throw new Error(`${root.label}身份已变化`);
  }
  if (
    configuredIdentity.canonicalPath !== root.canonicalPath
    || canonicalIdentity.canonicalPath !== root.canonicalPath
    || !sameIdentity({ dev: configuredIdentity.device, ino: configuredIdentity.inode }, root)
    || configuredIdentity.device !== canonicalIdentity.device
    || configuredIdentity.inode !== canonicalIdentity.inode
  ) {
    throw new Error(`${root.label}身份已变化`);
  }
}

export function resolveAgentManagedRootChild(
  root: AgentManagedRoot,
  childNameInput: string,
): string {
  const childName = String(childNameInput ?? '');
  if (
    !childName
    || childName === '.'
    || childName === '..'
    || childName.includes('\0')
    || childName.includes('/')
    || childName.includes('\\')
  ) {
    throw new Error(`${root.label}子目录名称无效`);
  }
  const childPath = path.resolve(root.canonicalPath, childName);
  if (path.dirname(childPath) !== root.canonicalPath) {
    throw new Error(`${root.label}子目录越界`);
  }
  return childPath;
}

export async function captureAgentManagedRootChildDirectory(
  root: AgentManagedRoot,
  childName: string,
): Promise<AgentManagedDirectoryIdentity> {
  await assertAgentManagedRoot(root);
  const childPath = resolveAgentManagedRootChild(root, childName);
  const identity = await readDirectoryIdentity(childPath, `${root.label}子目录`);
  if (path.dirname(identity.canonicalPath) !== root.canonicalPath) {
    throw new Error(`${root.label}子目录已逃逸`);
  }
  await assertAgentManagedRoot(root);
  return identity;
}

export async function removeAgentManagedRootChild(
  root: AgentManagedRoot,
  childName: string,
): Promise<void> {
  await assertAgentManagedRoot(root);
  const childPath = resolveAgentManagedRootChild(root, childName);
  const childStat = await lstat(childPath, { bigint: true }).catch((error) => {
    if (isMissingFileError(error)) return null;
    throw error;
  });
  if (!childStat) {
    await assertAgentManagedRoot(root);
    return;
  }
  if (childStat.isSymbolicLink()) {
    await unlink(childPath);
  } else if (childStat.isDirectory()) {
    const childIdentity = await readDirectoryIdentity(childPath, `${root.label}子目录`);
    if (
      path.dirname(childIdentity.canonicalPath) !== root.canonicalPath
      || !sameIdentity(childStat, childIdentity)
    ) {
      throw new Error(`${root.label}子目录身份已变化`);
    }
    await assertAgentManagedRoot(root);
    await rm(childPath, { force: true, recursive: true });
  } else {
    await unlink(childPath);
  }
  await assertAgentManagedRoot(root);
}

import {
  link,
  mkdir,
  mkdtemp,
  open as openFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_LOCAL_PATH_MAX_BYTES,
  classifyAgentLocalPath,
  normalizeAgentLocalPathExpression,
  openAgentLocalFile,
  verifyAgentLocalFileSnapshot,
  verifyOpenedAgentLocalFileUnchanged,
} from './agent-local-file';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(actual.open),
  };
});

const linkIt = process.platform === 'win32' ? it.skip : it;

describe('Agent local path contract', () => {
  it.each([
    ['~', 'home-relative'],
    ['~/Downloads/report.md', 'home-relative'],
    [String.raw`~\Downloads\report.md`, 'home-relative'],
    ['/tmp/report.md', 'posix-absolute'],
    [String.raw`C:\Users\tester\report.md`, 'windows-drive-absolute'],
    ['d:/Downloads/report.md', 'windows-drive-absolute'],
    [String.raw`\\server\share\report.md`, 'windows-unc'],
    [String.raw`\\?\C:\Users\tester\report.md`, 'windows-device'],
    [String.raw`\\.\PIPE\omniflow`, 'windows-device'],
    ['Downloads/report.md', 'relative'],
    ['$HOME/Downloads/report.md', 'relative'],
  ] as const)('classifies %s as %s', (value, expected) => {
    expect(classifyAgentLocalPath(value)).toBe(expected);
  });

  it('normalizes POSIX and home-relative paths without leaking home in display paths', () => {
    expect(normalizeAgentLocalPathExpression(
      '~/Downloads/../report.md',
      'darwin',
      '/Users/tester',
    )).toEqual({
      absolutePath: '/Users/tester/report.md',
      displayPath: '~/report.md',
      kind: 'home-relative',
    });
    expect(normalizeAgentLocalPathExpression(
      '/tmp/work/../report.md',
      'darwin',
      '/Users/tester',
    )).toEqual({
      absolutePath: '/tmp/report.md',
      displayPath: '/tmp/report.md',
      kind: 'posix-absolute',
    });
  });

  it('normalizes Windows drive and home-relative paths using Windows semantics', () => {
    expect(normalizeAgentLocalPathExpression(
      String.raw`~\Downloads\..\report.md`,
      'win32',
      String.raw`C:\Users\tester`,
    )).toEqual({
      absolutePath: String.raw`C:\Users\tester\report.md`,
      displayPath: '~/report.md',
      kind: 'home-relative',
    });
    expect(normalizeAgentLocalPathExpression(
      'D:/work/../report.md',
      'win32',
      String.raw`C:\Users\tester`,
    )).toEqual({
      absolutePath: String.raw`D:\report.md`,
      displayPath: String.raw`D:\report.md`,
      kind: 'windows-drive-absolute',
    });
  });

  it.each([
    [String.raw`C:\Users\tester\report.md`, 'darwin'],
    ['/tmp/report.md', 'win32'],
    [String.raw`\\server\share\report.md`, 'win32'],
    [String.raw`\\?\C:\Users\tester\report.md`, 'win32'],
    [String.raw`\\.\PIPE\omniflow`, 'win32'],
  ] as const)('rejects wrong-platform or unsupported absolute path %s', (value, platform) => {
    expect(() => normalizeAgentLocalPathExpression(
      value,
      platform,
      platform === 'win32' ? String.raw`C:\Users\tester` : '/Users/tester',
    )).toThrow('当前平台的绝对路径或 ~/ 路径');
  });

  it.each([
    ['relative path', 'Downloads/report.md'],
    ['dot-relative path', './report.md'],
    ['shell home expression', '$HOME/Downloads/report.md'],
    ['braced shell home expression', '${HOME}/Downloads/report.md'],
    ['Windows environment expression', String.raw`%USERPROFILE%\Downloads\report.md`],
    ['NUL byte', '/tmp/report\0.md'],
    ['newline', '/tmp/report\n.md'],
    ['tab', '/tmp/report\t.md'],
  ] as const)('rejects %s', (_label, value) => {
    expect(() => normalizeAgentLocalPathExpression(value, 'darwin', '/Users/tester'))
      .toThrow();
  });

  it('rejects non-string and overlong path input', () => {
    expect(() => normalizeAgentLocalPathExpression(null)).toThrow('本机文件路径无效');
    expect(() => normalizeAgentLocalPathExpression(
      `/${'a'.repeat(AGENT_LOCAL_PATH_MAX_BYTES)}`,
      'darwin',
      '/Users/tester',
    )).toThrow('本机文件路径无效');
  });

  it('rejects NTFS alternate data stream syntax', () => {
    expect(() => normalizeAgentLocalPathExpression(
      String.raw`C:\Users\tester\report.md:secret`,
      'win32',
      String.raw`C:\Users\tester`,
    )).toThrow('NTFS 备用数据流');
  });
});

describe('Agent local file opening', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.mocked(openFile).mockClear();
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-local-file-'));
    roots.push(root);
    return root;
  }

  it('opens one unchanged regular file and verifies its frozen identity', async () => {
    const root = await createRoot();
    const filePath = path.join(root, 'report.md');
    await writeFile(filePath, 'trusted-content');
    const canonicalPath = await realpath(filePath);

    const opened = await openAgentLocalFile(filePath);
    try {
      expect(opened.snapshot).toMatchObject({
        absolutePath: filePath,
        canonicalPath,
        fileName: 'report.md',
        kind: process.platform === 'win32'
          ? 'windows-drive-absolute'
          : 'posix-absolute',
        statIdentity: {
          nlink: 1,
          sizeBytes: Buffer.byteLength('trusted-content'),
        },
      });
      expect(opened.snapshot.identityHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      await expect(verifyAgentLocalFileSnapshot(opened, opened.snapshot)).resolves.toBeUndefined();
      await expect(verifyOpenedAgentLocalFileUnchanged(opened)).resolves.toBeUndefined();
    } finally {
      await opened.fileHandle.close();
    }
  });

  it('rejects a directory', async () => {
    const root = await createRoot();
    const directoryPath = path.join(root, 'directory');
    await mkdir(directoryPath);

    await expect(openAgentLocalFile(directoryPath))
      .rejects.toThrow('单链接普通文件');
  });

  linkIt('rejects a symbolic link', async () => {
    const root = await createRoot();
    const sourcePath = path.join(root, 'source.txt');
    const linkPath = path.join(root, 'linked.txt');
    await writeFile(sourcePath, 'trusted-content');
    await symlink(sourcePath, linkPath);

    await expect(openAgentLocalFile(linkPath)).rejects.toThrow('不能是符号链接');
  });

  linkIt('rejects any multiply linked regular file', async () => {
    const root = await createRoot();
    const sourcePath = path.join(root, 'source.txt');
    await writeFile(sourcePath, 'trusted-content');
    await link(sourcePath, path.join(root, 'hardlink.txt'));

    await expect(openAgentLocalFile(sourcePath)).rejects.toThrow('单链接普通文件');
  });

  it('detects changes made after the file handle was opened', async () => {
    const root = await createRoot();
    const filePath = path.join(root, 'source.txt');
    await writeFile(filePath, 'trusted-content');
    const opened = await openAgentLocalFile(filePath);

    try {
      await writeFile(filePath, 'replacement-content-with-a-different-size');
      await expect(verifyOpenedAgentLocalFileUnchanged(opened))
        .rejects.toThrow('读取期间已经变化');
    } finally {
      await opened.fileHandle.close();
    }
  });

  linkIt('detects path replacement between lstat and open', async () => {
    const root = await createRoot();
    const filePath = path.join(root, 'source.txt');
    const originalPath = path.join(root, 'source.original.txt');
    await writeFile(filePath, 'trusted-content');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
    const actualOpen = actualFs.open as typeof openFile;

    vi.mocked(openFile).mockImplementationOnce(async (targetPath, flags, mode) => {
      await rename(filePath, originalPath);
      await writeFile(filePath, 'replacement');
      return actualOpen(targetPath, flags, mode);
    });

    await expect(openAgentLocalFile(filePath))
      .rejects.toThrow('打开期间已经变化');
  });
});

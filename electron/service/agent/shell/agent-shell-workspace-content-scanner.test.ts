import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_SHELL_WORKSPACE_CONTENT_SCAN_TIMEOUT_MS,
  AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION,
  scanAgentShellWorkspaceContent,
} from './agent-shell-workspace-content-scanner';

const LOGICAL_ROOTS = ['input', 'work', 'output', 'tmp', 'home'] as const;
const execFileAsync = promisify(execFile);
const linuxOnlyIt = process.platform === 'linux' ? it : it.skip;
const macOnlyIt = process.platform === 'darwin' ? it : it.skip;
const verifiedIdentityIt = process.platform === 'win32' ? it.skip : it;
const windowsOnlyIt = process.platform === 'win32' ? it : it.skip;

describe('Agent shell workspace content scanner', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })));
  });

  async function createWorkspace(order: readonly string[] = LOGICAL_ROOTS): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-shell-content-scan-'));
    roots.push(root);
    for (const logicalRoot of order) await mkdir(path.join(root, logicalRoot));
    return root;
  }

  async function scan(rootPath: string, overrides: Partial<Parameters<
    typeof scanAgentShellWorkspaceContent
  >[0]> = {}) {
    return scanAgentShellWorkspaceContent({
      logicalRoots: LOGICAL_ROOTS,
      provenance: ['stage:library:42'],
      rootPath,
      ...overrides,
    });
  }

  windowsOnlyIt('fails closed until Windows filesystem identity has a verified adapter', async () => {
    const root = await createWorkspace();
    await expect(scan(root)).rejects.toThrow('Windows 平台尚未通过完整内容身份校验');
  });

  verifiedIdentityIt('produces a stable identity for one unchanged physical snapshot', async () => {
    const first = await createWorkspace(LOGICAL_ROOTS);
    const second = await createWorkspace([...LOGICAL_ROOTS].reverse());
    for (const root of [first, second]) {
      await mkdir(path.join(root, 'work', 'nested'));
      await writeFile(path.join(root, 'work', 'nested', 'hello.txt'), 'hello\n');
      await writeFile(path.join(root, 'input', 'fixture.json'), '{"fixture":true}\n');
    }

    const firstSnapshot = await scan(first);
    const repeatedSnapshot = await scan(first);
    const secondSnapshot = await scan(second);

    expect(repeatedSnapshot.identity).toBe(firstSnapshot.identity);
    expect(firstSnapshot.identity).toMatch(/^v3:[a-f0-9]{64}$/u);
    expect(firstSnapshot.scannerRevision).toBe(AGENT_SHELL_WORKSPACE_CONTENT_SCANNER_REVISION);
    expect(AGENT_SHELL_WORKSPACE_CONTENT_SCAN_TIMEOUT_MS).toBeLessThan(30_000);
    expect(firstSnapshot.totalBytes).toBe(
      firstSnapshot.rootAllocatedBytes
      + firstSnapshot.entries.reduce((total, entry) => (
        total + (entry.kind === 'file'
          ? Math.max(entry.sizeBytes, entry.allocatedBytes)
          : entry.allocatedBytes)
      ), 0),
    );
    expect(firstSnapshot.totalBytes).toBeGreaterThanOrEqual(
      Buffer.byteLength('hello\n{"fixture":true}\n'),
    );
    expect(firstSnapshot.entries.map(entry => entry.logicalPath)).toEqual([
      'home',
      'input',
      'input/fixture.json',
      'output',
      'tmp',
      'work',
      'work/nested',
      'work/nested/hello.txt',
    ]);
    expect(firstSnapshot.entries.find(entry => entry.logicalPath.endsWith('hello.txt')))
      .toMatchObject({ contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) });
    expect(secondSnapshot.entries.map(entry => entry.logicalPath))
      .toEqual(firstSnapshot.entries.map(entry => entry.logicalPath));
  });

  macOnlyIt('changes identity for file resource forks and directory xattrs', async () => {
    const root = await createWorkspace();
    const target = path.join(root, 'work', 'target.txt');
    const targetDirectory = path.join(root, 'output');
    await writeFile(target, 'plain data fork');
    const initial = await scan(root);

    await execFileAsync('/usr/bin/xattr', [
      '-w',
      'com.apple.ResourceFork',
      'resource-fork-data',
      target,
    ]);
    const resourceForkChanged = await scan(root);
    expect(resourceForkChanged.identity).not.toBe(initial.identity);

    await execFileAsync('/usr/bin/xattr', [
      '-w',
      'com.omniflow.agent-test',
      'directory-metadata',
      targetDirectory,
    ]);
    const directoryMetadataChanged = await scan(root);
    expect(directoryMetadataChanged.identity).not.toBe(resourceForkChanged.identity);
  });

  verifiedIdentityIt('changes identity for bytes, names, empty directories, permissions, and every logical root', async () => {
    const root = await createWorkspace();
    const target = path.join(root, 'work', 'target.txt');
    await writeFile(target, 'first');
    await chmod(target, 0o600);
    const initial = await scan(root);

    await writeFile(target, 'other');
    const changedBytes = await scan(root);
    expect(changedBytes.identity).not.toBe(initial.identity);

    await rename(target, path.join(root, 'work', 'renamed.txt'));
    const renamed = await scan(root);
    expect(renamed.identity).not.toBe(changedBytes.identity);

    await mkdir(path.join(root, 'output', 'empty'));
    const emptyDirectory = await scan(root);
    expect(emptyDirectory.identity).not.toBe(renamed.identity);

    const renamedPath = path.join(root, 'work', 'renamed.txt');
    await chmod(renamedPath, 0o640);
    const permissions = await scan(root);
    expect(permissions.identity).not.toBe(emptyDirectory.identity);

    await writeFile(path.join(root, 'home', 'profile-state'), 'home');
    const home = await scan(root);
    expect(home.identity).not.toBe(permissions.identity);

    await writeFile(path.join(root, 'tmp', 'runtime-state'), 'tmp');
    const tmp = await scan(root);
    expect(tmp.identity).not.toBe(home.identity);

    await chmod(root, 0o750);
    const rootPermissions = await scan(root);
    expect(rootPermissions.identity).not.toBe(tmp.identity);
    expect(rootPermissions.rootMode).toBe(0o750);
  });

  verifiedIdentityIt('binds cumulative provenance into the semantic identity', async () => {
    const root = await createWorkspace();
    const initial = await scan(root, { provenance: ['stage:library:42'] });
    const changed = await scan(root, { provenance: ['stage:library:43'] });

    expect(changed.identity).not.toBe(initial.identity);
  });

  verifiedIdentityIt('rejects links and anything outside the five controlled roots', async () => {
    const symlinkRoot = await createWorkspace();
    const outside = path.join(symlinkRoot, 'outside.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, path.join(symlinkRoot, 'work', 'linked.txt'));
    await expect(scan(symlinkRoot)).rejects.toThrow('逻辑根集合不匹配');

    const nestedSymlinkRoot = await createWorkspace();
    const nestedOutsideRoot = await mkdtemp(path.join(os.tmpdir(), 'omniflow-shell-outside-'));
    roots.push(nestedOutsideRoot);
    const nestedOutside = path.join(nestedOutsideRoot, 'outside-target.txt');
    await writeFile(nestedOutside, 'outside');
    await symlink(nestedOutside, path.join(nestedSymlinkRoot, 'work', 'linked.txt'));
    await expect(scan(nestedSymlinkRoot)).rejects.toThrow('符号链接');

    const hardlinkRoot = await createWorkspace();
    const source = path.join(hardlinkRoot, 'work', 'source.txt');
    await writeFile(source, 'same inode');
    await link(source, path.join(hardlinkRoot, 'output', 'hardlink.txt'));
    await expect(scan(hardlinkRoot)).rejects.toThrow('硬链接');

    const extraRoot = await createWorkspace();
    await mkdir(path.join(extraRoot, 'extra'));
    await expect(scan(extraRoot)).rejects.toThrow('逻辑根集合不匹配');
  });

  verifiedIdentityIt('fails closed at entry, depth, byte, and cancellation bounds', async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, 'work', 'four.txt'), 'four');
    await expect(scan(root, { maxEntries: 6 })).resolves.toMatchObject({ entryCount: 6 });
    await expect(scan(root, { maxEntries: 5 })).rejects.toThrow('条目过多');
    await expect(scan(root, { maxFileBytes: 3 })).rejects.toThrow('单文件大小超限');
    await expect(scan(root, { maxTotalBytes: 3 })).rejects.toThrow('总大小超限');

    await mkdir(path.join(root, 'output', 'one'));
    await mkdir(path.join(root, 'output', 'one', 'two'));
    await expect(scan(root, { maxDepth: 2 })).rejects.toThrow('目录深度超限');

    const controller = new AbortController();
    controller.abort();
    await expect(scan(root, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });

    let budgetChecks = 0;
    const enumerationSignal = {
      get aborted() {
        budgetChecks += 1;
        return budgetChecks >= 4;
      },
    } as AbortSignal;
    await expect(scan(root, { signal: enumerationSignal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(budgetChecks).toBe(4);
  });

  linuxOnlyIt('rejects non-UTF-8 directory entry bytes before building a logical path', async () => {
    const root = await createWorkspace();
    const workRoot = Buffer.from(`${path.join(root, 'work')}${path.sep}`);
    const invalidPath = Buffer.concat([workRoot, Buffer.from([0xff])]);
    try {
      await writeFile(invalidPath, 'invalid');
      await writeFile(path.join(root, 'work', '\ufffd'), 'replacement');

      await expect(scan(root)).rejects.toThrow('文件名不是规范 UTF-8');
    } finally {
      await unlink(invalidPath).catch(() => undefined);
    }
  });
});

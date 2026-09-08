import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAgentShellHostEnvironmentSnapshot,
  revalidateAgentShellHostCwd,
  resolveAgentShellHostContext,
  resolveAgentShellHostCwd,
  sameAgentShellHostCwd,
} from './agent-shell-host-context';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-host-context-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('agent shell host context', () => {
  it('resolves an absolute cwd and freezes canonical directory identity', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);

    const resolved = await resolveAgentShellHostCwd({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: cwd,
    });

    expect(resolved.lexicalPath).toBe(cwd);
    expect(resolved.canonicalPath).toMatch(/\/cwd$/u);
    expect(resolved.identity.inode).not.toBe('0');
    expect(sameAgentShellHostCwd(resolved, resolved)).toBe(true);
  });

  it('expands host ~ and resolves relative cwd from the frozen default cwd', async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, 'nested');
    await mkdir(nested);

    const homeRelative = await resolveAgentShellHostCwd({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: '~/nested',
    });
    const relative = await resolveAgentShellHostCwd({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: 'nested',
    });

    expect(homeRelative.canonicalPath).toMatch(/\/nested$/u);
    expect(relative.canonicalPath).toBe(homeRelative.canonicalPath);
  });

  it('rejects a symlink cwd instead of silently following it', async () => {
    const root = await temporaryDirectory();
    const target = path.join(root, 'target');
    const link = path.join(root, 'link');
    await mkdir(target);
    await symlink(target, link, 'dir');

    await expect(resolveAgentShellHostCwd({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: link,
    })).rejects.toThrow('普通目录');
  });

  it('fails closed when the bound cwd is replaced before spawn', async () => {
    const root = await temporaryDirectory();
    const cwd = path.join(root, 'cwd');
    await mkdir(cwd);
    const expected = await resolveAgentShellHostCwd({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: cwd,
    });
    await rm(cwd, { recursive: true });
    await mkdir(cwd);

    await expect(revalidateAgentShellHostCwd(expected, {
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      requestedCwd: cwd,
    })).rejects.toThrow('宿主 cwd 在执行前已变化');
  });

  it('filters sensitive source variables and rejects protected overrides', () => {
    const snapshot = createAgentShellHostEnvironmentSnapshot({
      overrides: { SAFE_OVERRIDE: 'enabled' },
      source: {
        API_TOKEN: 'private-token',
        HOME: '/Users/example',
        PATH: '/usr/bin',
        SAFE: 'value',
        SHELL: '/bin/zsh',
      },
    });

    expect(snapshot.entries).toEqual([
      { name: 'HOME', value: '/Users/example' },
      { name: 'PATH', value: '/usr/bin' },
      { name: 'SAFE', value: 'value' },
      { name: 'SAFE_OVERRIDE', value: 'enabled' },
    ]);
    expect(snapshot.pathHash).toMatch(/^v1:[a-f0-9]{64}$/u);
    expect(snapshot.environmentIdentity).toMatch(/^v1:[a-f0-9]{64}$/u);
    expect(() => createAgentShellHostEnvironmentSnapshot({
      overrides: { PATH: '/tmp/attacker' },
      source: {},
    })).toThrow('禁止覆盖');
  });

  it('rejects snapshots that exceed the Supervisor environment boundary', () => {
    expect(() => createAgentShellHostEnvironmentSnapshot({
      source: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
        `SAFE_VALUE_${index}`,
        String(index),
      ])),
    })).toThrow('环境变量过多');
  });

  it('does not include sensitive values in the context fingerprint', async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, 'marker'), 'marker');
    const first = await resolveAgentShellHostContext({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      environment: {
        source: {
          API_TOKEN: 'one',
          PATH: '/usr/bin',
        },
      },
    });
    const second = await resolveAgentShellHostContext({
      defaultCwd: root,
      homedir: root,
      platform: 'darwin',
      environment: {
        source: {
          API_TOKEN: 'two',
          PATH: '/usr/bin',
        },
      },
    });

    expect(first.environment.entries).toEqual([{ name: 'PATH', value: '/usr/bin' }]);
    expect(second.environment.entries).toEqual(first.environment.entries);
    expect(second.contextIdentity).toBe(first.contextIdentity);
  });
});

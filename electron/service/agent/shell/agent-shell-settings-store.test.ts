import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAgentShellSettingsStore } from './agent-shell-settings-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-shell-settings-'));
  temporaryDirectories.push(directory);
  const storePath = path.join(directory, 'settings.json');
  return { store: createAgentShellSettingsStore({ storePath }), storePath };
}

describe('agent shell settings store', () => {
  it('defaults to ask and persists an explicit mode atomically', async () => {
    const { store, storePath } = await createStore();
    expect(store.load()).toEqual({ permissionMode: 'ask', version: 1 });

    expect(store.updatePermissionMode('auto')).toEqual({
      permissionMode: 'auto',
      version: 1,
    });
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toEqual({
      permissionMode: 'auto',
      version: 1,
    });
    expect(createAgentShellSettingsStore({ storePath }).load()).toEqual({
      permissionMode: 'auto',
      version: 1,
    });
  });

  it('fails closed for updates and falls back to ask for damaged files', async () => {
    const { store, storePath } = await createStore();
    expect(() => store.updatePermissionMode('anything')).toThrow('权限模式无效');
    await import('node:fs/promises').then(fs => fs.writeFile(storePath, '{bad', 'utf8'));
    expect(createAgentShellSettingsStore({ storePath }).load().permissionMode).toBe('ask');
  });
});

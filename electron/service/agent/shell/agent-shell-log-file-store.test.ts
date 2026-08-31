import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentLocalStorageQuotaManager } from '../storage/agent-local-storage-quota-manager';
import {
  AGENT_SHELL_LOG_FILE_NAME,
  createAgentShellLogFileStore,
} from './agent-shell-log-file-store';

const OWNER = Object.freeze({
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
});
const LOG_REF = `log:v1:${'a'.repeat(64)}`;
const SECOND_LOG_REF = `log:v1:${'b'.repeat(64)}`;

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-shell-log-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('Agent Shell log file store', () => {
  it('creates an opaque resource, enforces a byte bound, and reads bounded slices', async () => {
    const root = await createRoot();
    const store = createAgentShellLogFileStore({
      maxFileBytes: 8,
      maxReadBytes: 4,
      rootPath: root,
    });
    const handle = await store.create(LOG_REF);

    await expect(handle.getSize()).resolves.toBe(0);
    await expect(handle.append('abc')).resolves.toEqual({
      acceptedBytes: 3,
      droppedBytes: 0,
      sizeBytes: 3,
    });
    await expect(handle.append(Buffer.from('defgh'))).resolves.toEqual({
      acceptedBytes: 5,
      droppedBytes: 0,
      sizeBytes: 8,
    });
    await expect(handle.append('z')).resolves.toEqual({
      acceptedBytes: 0,
      droppedBytes: 1,
      sizeBytes: 8,
    });

    const slice = await handle.read({ maxBytes: 100, offset: 2 });
    expect(Buffer.from(slice.data).toString('utf8')).toBe('cdef');
    expect(slice).toMatchObject({ eof: false, nextOffset: 6, offset: 2, sizeBytes: 8 });
    const lastSlice = await handle.read({ maxBytes: 100, offset: slice.nextOffset });
    expect(Buffer.from(lastSlice.data).toString('utf8')).toBe('gh');
    expect(lastSlice.eof).toBe(true);

    const entries = await readdir(root);
    expect(entries).toEqual([`agent-shell-log-${'a'.repeat(64)}`]);
    await expect(readFile(
      path.join(root, entries[0], AGENT_SHELL_LOG_FILE_NAME),
      'utf8',
    )).resolves.toBe('abcdefgh');
    await store.dispose();
  });

  it('reopens an existing physical resource without exposing its path', async () => {
    const root = await createRoot();
    const first = createAgentShellLogFileStore({ rootPath: root });
    const handle = await first.create(LOG_REF);
    await handle.append('persisted output');
    await first.dispose();

    const second = createAgentShellLogFileStore({ rootPath: root });
    const reopened = await second.open(LOG_REF);
    const result = await reopened.read();
    expect(Buffer.from(result.data).toString('utf8')).toBe('persisted output');
    expect(reopened).not.toHaveProperty('filePath');
    await second.dispose();
  });

  it('reopens a resource from a configured legacy root after preferring the current root', async () => {
    const currentRoot = await createRoot();
    const legacyRoot = await createRoot();
    const first = createAgentShellLogFileStore({ rootPath: legacyRoot });
    const handle = await first.create(LOG_REF);
    await handle.append('legacy output');
    await first.dispose();

    const second = createAgentShellLogFileStore({
      legacyRootPaths: [legacyRoot],
      rootPath: currentRoot,
    });
    const reopened = await second.open(LOG_REF);
    await expect(reopened.getSize()).resolves.toBe(Buffer.byteLength('legacy output', 'utf8'));
    await expect(reopened.read()).resolves.toMatchObject({ eof: true });
    await second.dispose();
  });

  it('rejects malformed references before touching the managed root', async () => {
    const root = await createRoot();
    const store = createAgentShellLogFileStore({ rootPath: root });
    await expect(store.create('log:v1:../escape')).rejects.toThrow('logRef 无效');
    await expect(store.open('log:v1:bad')).rejects.toThrow('logRef 无效');
    await expect(store.ready).resolves.toBeUndefined();
    await expect(readdir(root)).resolves.toEqual([]);
    await store.dispose();
  });

  it('registers a quota adapter and removes the physical resource before ledger release', async () => {
    const root = await createRoot();
    const quotaManager = createAgentLocalStorageQuotaManager({ maxTotalBytes: 100 });
    const store = createAgentShellLogFileStore({ quotaManager, rootPath: root });
    await store.ready;
    const handle = await store.create(LOG_REF);
    await handle.append('abc');
    const reservationId = await quotaManager.reserve(
      OWNER,
      'shell-log',
      'run-1',
      8,
      10_000,
      'shell-log',
    );
    await quotaManager.bindResource(reservationId, LOG_REF, OWNER);
    await quotaManager.commit(reservationId, LOG_REF, 3, OWNER);
    await quotaManager.markDeleting(LOG_REF, OWNER, 3);
    await expect(quotaManager.requestRelease(LOG_REF, OWNER)).resolves.toMatchObject({
      released: true,
      state: 'released',
    });
    await expect(store.open(LOG_REF)).rejects.toThrow('不存在或已经清理');
    await expect(readdir(root)).resolves.toEqual([]);
    await store.dispose();
    await quotaManager.close();
  });

  it('removes stale unmanaged residue while retaining recent directories', async () => {
    const root = await createRoot();
    const staleDirectory = path.join(root, `agent-shell-log-${'c'.repeat(64)}`);
    const recentDirectory = path.join(root, `agent-shell-log-${'d'.repeat(64)}`);
    await mkdir(staleDirectory);
    await mkdir(recentDirectory);
    const currentTime = 100_000;
    await utimes(staleDirectory, (currentTime - 1_000) / 1_000, (currentTime - 1_000) / 1_000);
    const quotaManager = createAgentLocalStorageQuotaManager();
    const store = createAgentShellLogFileStore({
      now: () => currentTime,
      quotaManager,
      rootPath: root,
      ttlMs: 100,
    });
    await store.ready;
    await expect(lstat(staleDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(recentDirectory)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    await store.dispose();
    await quotaManager.close();
  });

  it('rejects read offsets and max sizes that are not safe positive values', async () => {
    const root = await createRoot();
    const store = createAgentShellLogFileStore({ rootPath: root });
    const handle = await store.create(SECOND_LOG_REF);
    await expect(handle.read({ offset: -1 })).rejects.toThrow('偏移无效');
    await expect(handle.read({ maxBytes: 0 })).rejects.toThrow('读取上限无效');
    await expect(handle.append(new Uint8Array())).resolves.toEqual({
      acceptedBytes: 0,
      droppedBytes: 0,
      sizeBytes: 0,
    });
    await store.dispose();
  });
});

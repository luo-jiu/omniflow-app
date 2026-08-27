import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAgentLocalStorageQuotaManager,
  type AgentLocalStorageQuotaOwner,
} from './agent-local-storage-quota-manager';
import { createSQLiteAgentLocalStorageQuotaPersistence } from './agent-local-storage-quota-sqlite';

const OWNER: AgentLocalStorageQuotaOwner = {
  accountScope: 'user:7001',
  backendScope: 'https://example.com/api',
};

describe('SQLite Agent local storage quota persistence', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, {
      force: true,
      recursive: true,
    })));
  });

  it('recovers resources after the manager is recreated', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-quota-sqlite-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');

    const firstPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const first = createAgentLocalStorageQuotaManager({
      adapters: { artifact: { remove: async () => undefined } },
      persistence: firstPersistence,
      createId: () => 'reservation-1',
    });
    await first.ready;
    const reservationId = await first.reserve(OWNER, 'artifact', 'run-1', 12, 10_000, 'artifact');
    await first.bindResource(reservationId, 'resource-1', OWNER);
    await first.commit(reservationId, 'resource-1', 9, OWNER);
    await first.close();

    const secondPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const second = createAgentLocalStorageQuotaManager({
      adapters: { artifact: { remove: async () => undefined } },
      persistence: secondPersistence,
    });
    await second.ready;
    expect(second.getResource('resource-1', OWNER)).toMatchObject({
      actualBytes: 9,
      state: 'committed',
    });
    expect(second.getUsage()).toMatchObject({ totalBytes: 9, resourceCount: 1 });
    await second.close();
  });

  it('keeps deleting resources durable when adapter removal initially fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-quota-delete-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const persistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const fail = true;
    const manager = createAgentLocalStorageQuotaManager({
      adapters: { artifact: { remove: async () => { if (fail) throw new Error('offline'); } } },
      persistence,
      createId: () => 'reservation-1',
    });
    await manager.ready;
    const reservationId = await manager.reserve(OWNER, 'artifact', 'run-1', 4, 10_000, 'artifact');
    await manager.bindResource(reservationId, 'resource-1', OWNER);
    await expect(manager.requestRelease('resource-1', OWNER)).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    await manager.close();

    const restoredPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const restored = createAgentLocalStorageQuotaManager({
      adapters: { artifact: { remove: async () => undefined } },
      persistence: restoredPersistence,
    });
    await restored.ready;
    expect(restored.getResource('resource-1', OWNER)).toMatchObject({ state: 'deleting' });
    await expect(restored.sweep('retry')).resolves.toMatchObject({ released: 1 });
    await restored.close();
  });
});

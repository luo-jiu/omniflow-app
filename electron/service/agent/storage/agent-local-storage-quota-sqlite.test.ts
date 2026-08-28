import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';

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

async function withDatabase<T>(
  databasePath: string,
  operation: (database: sqlite3.Database) => Promise<T>,
): Promise<T> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  try {
    return await operation(database);
  } finally {
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });
  }
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function all<T>(database: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

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

  it('adds the unknown occupancy marker to an existing quota ledger in place', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-quota-upgrade-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    await withDatabase(databasePath, database => exec(database, `
      CREATE TABLE agent_local_storage_resources (
        id TEXT PRIMARY KEY,
        backend_scope TEXT NOT NULL,
        account_scope TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        resource_ref TEXT UNIQUE,
        category TEXT NOT NULL,
        run_id TEXT NOT NULL,
        expected_bytes INTEGER NOT NULL,
        actual_bytes INTEGER,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_touched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_error_code TEXT
      );
    `));

    const persistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    await expect(persistence.load()).resolves.toEqual([]);
    await persistence.close?.();

    await withDatabase(databasePath, async (database) => {
      const columns = await all<{ name: string }>(
        database,
        'PRAGMA table_info(agent_local_storage_resources)',
      );
      expect(columns.map(column => column.name)).toContain('occupancy_unknown');
    });
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

  it('keeps unknown physical occupancy fail-closed across policy changes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-quota-unknown-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const firstPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const first = createAgentLocalStorageQuotaManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('offline'); } },
      },
      createId: () => 'unknown-reservation',
      maxTotalBytes: 10,
      persistence: firstPersistence,
    });
    await first.ready;
    await first.reserve(OWNER, 'artifact', 'run-1', 0, 10_000, 'artifact');
    await first.bindResource('unknown-reservation', 'unknown-resource', OWNER);
    await first.commit('unknown-reservation', 'unknown-resource', 0, OWNER);
    await expect(first.requestRelease('unknown-resource', OWNER, 'unknown')).resolves.toEqual({
      released: false,
      state: 'deleting',
    });
    await first.close();

    const secondPersistence = await createSQLiteAgentLocalStorageQuotaPersistence(databasePath);
    const second = createAgentLocalStorageQuotaManager({
      adapters: {
        artifact: { remove: async () => { throw new Error('still offline'); } },
      },
      maxTotalBytes: 20,
      persistence: secondPersistence,
    });
    await second.ready;
    await expect(second.reserve(OWNER, 'artifact', 'run-2', 0, 10_000, 'artifact'))
      .rejects.toThrow('物理占用未知');
    await second.close();
  });
});

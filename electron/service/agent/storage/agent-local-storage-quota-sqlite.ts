import sqlite3 from 'sqlite3';

import { agentDatabaseSchemaCoordinator } from './agent-database-schema-coordinator';
import type {
  AgentLocalStorageQuotaPersistedRecord,
  AgentLocalStorageQuotaPersistence,
  AgentLocalStorageQuotaState,
} from './agent-local-storage-quota-manager';

const COMPONENT = 'local-storage-quota';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_local_storage_resources (
    id TEXT PRIMARY KEY,
    backend_scope TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    resource_ref TEXT UNIQUE,
    category TEXT NOT NULL,
    run_id TEXT NOT NULL,
    expected_bytes INTEGER NOT NULL CHECK (expected_bytes >= 0),
    actual_bytes INTEGER CHECK (actual_bytes IS NULL OR actual_bytes >= 0),
    state TEXT NOT NULL CHECK (state IN ('reserved', 'bound', 'committed', 'deleting')),
    created_at INTEGER NOT NULL,
    last_touched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code IN ('adapter_unavailable', 'live_lease', 'remove_failed'))
  );

  CREATE INDEX IF NOT EXISTS agent_local_storage_resources_expiry_idx
    ON agent_local_storage_resources (state, expires_at);
  CREATE INDEX IF NOT EXISTS agent_local_storage_resources_owner_idx
    ON agent_local_storage_resources (backend_scope, account_scope, run_id);
`;

interface QuotaRow {
  id: string;
  backend_scope: string;
  account_scope: string;
  adapter_id: string;
  resource_ref: string | null;
  category: string;
  run_id: string;
  expected_bytes: number;
  actual_bytes: number | null;
  state: AgentLocalStorageQuotaState;
  created_at: number;
  last_touched_at: number;
  expires_at: number;
  last_error_code: AgentLocalStorageQuotaPersistedRecord['lastErrorCode'] | null;
}

function openDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(
      databasePath,
      sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
      error => (error ? reject(error) : resolve(database)),
    );
  });
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => (error ? reject(error) : resolve()));
  });
}

function all<T>(database: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all(sql, (error, rows) => (error ? reject(error) : resolve(rows as T[])));
  });
}

function run(database: sqlite3.Database, sql: string, parameters: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, parameters, error => (error ? reject(error) : resolve()));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => (error ? reject(error) : resolve()));
  });
}

function toPersistenceRow(row: QuotaRow): AgentLocalStorageQuotaPersistedRecord {
  return {
    accountScope: row.account_scope,
    adapterId: row.adapter_id,
    actualBytes: row.actual_bytes,
    backendScope: row.backend_scope,
    category: row.category,
    createdAt: row.created_at,
    expectedBytes: row.expected_bytes,
    expiresAt: row.expires_at,
    id: row.id,
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    lastTouchedAt: row.last_touched_at,
    ...(row.resource_ref ? { resourceRef: row.resource_ref } : {}),
    runId: row.run_id,
    state: row.state,
  };
}

export async function initializeAgentLocalStorageQuotaDatabaseSchema(
  database: sqlite3.Database,
): Promise<void> {
  await exec(database, SCHEMA);
}

export async function createSQLiteAgentLocalStorageQuotaPersistence(
  databasePath: string,
): Promise<AgentLocalStorageQuotaPersistence> {
  const database = await openDatabase(databasePath);
  try {
    await exec(database, 'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    await agentDatabaseSchemaCoordinator.ensureReady(
      databasePath,
      COMPONENT,
      () => initializeAgentLocalStorageQuotaDatabaseSchema(database),
      database,
    );

    return {
      async load() {
        const rows = await all<QuotaRow>(
          database,
          `SELECT id, backend_scope, account_scope, adapter_id, resource_ref,
             category, run_id, expected_bytes, actual_bytes, state,
             created_at, last_touched_at, expires_at, last_error_code
           FROM agent_local_storage_resources`,
        );
        return rows.map(toPersistenceRow);
      },
      async replace(records) {
        await exec(database, 'BEGIN IMMEDIATE;');
        try {
          await run(database, 'DELETE FROM agent_local_storage_resources');
          for (const record of records) {
            await run(
              database,
              `INSERT INTO agent_local_storage_resources (
                 id, backend_scope, account_scope, adapter_id, resource_ref,
                 category, run_id, expected_bytes, actual_bytes, state,
                 created_at, last_touched_at, expires_at, last_error_code
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                record.id,
                record.backendScope,
                record.accountScope,
                record.adapterId,
                record.resourceRef ?? null,
                record.category,
                record.runId,
                record.expectedBytes,
                record.actualBytes,
                record.state,
                record.createdAt,
                record.lastTouchedAt,
                record.expiresAt,
                record.lastErrorCode ?? null,
              ],
            );
          }
          await exec(database, 'COMMIT;');
        } catch (error) {
          await exec(database, 'ROLLBACK;').catch(() => undefined);
          throw error;
        }
      },
      async close() {
        await close(database);
      },
    };
  } catch (error) {
    await close(database).catch(() => undefined);
    throw error;
  }
}

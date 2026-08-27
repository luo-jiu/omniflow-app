import sqlite3 from 'sqlite3';

import { agentDatabaseSchemaCoordinator } from '../storage/agent-database-schema-coordinator';
import type {
  AgentShellWorkspaceOwner,
  AgentShellWorkspacePersistedRecord,
  AgentShellWorkspacePersistence,
} from './agent-shell-workspace-store';

const COMPONENT = 'shell-workspace';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_shell_workspaces (
    workspace_id TEXT PRIMARY KEY,
    backend_scope TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    quota_resource_ref TEXT NOT NULL UNIQUE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'deleting')),
    manifest_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS agent_shell_workspaces_owner_idx
    ON agent_shell_workspaces (backend_scope, account_scope, session_id, status);
`;

interface WorkspaceRow {
  workspace_id: string;
  backend_scope: string;
  account_scope: string;
  session_id: string;
  run_id: string;
  quota_resource_ref: string;
  generation: number;
  status: 'active' | 'deleting';
  manifest_json: string;
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

function parseManifest(row: WorkspaceRow): AgentShellWorkspacePersistedRecord['manifest'] {
  let value: unknown;
  try {
    value = JSON.parse(row.manifest_json);
  } catch {
    throw new Error(`Agent workspace ${row.workspace_id} manifest 损坏`);
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Agent workspace ${row.workspace_id} manifest 无效`);
  }
  return value as AgentShellWorkspacePersistedRecord['manifest'];
}

function toPersistenceRecord(row: WorkspaceRow): AgentShellWorkspacePersistedRecord {
  const owner: AgentShellWorkspaceOwner = {
    accountScope: row.account_scope,
    backendScope: row.backend_scope,
    sessionId: row.session_id,
  };
  return {
    generation: row.generation,
    manifest: parseManifest(row),
    owner,
    quotaResourceRef: row.quota_resource_ref,
    runId: row.run_id,
    status: row.status,
    workspaceId: row.workspace_id,
  };
}

export async function initializeAgentShellWorkspaceDatabaseSchema(
  database: sqlite3.Database,
): Promise<void> {
  await exec(database, SCHEMA);
}

export async function createSQLiteAgentShellWorkspacePersistence(
  databasePath: string,
): Promise<AgentShellWorkspacePersistence> {
  const database = await openDatabase(databasePath);
  try {
    await exec(database, 'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    await agentDatabaseSchemaCoordinator.ensureReady(
      databasePath,
      COMPONENT,
      () => initializeAgentShellWorkspaceDatabaseSchema(database),
      database,
    );

    return {
      async load() {
        const rows = await all<WorkspaceRow>(
          database,
          `SELECT workspace_id, backend_scope, account_scope, session_id,
             run_id, quota_resource_ref, generation, status, manifest_json
           FROM agent_shell_workspaces`,
        );
        return rows.map(toPersistenceRecord);
      },
      async replace(records) {
        await exec(database, 'BEGIN IMMEDIATE;');
        try {
          await run(database, 'DELETE FROM agent_shell_workspaces');
          for (const record of records) {
            await run(
              database,
              `INSERT INTO agent_shell_workspaces (
                 workspace_id, backend_scope, account_scope, session_id,
                 run_id, quota_resource_ref, generation, status, manifest_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                record.workspaceId,
                record.owner.backendScope,
                record.owner.accountScope,
                record.owner.sessionId,
                record.runId,
                record.quotaResourceRef,
                record.generation,
                record.status,
                JSON.stringify(record.manifest),
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

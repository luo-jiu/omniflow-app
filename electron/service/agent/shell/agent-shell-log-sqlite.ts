import sqlite3 from 'sqlite3';

import { agentDatabaseSchemaCoordinator } from '../storage/agent-database-schema-coordinator';
import type {
  AgentShellLogPersistedRecord,
  AgentShellLogPersistence,
} from './agent-shell-log-store';

const COMPONENT = 'shell-log';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_shell_logs (
    log_ref TEXT PRIMARY KEY,
    backend_scope TEXT NOT NULL,
    account_scope TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_run_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    detailed_bytes INTEGER NOT NULL CHECK (detailed_bytes >= 0),
    detailed_frames_json TEXT NOT NULL,
    detailed_frame_refs_json TEXT NOT NULL,
    dropped_detailed_bytes INTEGER NOT NULL CHECK (dropped_detailed_bytes >= 0),
    expires_at INTEGER NOT NULL,
    expired INTEGER NOT NULL CHECK (expired IN (0, 1)),
    finished INTEGER NOT NULL CHECK (finished IN (0, 1)),
    generation INTEGER NOT NULL CHECK (generation > 0),
    last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
    tail_bytes INTEGER NOT NULL CHECK (tail_bytes >= 0),
    tail_frames_json TEXT NOT NULL,
    truncated_before INTEGER CHECK (truncated_before IS NULL OR truncated_before > 0)
  );

  CREATE INDEX IF NOT EXISTS agent_shell_logs_owner_idx
    ON agent_shell_logs (backend_scope, account_scope, session_id, expires_at);
`;

interface LogRow {
  log_ref: string;
  backend_scope: string;
  account_scope: string;
  session_id: string;
  run_id: string;
  tool_run_id: string;
  execution_id: string;
  created_at: number;
  detailed_bytes: number;
  detailed_frames_json: string;
  detailed_frame_refs_json: string;
  dropped_detailed_bytes: number;
  expires_at: number;
  expired: 0 | 1;
  finished: 0 | 1;
  generation: number;
  last_sequence: number;
  tail_bytes: number;
  tail_frames_json: string;
  truncated_before: number | null;
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

function parseJson<T>(value: string, logRef: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Agent Shell 日志 ${logRef} ${label}损坏`);
  }
}

function toPersistenceRecord(row: LogRow): AgentShellLogPersistedRecord {
  const parsedDetailedFrames = parseJson<unknown>(
    row.detailed_frames_json,
    row.log_ref,
    '详细 frame',
  );
  const parsedDetailedFrameRefs = parseJson<unknown>(
    row.detailed_frame_refs_json,
    row.log_ref,
    '详细 frame 索引',
  );
  if (!Array.isArray(parsedDetailedFrames) || !Array.isArray(parsedDetailedFrameRefs)) {
    throw new Error(`Agent Shell 日志 ${row.log_ref} 详细内容不是数组`);
  }
  const detailedFrames = parsedDetailedFrames as NonNullable<AgentShellLogPersistedRecord['detailedFrames']>;
  const detailedFrameRefs = parsedDetailedFrameRefs as NonNullable<AgentShellLogPersistedRecord['detailedFrameRefs']>;
  const tailFrames = parseJson<AgentShellLogPersistedRecord['tailFrames']>(
    row.tail_frames_json,
    row.log_ref,
    'tail frame',
  );
  return {
    createdAt: row.created_at,
    detailedBytes: row.detailed_bytes,
    ...(detailedFrames.length > 0 ? { detailedFrames } : {}),
    ...(detailedFrameRefs.length > 0 ? { detailedFrameRefs } : {}),
    droppedDetailedBytes: row.dropped_detailed_bytes,
    executionId: row.execution_id,
    expired: row.expired === 1,
    expiresAt: row.expires_at,
    finished: row.finished === 1,
    generation: row.generation,
    lastSequence: row.last_sequence,
    logRef: row.log_ref,
    owner: {
      accountScope: row.account_scope,
      backendScope: row.backend_scope,
      sessionId: row.session_id,
    },
    runId: row.run_id,
    sessionId: row.session_id,
    tailBytes: row.tail_bytes,
    tailFrames,
    toolRunId: row.tool_run_id,
    truncatedBefore: row.truncated_before,
  };
}

export async function initializeAgentShellLogDatabaseSchema(
  database: sqlite3.Database,
): Promise<void> {
  await exec(database, SCHEMA);
}

export async function createSQLiteAgentShellLogPersistence(
  databasePath: string,
): Promise<AgentShellLogPersistence> {
  const database = await openDatabase(databasePath);
  try {
    await exec(database, 'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    await agentDatabaseSchemaCoordinator.ensureReady(
      databasePath,
      COMPONENT,
      () => initializeAgentShellLogDatabaseSchema(database),
      database,
    );

    return {
      async load() {
        const rows = await all<LogRow>(database, `
          SELECT log_ref, backend_scope, account_scope, session_id,
                 run_id, tool_run_id, execution_id, created_at,
                 detailed_bytes, detailed_frames_json, detailed_frame_refs_json,
                 dropped_detailed_bytes, expires_at, expired, finished,
                 generation, last_sequence, tail_bytes, tail_frames_json,
                 truncated_before
          FROM agent_shell_logs
        `);
        return rows.map(toPersistenceRecord);
      },
      async replace(records) {
        await exec(database, 'BEGIN IMMEDIATE;');
        try {
          await run(database, 'DELETE FROM agent_shell_logs');
          for (const record of records) {
            await run(
              database,
              `INSERT INTO agent_shell_logs (
                log_ref, backend_scope, account_scope, session_id,
                run_id, tool_run_id, execution_id, created_at,
                detailed_bytes, detailed_frames_json, detailed_frame_refs_json,
                dropped_detailed_bytes, expires_at, expired, finished,
                generation, last_sequence, tail_bytes, tail_frames_json,
                truncated_before
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                record.logRef,
                record.owner.backendScope,
                record.owner.accountScope,
                record.owner.sessionId,
                record.runId,
                record.toolRunId,
                record.executionId,
                record.createdAt,
                record.detailedBytes,
                JSON.stringify(record.detailedFrames || []),
                JSON.stringify(record.detailedFrameRefs || []),
                record.droppedDetailedBytes,
                record.expiresAt,
                record.expired ? 1 : 0,
                record.finished ? 1 : 0,
                record.generation,
                record.lastSequence,
                record.tailBytes,
                JSON.stringify(record.tailFrames),
                record.truncatedBefore,
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

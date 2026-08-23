import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentMessage,
  AgentOwnerScope,
  AgentReasoningEffort,
  AgentRunStatus,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolApprovalSnapshot,
  AgentToolCallSnapshot,
  AgentToolResult,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';

const AGENT_SESSION_SCHEMA_VERSION = 2;
const INTERMEDIATE_APPROVAL_SCHEMA_VERSION = 3;
const MAX_SESSION_TITLE_LENGTH = 80;
const MAX_SEARCH_LENGTH = 120;
const SESSION_PAGE_SIZE = 50;

const TOOL_APPROVAL_COLUMNS = [
  ['permission_behavior', "TEXT NOT NULL DEFAULT 'allow'"],
  ['approval_id', 'TEXT'],
  ['approval_input_hash', 'TEXT'],
  ['approval_preview_json', 'TEXT'],
  ['approval_status', 'TEXT'],
  ['approval_decided_at', 'TEXT'],
] as const;

interface SessionRow {
  created_at: string;
  id: string;
  last_message_preview: string;
  last_run_status: AgentRunStatus | null;
  library_id: number;
  message_count: number;
  title: string;
  updated_at: string;
}

interface MessageRow {
  content: string;
  created_at: string;
  id: string;
  role: AgentMessage['role'];
  run_id: string | null;
  session_id: string;
  tool_call_id: string | null;
  tool_name: string | null;
}

interface ToolApprovalRow {
  approval_id: string;
  approval_preview_json: string;
  call_id: string;
  input_json: string;
  run_id: string;
  session_id: string;
  tool_name: string;
}

interface RunStatementResult {
  changes: number;
  lastID: number;
}

export interface CreateAgentSessionInput {
  appContext: AgentAppContext;
  id: string;
  now: string;
  ownerScope: AgentOwnerScope;
  title: string;
}

export interface CreateAgentRunInput {
  id: string;
  model: string;
  now: string;
  profileId: string;
  reasoningEffort: AgentReasoningEffort;
  sessionId: string;
  userPrompt: string;
}

export interface AgentRunUpdate {
  currentStep?: string;
  error?: string;
  finishedAt?: string;
  status: AgentRunStatus;
  updatedAt: string;
}

export interface CreateAgentToolRunInput {
  approvalId?: string;
  approvalInputHash?: string;
  approvalPreview?: AgentActionPreview;
  callId: string;
  id: string;
  input: unknown;
  now: string;
  permissionBehavior: 'allow' | 'ask' | 'deny';
  runId: string;
  status: 'awaiting_approval' | 'running';
  toolName: string;
}

export interface AgentSessionStore {
  appendMessage: (message: AgentMessage) => Promise<void>;
  close: () => Promise<void>;
  completeToolRun: (
    id: string,
    result: AgentToolResult,
    now: string,
  ) => Promise<void>;
  createRun: (input: CreateAgentRunInput) => Promise<void>;
  createSession: (input: CreateAgentSessionInput) => Promise<AgentSessionSnapshot>;
  createToolRun: (input: CreateAgentToolRunInput) => Promise<void>;
  deleteSession: (
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ) => Promise<boolean>;
  getSession: (
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ) => Promise<AgentSessionSnapshot | null>;
  listSessions: (
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query?: string,
    cursor?: AgentSessionCursor,
  ) => Promise<AgentSessionPage>;
  renameSession: (
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    title: string,
    now: string,
  ) => Promise<AgentSessionSummary>;
  resolveToolApproval: (
    approvalId: string,
    resolution: 'approved' | 'denied' | 'expired' | 'cancelled',
    now: string,
  ) => Promise<void>;
  updateRun: (runId: string, update: AgentRunUpdate) => Promise<void>;
  updateSessionContext: (
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
    appContext: AgentAppContext,
    now: string,
  ) => Promise<void>;
}

function openDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(
      databasePath,
      sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
      error => error ? reject(error) : resolve(database),
    );
  });
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function run(
  database: sqlite3.Database,
  sql: string,
  parameters: unknown[] = [],
): Promise<RunStatementResult> {
  return new Promise((resolve, reject) => {
    database.run(sql, parameters, function onRun(error) {
      if (error) reject(error);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get<T>(
  database: sqlite3.Database,
  sql: string,
  parameters: unknown[] = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get<T>(sql, parameters, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all<T>(
  database: sqlite3.Database,
  sql: string,
  parameters: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

function normalizeLibraryId(value: unknown): number {
  const libraryId = Number(value);
  if (!Number.isFinite(libraryId) || libraryId <= 0) {
    throw new Error('Agent 会话缺少有效的资料库');
  }
  return libraryId;
}

function normalizeSessionTitle(value: unknown): string {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('Agent 会话标题不能为空');
  return title.slice(0, MAX_SESSION_TITLE_LENGTH);
}

function normalizeSessionCursor(value: AgentSessionCursor | undefined): AgentSessionCursor | null {
  if (!value) return null;
  const id = String(value.id || '').trim();
  const updatedAt = String(value.updatedAt || '').trim();
  if (!id || id.length > 200 || !updatedAt || updatedAt.length > 100) {
    throw new Error('Agent 会话分页游标无效');
  }
  return { id, updatedAt };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function toSessionSummary(row: SessionRow): AgentSessionSummary {
  return {
    createdAt: row.created_at,
    id: row.id,
    lastMessagePreview: row.last_message_preview,
    ...(row.last_run_status ? { lastRunStatus: row.last_run_status } : {}),
    libraryId: Number(row.library_id),
    messageCount: Number(row.message_count),
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): AgentMessage {
  return {
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    role: row.role,
    ...(row.run_id ? { runId: row.run_id } : {}),
    sessionId: row.session_id,
    ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
    ...(row.tool_name ? { toolName: row.tool_name } : {}),
  };
}

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toPendingApproval(row: ToolApprovalRow): AgentToolApprovalSnapshot {
  const call: AgentToolCallSnapshot = {
    id: row.call_id,
    input: parseStoredJson(row.input_json, {}),
    name: row.tool_name,
  };
  return {
    approvalId: row.approval_id,
    call,
    preview: parseStoredJson<AgentActionPreview>(row.approval_preview_json, {
      description: `工具 ${row.tool_name} 正在等待确认`,
      risk: 'write',
      title: '确认操作',
    }),
    runId: row.run_id,
    sessionId: row.session_id,
  };
}

const SESSION_SELECT = `
  SELECT
    sessions.id,
    sessions.library_id,
    sessions.title,
    sessions.last_message_preview,
    sessions.created_at,
    sessions.updated_at,
    COUNT(messages.id) AS message_count,
    (
      SELECT runs.status
      FROM agent_runs AS runs
      WHERE runs.session_id = sessions.id
      ORDER BY runs.created_at DESC, runs.rowid DESC
      LIMIT 1
    ) AS last_run_status
  FROM agent_sessions AS sessions
  LEFT JOIN agent_messages AS messages ON messages.session_id = sessions.id
`;

async function ensureToolApprovalColumns(database: sqlite3.Database): Promise<void> {
  const existingColumns = new Set(
    (await all<{ name: string }>(database, 'PRAGMA table_info(agent_tool_runs)'))
      .map(column => column.name),
  );
  for (const [name, definition] of TOOL_APPROVAL_COLUMNS) {
    if (!existingColumns.has(name)) {
      await exec(database, `ALTER TABLE agent_tool_runs ADD COLUMN ${name} ${definition}`);
    }
  }
  await exec(database, `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_runs_approval_idx
      ON agent_tool_runs (approval_id)
      WHERE approval_id IS NOT NULL;
  `);
}

async function isKnownIntermediateApprovalSchema(database: sqlite3.Database): Promise<boolean> {
  const requiredTables = new Set([
    'agent_messages',
    'agent_runs',
    'agent_sessions',
    'agent_tool_runs',
  ]);
  const tables = await all<{ name: string }>(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
  `);
  for (const table of tables) requiredTables.delete(table.name);
  if (requiredTables.size > 0) return false;

  const toolRunColumns = new Set(
    (await all<{ name: string }>(database, 'PRAGMA table_info(agent_tool_runs)'))
      .map(column => column.name),
  );
  return TOOL_APPROVAL_COLUMNS.every(([name]) => toolRunColumns.has(name));
}

async function initializeDatabase(database: sqlite3.Database): Promise<void> {
  await exec(database, `
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);

  const versionRow = await get<{ user_version: number }>(database, 'PRAGMA user_version');
  let schemaVersion = Number(versionRow?.user_version || 0);
  if (schemaVersion === INTERMEDIATE_APPROVAL_SCHEMA_VERSION) {
    if (!(await isKnownIntermediateApprovalSchema(database))) {
      throw new Error(`Agent 会话数据库版本过新且结构无法识别：${schemaVersion}`);
    }
    await exec(database, `PRAGMA user_version = ${AGENT_SESSION_SCHEMA_VERSION}`);
    schemaVersion = AGENT_SESSION_SCHEMA_VERSION;
  }
  if (schemaVersion > AGENT_SESSION_SCHEMA_VERSION) {
    throw new Error(`Agent 会话数据库版本过新：${schemaVersion}`);
  }

  if (schemaVersion === 0) {
    await exec(database, `
      BEGIN IMMEDIATE;

      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        backend_scope TEXT NOT NULL,
        account_scope TEXT NOT NULL,
        library_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        context_json TEXT NOT NULL,
        last_message_preview TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX agent_sessions_owner_library_updated_idx
        ON agent_sessions (
          backend_scope,
          account_scope,
          library_id,
          archived_at,
          updated_at DESC,
          id DESC
        );

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        user_prompt TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        current_step TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX agent_runs_session_created_idx
        ON agent_runs (session_id, created_at DESC);

      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (session_id, sequence)
      );

      CREATE INDEX agent_messages_session_sequence_idx
        ON agent_messages (session_id, sequence);

      CREATE TABLE agent_tool_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        result_json TEXT,
        status TEXT NOT NULL,
        permission_behavior TEXT NOT NULL DEFAULT 'allow',
        approval_id TEXT,
        approval_input_hash TEXT,
        approval_preview_json TEXT,
        approval_status TEXT,
        approval_decided_at TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        UNIQUE (run_id, call_id)
      );

      CREATE UNIQUE INDEX agent_tool_runs_approval_idx
        ON agent_tool_runs (approval_id)
        WHERE approval_id IS NOT NULL;

      CREATE TRIGGER agent_runs_create_user_message
      AFTER INSERT ON agent_runs
      BEGIN
        INSERT INTO agent_messages (
          id, session_id, run_id, sequence, role, content, created_at
        )
        SELECT
          NEW.id || ':user',
          NEW.session_id,
          NEW.id,
          COALESCE(MAX(sequence), 0) + 1,
          'user',
          NEW.user_prompt,
          NEW.created_at
        FROM agent_messages
        WHERE session_id = NEW.session_id;
      END;

      CREATE TRIGGER agent_messages_update_session
      AFTER INSERT ON agent_messages
      BEGIN
        UPDATE agent_sessions
        SET
          last_message_preview = substr(replace(replace(NEW.content, char(10), ' '), char(13), ' '), 1, 180),
          updated_at = NEW.created_at
        WHERE id = NEW.session_id;
      END;

      PRAGMA user_version = ${AGENT_SESSION_SCHEMA_VERSION};
      COMMIT;
    `);
  } else if (schemaVersion === 1) {
    await exec(database, `
      BEGIN IMMEDIATE;
      ALTER TABLE agent_sessions
        ADD COLUMN backend_scope TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE agent_sessions
        ADD COLUMN account_scope TEXT NOT NULL DEFAULT 'legacy';
      DROP INDEX IF EXISTS agent_sessions_library_updated_idx;
      CREATE INDEX agent_sessions_owner_library_updated_idx
        ON agent_sessions (
          backend_scope,
          account_scope,
          library_id,
          archived_at,
          updated_at DESC,
          id DESC
        );
      PRAGMA user_version = ${AGENT_SESSION_SCHEMA_VERSION};
      COMMIT;
    `);
  }

  await ensureToolApprovalColumns(database);

  const recoveredAt = new Date().toISOString();
  await run(database, `
    UPDATE agent_runs
    SET
      status = 'interrupted',
      current_step = '上次运行已中断',
      error = '应用退出时任务仍在运行，可重新发送上一条消息',
      updated_at = ?,
      finished_at = ?
    WHERE status IN ('running', 'awaiting_approval')
  `, [recoveredAt, recoveredAt]);
  await run(database, `
    UPDATE agent_tool_runs
    SET
      status = 'interrupted',
      result_json = ?,
      approval_status = CASE
        WHEN approval_status = 'pending' THEN 'interrupted'
        ELSE approval_status
      END,
      finished_at = ?
    WHERE status IN ('running', 'awaiting_approval')
  `, [JSON.stringify({ message: '应用退出时 Agent Tool 仍在运行', ok: false }), recoveredAt]);
}

export async function createSQLiteAgentSessionStore(
  databasePath: string,
): Promise<AgentSessionStore> {
  if (databasePath !== ':memory:') {
    await mkdir(path.dirname(databasePath), { recursive: true });
  }
  const database = await openDatabase(databasePath);
  try {
    await initializeDatabase(database);
  } catch (error) {
    await close(database).catch(() => undefined);
    throw error;
  }

  async function readSummary(
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<AgentSessionSummary | null> {
    const scope = normalizeAgentOwnerScope(ownerScope);
    const row = await get<SessionRow>(database, `${SESSION_SELECT}
      WHERE sessions.id = ?
        AND sessions.backend_scope = ?
        AND sessions.account_scope = ?
        AND sessions.library_id = ?
        AND sessions.archived_at IS NULL
      GROUP BY sessions.id
    `, [
      sessionId,
      scope.backendScope,
      scope.accountScope,
      normalizeLibraryId(libraryId),
    ]);
    return row ? toSessionSummary(row) : null;
  }

  return {
    async appendMessage(message) {
      await run(database, `
        INSERT INTO agent_messages (
          id, session_id, run_id, sequence, role, content, tool_call_id, tool_name, created_at
        )
        SELECT ?, ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?, ?
        FROM agent_messages
        WHERE session_id = ?
      `, [
        message.id,
        message.sessionId,
        message.runId || null,
        message.role,
        message.content,
        message.toolCallId || null,
        message.toolName || null,
        message.createdAt,
        message.sessionId,
      ]);
    },

    async close() {
      await close(database);
    },

    async completeToolRun(id, result, now) {
      const update = await run(database, `
        UPDATE agent_tool_runs
        SET result_json = ?, status = ?, finished_at = ?
        WHERE id = ?
      `, [JSON.stringify(result), result.ok ? 'completed' : 'failed', now, id]);
      if (update.changes === 0) throw new Error('Agent Tool 运行记录不存在');
    },

    async createRun(input) {
      await run(database, `
        INSERT INTO agent_runs (
          id, session_id, status, user_prompt, profile_id, model, reasoning_effort,
          current_step, created_at, updated_at
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, '请求 AI 服务', ?, ?)
      `, [
        input.id,
        input.sessionId,
        input.userPrompt,
        input.profileId,
        input.model,
        input.reasoningEffort,
        input.now,
        input.now,
      ]);
    },

    async createSession(input) {
      const libraryId = normalizeLibraryId(input.appContext.libraryId);
      const ownerScope = normalizeAgentOwnerScope(input.ownerScope);
      await run(database, `
        INSERT INTO agent_sessions (
          id, backend_scope, account_scope, library_id, title, context_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.id,
        ownerScope.backendScope,
        ownerScope.accountScope,
        libraryId,
        normalizeSessionTitle(input.title),
        JSON.stringify(input.appContext),
        input.now,
        input.now,
      ]);
      const created = await readSummary(input.id, ownerScope, libraryId);
      if (!created) throw new Error('Agent 会话创建失败');
      return { ...created, messages: [], pendingApprovals: [] };
    },

    async createToolRun(input) {
      await run(database, `
        INSERT INTO agent_tool_runs (
          id, run_id, call_id, tool_name, input_json, status,
          permission_behavior, approval_id, approval_input_hash,
          approval_preview_json, approval_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        input.id,
        input.runId,
        input.callId,
        input.toolName,
        JSON.stringify(input.input),
        input.status,
        input.permissionBehavior,
        input.approvalId || null,
        input.approvalInputHash || null,
        input.approvalPreview ? JSON.stringify(input.approvalPreview) : null,
        input.permissionBehavior === 'ask' ? 'pending' : null,
        input.now,
      ]);
    },

    async deleteSession(sessionId, ownerScope, libraryId) {
      const scope = normalizeAgentOwnerScope(ownerScope);
      const result = await run(database, `
        DELETE FROM agent_sessions
        WHERE id = ? AND backend_scope = ? AND account_scope = ? AND library_id = ?
      `, [
        sessionId,
        scope.backendScope,
        scope.accountScope,
        normalizeLibraryId(libraryId),
      ]);
      return result.changes > 0;
    },

    async getSession(sessionId, ownerScope, libraryId) {
      const summary = await readSummary(sessionId, ownerScope, libraryId);
      if (!summary) return null;
      const rows = await all<MessageRow>(database, `
        SELECT id, session_id, run_id, role, content, tool_call_id, tool_name, created_at
        FROM agent_messages
        WHERE session_id = ?
        ORDER BY sequence ASC
      `, [sessionId]);
      const approvalRows = await all<ToolApprovalRow>(database, `
        SELECT
          tools.approval_id,
          tools.approval_preview_json,
          tools.call_id,
          tools.input_json,
          tools.run_id,
          runs.session_id,
          tools.tool_name
        FROM agent_tool_runs AS tools
        JOIN agent_runs AS runs ON runs.id = tools.run_id
        WHERE runs.session_id = ?
          AND tools.status = 'awaiting_approval'
          AND tools.approval_status = 'pending'
          AND tools.approval_id IS NOT NULL
          AND tools.approval_preview_json IS NOT NULL
        ORDER BY tools.created_at ASC, tools.rowid ASC
      `, [sessionId]);
      return {
        ...summary,
        messages: rows.map(toMessage),
        pendingApprovals: approvalRows.map(toPendingApproval),
      };
    },

    async listSessions(ownerScope, libraryId, query = '', cursorInput) {
      const scope = normalizeAgentOwnerScope(ownerScope);
      const normalizedLibraryId = normalizeLibraryId(libraryId);
      const normalizedQuery = String(query || '').trim().slice(0, MAX_SEARCH_LENGTH);
      const searchPattern = `%${escapeLikePattern(normalizedQuery)}%`;
      const cursor = normalizeSessionCursor(cursorInput);
      const cursorClause = cursor
        ? 'AND (sessions.updated_at < ? OR (sessions.updated_at = ? AND sessions.id < ?))'
        : '';
      const rows = await all<SessionRow>(database, `${SESSION_SELECT}
        WHERE sessions.backend_scope = ?
          AND sessions.account_scope = ?
          AND sessions.library_id = ?
          AND sessions.archived_at IS NULL
          AND (? = '' OR sessions.title LIKE ? ESCAPE '\\' OR sessions.last_message_preview LIKE ? ESCAPE '\\')
          ${cursorClause}
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC, sessions.id DESC
        LIMIT ${SESSION_PAGE_SIZE + 1}
      `, [
        scope.backendScope,
        scope.accountScope,
        normalizedLibraryId,
        normalizedQuery,
        searchPattern,
        searchPattern,
        ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.id] : []),
      ]);
      const totalRow = await get<{ total: number }>(database, `
        SELECT COUNT(*) AS total
        FROM agent_sessions
        WHERE backend_scope = ?
          AND account_scope = ?
          AND library_id = ?
          AND archived_at IS NULL
          AND (? = '' OR title LIKE ? ESCAPE '\\' OR last_message_preview LIKE ? ESCAPE '\\')
      `, [
        scope.backendScope,
        scope.accountScope,
        normalizedLibraryId,
        normalizedQuery,
        searchPattern,
        searchPattern,
      ]);
      const hasMore = rows.length > SESSION_PAGE_SIZE;
      const sessions = rows.slice(0, SESSION_PAGE_SIZE).map(toSessionSummary);
      const lastSession = sessions.at(-1);
      return {
        ...(hasMore && lastSession
          ? { nextCursor: { id: lastSession.id, updatedAt: lastSession.updatedAt } }
          : {}),
        sessions,
        total: Number(totalRow?.total || 0),
      };
    },

    async renameSession(sessionId, ownerScope, libraryId, title, now) {
      const scope = normalizeAgentOwnerScope(ownerScope);
      const result = await run(database, `
        UPDATE agent_sessions
        SET title = ?, updated_at = ?
        WHERE id = ?
          AND backend_scope = ?
          AND account_scope = ?
          AND library_id = ?
          AND archived_at IS NULL
      `, [
        normalizeSessionTitle(title),
        now,
        sessionId,
        scope.backendScope,
        scope.accountScope,
        normalizeLibraryId(libraryId),
      ]);
      if (result.changes === 0) throw new Error('Agent 会话不存在');
      const updated = await readSummary(sessionId, scope, libraryId);
      if (!updated) throw new Error('Agent 会话不存在');
      return updated;
    },

    async resolveToolApproval(approvalId, resolution, now) {
      const approved = resolution === 'approved';
      const result = await run(database, `
        UPDATE agent_tool_runs
        SET
          approval_status = ?,
          approval_decided_at = ?,
          status = ?
        WHERE approval_id = ?
          AND status = 'awaiting_approval'
          AND approval_status = 'pending'
      `, [
        resolution,
        now,
        approved ? 'running' : 'failed',
        approvalId,
      ]);
      if (result.changes === 0) throw new Error('Agent 确认请求不存在或已经处理');
    },

    async updateRun(runId, update) {
      const result = await run(database, `
        UPDATE agent_runs
        SET status = ?, current_step = ?, error = ?, updated_at = ?, finished_at = ?
        WHERE id = ?
      `, [
        update.status,
        update.currentStep || null,
        update.error || null,
        update.updatedAt,
        update.finishedAt || null,
        runId,
      ]);
      if (result.changes === 0) throw new Error('Agent 运行记录不存在');
    },

    async updateSessionContext(sessionId, ownerScope, libraryId, appContext, now) {
      const scope = normalizeAgentOwnerScope(ownerScope);
      const result = await run(database, `
        UPDATE agent_sessions
        SET context_json = ?, updated_at = ?
        WHERE id = ?
          AND backend_scope = ?
          AND account_scope = ?
          AND library_id = ?
          AND archived_at IS NULL
      `, [
        JSON.stringify(appContext),
        now,
        sessionId,
        scope.backendScope,
        scope.accountScope,
        normalizeLibraryId(libraryId),
      ]);
      if (result.changes === 0) throw new Error('Agent 会话不存在');
    },
  };
}

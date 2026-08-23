import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';

import type {
  AgentActionPreview,
  AgentAppContext,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentInteractionStatus,
  AgentMessage,
  AgentOwnerScope,
  AgentReasoningEffort,
  AgentRunPlanSnapshot,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentSessionCursor,
  AgentSessionPage,
  AgentSessionSnapshot,
  AgentSessionSummary,
  AgentToolApprovalStatus,
  AgentToolActivitySnapshot,
  AgentToolActivityStatus,
  AgentToolResult,
  AgentToolProgress,
} from '@/shared/agent/agent.types';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import {
  normalizeAgentInteractionRequest,
  normalizeAgentInteractionResponse,
} from './agent-interaction-model';
import {
  parseAgentConversationSummary,
  serializeAgentConversationSummary,
} from './agent-conversation-summary';
import { parseStoredAgentRunPlan } from './agent-plan-model';

const AGENT_SESSION_SCHEMA_VERSION = 2;
const INTERMEDIATE_APPROVAL_SCHEMA_VERSION = 3;
const MAX_SESSION_TITLE_LENGTH = 80;
const MAX_SEARCH_LENGTH = 120;
const SESSION_PAGE_SIZE = 50;
const MAX_CONTEXT_CHECKPOINT_ID_LENGTH = 200;
const MAX_CONTEXT_CHECKPOINT_PROFILE_ID_LENGTH = 200;
const MAX_CONTEXT_CHECKPOINT_MODEL_LENGTH = 500;
const MAX_CONTEXT_CHECKPOINT_SUMMARY_BYTES = 64 * 1024;

const TOOL_APPROVAL_COLUMNS = [
  ['permission_behavior', "TEXT NOT NULL DEFAULT 'allow'"],
  ['approval_id', 'TEXT'],
  ['approval_input_hash', 'TEXT'],
  ['approval_preview_json', 'TEXT'],
  ['approval_status', 'TEXT'],
  ['approval_decided_at', 'TEXT'],
] as const;

const TOOL_PROGRESS_COLUMNS = [
  ['progress_json', 'TEXT'],
  ['progress_updated_at', 'TEXT'],
] as const;

const TOOL_INTERACTION_COLUMNS = [
  ['interaction_id', 'TEXT'],
  ['interaction_request_json', 'TEXT'],
  ['interaction_status', 'TEXT'],
  ['interaction_response_json', 'TEXT'],
  ['interaction_decided_at', 'TEXT'],
] as const;

const TOOL_RUNTIME_COLUMNS = [
  ['ordinal', 'INTEGER NOT NULL DEFAULT 0'],
  ['plan_step_id', 'TEXT'],
  ['revision', 'INTEGER NOT NULL DEFAULT 1'],
] as const;

const RUN_RUNTIME_COLUMNS = [
  ['plan_json', 'TEXT'],
  ['revision', 'INTEGER NOT NULL DEFAULT 1'],
] as const;

const CONTEXT_CHECKPOINT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_context_checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    base_checkpoint_id TEXT REFERENCES agent_context_checkpoints(id) ON DELETE CASCADE,
    through_message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
    through_sequence INTEGER NOT NULL CHECK (through_sequence > 0),
    status TEXT NOT NULL CHECK (
      status IN ('started', 'completed', 'failed', 'interrupted')
    ),
    summary_json TEXT,
    profile_id TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    CHECK (
      (status = 'started' AND summary_json IS NULL AND finished_at IS NULL)
      OR (
        status = 'completed'
        AND summary_json IS NOT NULL
        AND finished_at IS NOT NULL
        AND json_valid(summary_json) = 1
        AND json_type(summary_json) <> 'null'
        AND NOT (
          json_type(summary_json) = 'text'
          AND trim(json_extract(summary_json, '$')) = ''
        )
        AND length(CAST(summary_json AS BLOB)) <= ${MAX_CONTEXT_CHECKPOINT_SUMMARY_BYTES}
      )
      OR (
        status IN ('failed', 'interrupted')
        AND summary_json IS NULL
        AND finished_at IS NOT NULL
      )
    )
  );
`;

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

interface RunRow {
  created_at: string;
  current_step: string | null;
  error: string | null;
  finished_at: string | null;
  id: string;
  model: string;
  plan_json: string | null;
  profile_id: string;
  reasoning_effort: AgentReasoningEffort;
  revision: number;
  session_id: string;
  status: AgentRunStatus;
  updated_at: string;
  user_prompt: string;
}

interface ToolActivityRow {
  approval_decided_at: string | null;
  approval_id: string | null;
  approval_preview_json: string | null;
  approval_status: AgentToolApprovalStatus | null;
  call_id: string;
  created_at: string;
  finished_at: string | null;
  id: string;
  input_json: string;
  interaction_decided_at: string | null;
  interaction_id: string | null;
  interaction_request_json: string | null;
  interaction_response_json: string | null;
  interaction_status: AgentInteractionStatus | null;
  ordinal: number;
  permission_behavior: AgentToolActivitySnapshot['permissionBehavior'];
  plan_step_id: string | null;
  progress_json: string | null;
  progress_updated_at: string | null;
  revision: number;
  result_json: string | null;
  run_id: string;
  session_id: string;
  status: AgentToolActivityStatus;
  tool_name: string;
}

interface ContextCheckpointRow {
  base_checkpoint_id: string | null;
  checkpoint_rowid: number;
  created_at: string;
  finished_at: string | null;
  id: string;
  model: string;
  profile_id: string;
  session_id: string;
  status: AgentContextCheckpointStatus;
  summary_json: string | null;
  through_message_id: string;
  through_sequence: number;
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

export type AgentContextCheckpointStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'interrupted';

export interface AgentContextCheckpoint {
  baseCheckpointId?: string;
  createdAt: string;
  finishedAt?: string;
  id: string;
  model: string;
  profileId: string;
  sessionId: string;
  status: AgentContextCheckpointStatus;
  summary?: unknown;
  throughMessageId: string;
  throughSequence: number;
}

export interface AgentContextCheckpointState {
  consecutiveFailureCount: number;
  latestCompleted?: AgentContextCheckpoint;
}

export interface BeginAgentContextCheckpointInput {
  baseCheckpointId?: string;
  id: string;
  libraryId: number;
  model: string;
  now: string;
  ownerScope: AgentOwnerScope;
  profileId: string;
  sessionId: string;
  throughMessageId: string;
}

export interface AgentSessionStore {
  appendMessage: (message: AgentMessage) => Promise<void>;
  beginContextCheckpoint: (
    input: BeginAgentContextCheckpointInput,
  ) => Promise<AgentContextCheckpoint>;
  close: () => Promise<void>;
  completeContextCheckpoint: (
    id: string,
    summary: unknown,
    now: string,
  ) => Promise<AgentContextCheckpoint>;
  completeToolRun: (
    id: string,
    result: AgentToolResult,
    now: string,
    status?: Extract<AgentToolActivityStatus, 'cancelled' | 'completed' | 'failed'>,
  ) => Promise<AgentToolActivitySnapshot>;
  createRun: (input: CreateAgentRunInput) => Promise<AgentRunSnapshot>;
  createSession: (input: CreateAgentSessionInput) => Promise<AgentSessionSnapshot>;
  createToolInteraction: (
    id: string,
    interactionId: string,
    request: AgentInteractionRequest,
  ) => Promise<AgentToolActivitySnapshot>;
  createToolRun: (input: CreateAgentToolRunInput) => Promise<AgentToolActivitySnapshot>;
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
  failContextCheckpoint: (
    id: string,
    now: string,
    status?: Extract<AgentContextCheckpointStatus, 'failed' | 'interrupted'>,
  ) => Promise<AgentContextCheckpoint>;
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
  readContextCheckpointState: (
    sessionId: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ) => Promise<AgentContextCheckpointState | null>;
  setRunPlan: (runId: string, plan: AgentRunPlanSnapshot) => Promise<AgentRunSnapshot>;
  resolveToolApproval: (
    approvalId: string,
    resolution: 'approved' | 'denied' | 'expired' | 'cancelled',
    now: string,
  ) => Promise<AgentToolActivitySnapshot>;
  resolveToolInteraction: (
    interactionId: string,
    resolution: Extract<AgentInteractionStatus, 'submitted' | 'expired' | 'cancelled'>,
    response: AgentInteractionResponse | undefined,
    now: string,
  ) => Promise<AgentToolActivitySnapshot>;
  updateToolRunProgress: (
    id: string,
    progress: AgentToolProgress,
    now: string,
  ) => Promise<AgentToolActivitySnapshot>;
  updateRun: (runId: string, update: AgentRunUpdate) => Promise<AgentRunSnapshot>;
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

function normalizeContextCheckpointText(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Agent 上下文 checkpoint ${fieldName}无效`);
  }
  return normalized;
}

function serializeContextCheckpointSummary(summary: unknown): string {
  if (summary === null || summary === undefined) {
    throw new Error('Agent 上下文 checkpoint 摘要不能为空');
  }
  let serialized: string | undefined;
  try {
    serialized = typeof summary === 'string' ? summary : JSON.stringify(summary);
  } catch {
    throw new Error('Agent 上下文 checkpoint 摘要无法序列化');
  }
  if (!serialized || serialized === 'null') {
    throw new Error('Agent 上下文 checkpoint 摘要不能为空');
  }
  if (!serialized.trim()) {
    throw new Error('Agent 上下文 checkpoint 摘要不能为空');
  }
  let normalized: string;
  try {
    normalized = serializeAgentConversationSummary(parseAgentConversationSummary(serialized));
  } catch (error) {
    throw new Error(`Agent 上下文 checkpoint 摘要不符合 V1 契约：${String(error)}`);
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_CONTEXT_CHECKPOINT_SUMMARY_BYTES) {
    throw new Error('Agent 上下文 checkpoint 摘要过长');
  }
  return normalized;
}

function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted';
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

function toRunSnapshot(row: RunRow): AgentRunSnapshot {
  const plan = parseStoredAgentRunPlan(row.plan_json);
  return {
    createdAt: row.created_at,
    ...(row.current_step ? { currentStep: row.current_step } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    id: row.id,
    model: row.model,
    ...(plan ? { plan } : {}),
    profileId: row.profile_id,
    reasoningEffort: row.reasoning_effort,
    revision: Number(row.revision),
    sessionId: row.session_id,
    status: row.status,
    updatedAt: row.updated_at,
    userPrompt: row.user_prompt,
  };
}

function parseStoredJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function restoreToolInteraction(
  row: ToolActivityRow,
): AgentToolActivitySnapshot['interaction'] | undefined {
  if (!row.interaction_id || !row.interaction_request_json || !row.interaction_status) {
    return undefined;
  }
  if (![
    'pending',
    'submitted',
    'expired',
    'cancelled',
    'interrupted',
  ].includes(row.interaction_status)) return undefined;
  try {
    const request = normalizeAgentInteractionRequest(JSON.parse(row.interaction_request_json));
    const response = row.interaction_response_json
      ? normalizeAgentInteractionResponse(request, JSON.parse(row.interaction_response_json))
      : undefined;
    if ((row.interaction_status === 'submitted') !== Boolean(response)) return undefined;
    return {
      ...(row.interaction_decided_at ? { decidedAt: row.interaction_decided_at } : {}),
      interactionId: row.interaction_id,
      request,
      ...(response ? { response } : {}),
      status: row.interaction_status,
    };
  } catch {
    return undefined;
  }
}

function toToolActivity(row: ToolActivityRow): AgentToolActivitySnapshot {
  const interaction = restoreToolInteraction(row);
  return {
    ...(row.approval_id && row.approval_preview_json && row.approval_status
      ? {
          approval: {
            approvalId: row.approval_id,
            ...(row.approval_decided_at ? { decidedAt: row.approval_decided_at } : {}),
            preview: parseStoredJson<AgentActionPreview>(row.approval_preview_json, {
              description: `工具 ${row.tool_name} 正在等待确认`,
              risk: 'write',
              title: '确认操作',
            }),
            status: row.approval_status,
          },
        }
      : {}),
    call: {
      id: row.call_id,
      input: parseStoredJson(row.input_json, {}),
      name: row.tool_name,
    },
    createdAt: row.created_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    id: row.id,
    ...(interaction ? { interaction } : {}),
    ordinal: Number(row.ordinal),
    permissionBehavior: row.permission_behavior,
    ...(row.plan_step_id ? { planStepId: row.plan_step_id } : {}),
    ...(row.progress_json
      ? { progress: parseStoredJson<AgentToolProgress>(row.progress_json, { message: '' }) }
      : {}),
    ...(row.progress_updated_at ? { progressUpdatedAt: row.progress_updated_at } : {}),
    revision: Number(row.revision),
    ...(row.result_json
      ? { result: parseStoredJson<AgentToolResult>(row.result_json, { ok: false }) }
      : {}),
    runId: row.run_id,
    sessionId: row.session_id,
    status: row.status,
  };
}

function toContextCheckpoint(row: ContextCheckpointRow): AgentContextCheckpoint | null {
  const throughSequence = Number(row.through_sequence);
  if (!Number.isSafeInteger(throughSequence) || throughSequence <= 0) return null;

  let summary: unknown;
  if (row.status === 'completed') {
    if (!row.finished_at || !row.summary_json) return null;
    if (Buffer.byteLength(row.summary_json, 'utf8') > MAX_CONTEXT_CHECKPOINT_SUMMARY_BYTES) {
      return null;
    }
    try {
      summary = parseAgentConversationSummary(row.summary_json);
    } catch {
      return null;
    }
  }

  return {
    ...(row.base_checkpoint_id ? { baseCheckpointId: row.base_checkpoint_id } : {}),
    createdAt: row.created_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    id: row.id,
    model: row.model,
    profileId: row.profile_id,
    sessionId: row.session_id,
    status: row.status,
    ...(row.status === 'completed' ? { summary } : {}),
    throughMessageId: row.through_message_id,
    throughSequence,
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

const CONTEXT_CHECKPOINT_SELECT = `
  SELECT
    checkpoint.rowid AS checkpoint_rowid,
    checkpoint.id,
    checkpoint.session_id,
    checkpoint.base_checkpoint_id,
    checkpoint.through_message_id,
    checkpoint.through_sequence,
    checkpoint.status,
    checkpoint.summary_json,
    checkpoint.profile_id,
    checkpoint.model,
    checkpoint.created_at,
    checkpoint.finished_at
  FROM agent_context_checkpoints AS checkpoint
`;

async function ensureRunColumns(database: sqlite3.Database): Promise<void> {
  const existingColumns = new Set(
    (await all<{ name: string }>(database, 'PRAGMA table_info(agent_runs)'))
      .map(column => column.name),
  );
  for (const [name, definition] of RUN_RUNTIME_COLUMNS) {
    if (!existingColumns.has(name)) {
      await exec(database, `ALTER TABLE agent_runs ADD COLUMN ${name} ${definition}`);
    }
  }
}

async function ensureToolRunColumns(database: sqlite3.Database): Promise<void> {
  const existingColumns = new Set(
    (await all<{ name: string }>(database, 'PRAGMA table_info(agent_tool_runs)'))
      .map(column => column.name),
  );
  for (const [name, definition] of [
    ...TOOL_APPROVAL_COLUMNS,
    ...TOOL_PROGRESS_COLUMNS,
    ...TOOL_INTERACTION_COLUMNS,
    ...TOOL_RUNTIME_COLUMNS,
  ]) {
    if (!existingColumns.has(name)) {
      await exec(database, `ALTER TABLE agent_tool_runs ADD COLUMN ${name} ${definition}`);
    }
  }
  await exec(database, `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_runs_approval_idx
      ON agent_tool_runs (approval_id)
      WHERE approval_id IS NOT NULL;
  `);
  await exec(database, `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_runs_interaction_idx
      ON agent_tool_runs (interaction_id)
      WHERE interaction_id IS NOT NULL;
  `);
  await exec(database, `
    UPDATE agent_tool_runs AS current
    SET ordinal = (
      SELECT COUNT(*)
      FROM agent_tool_runs AS earlier
      WHERE earlier.run_id = current.run_id
        AND earlier.rowid <= current.rowid
    )
    WHERE ordinal <= 0;
  `);
  await exec(database, `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_runs_run_ordinal_idx
      ON agent_tool_runs (run_id, ordinal);
  `);
  await exec(database, `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_runs_run_plan_step_idx
      ON agent_tool_runs (run_id, plan_step_id)
      WHERE plan_step_id IS NOT NULL;
  `);
}

async function ensureRunPlanTriggers(database: sqlite3.Database): Promise<void> {
  await exec(database, `
    BEGIN IMMEDIATE;
    DROP TRIGGER IF EXISTS agent_runs_plan_must_start_empty;
    DROP TRIGGER IF EXISTS agent_runs_reject_replace;
    DROP TRIGGER IF EXISTS agent_runs_delete_only_with_session;
    DROP TRIGGER IF EXISTS agent_runs_validate_plan_on_update;
    DROP TRIGGER IF EXISTS agent_runs_set_plan_once_before_tools;
    DROP TRIGGER IF EXISTS agent_tool_runs_require_next_ordinal_on_insert;
    DROP TRIGGER IF EXISTS agent_tool_runs_reject_replace;
    DROP TRIGGER IF EXISTS agent_tool_runs_delete_only_with_run;
    DROP TRIGGER IF EXISTS agent_tool_runs_validate_plan_step_on_insert;
    DROP TRIGGER IF EXISTS agent_tool_runs_plan_step_is_immutable;

    CREATE TRIGGER agent_runs_plan_must_start_empty
    BEFORE INSERT ON agent_runs
    WHEN NEW.plan_json IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'Agent Run plan must be set after creation');
    END;

    CREATE TRIGGER agent_runs_reject_replace
    BEFORE INSERT ON agent_runs
    WHEN EXISTS (
      SELECT 1 FROM agent_runs AS existing WHERE existing.id = NEW.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Run identity cannot be replaced');
    END;

    CREATE TRIGGER agent_runs_delete_only_with_session
    BEFORE DELETE ON agent_runs
    WHEN EXISTS (
      SELECT 1 FROM agent_sessions WHERE id = OLD.session_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Run can only be deleted with its Session');
    END;

    CREATE TRIGGER agent_runs_validate_plan_on_update
    BEFORE UPDATE OF plan_json ON agent_runs
    WHEN NEW.plan_json IS NOT NULL
    BEGIN
      SELECT CASE
        WHEN json_valid(NEW.plan_json) = 0
          THEN RAISE(ABORT, 'Agent Run plan JSON is invalid')
        WHEN json_type(NEW.plan_json) <> 'object'
          OR json_type(NEW.plan_json, '$.version') <> 'integer'
          OR json_extract(NEW.plan_json, '$.version') <> 1
          OR json_type(NEW.plan_json, '$.createdAt') <> 'text'
          OR trim(json_extract(NEW.plan_json, '$.createdAt')) = ''
          OR length(json_extract(NEW.plan_json, '$.createdAt')) > 100
          OR json_type(NEW.plan_json, '$.steps') <> 'array'
          OR json_array_length(NEW.plan_json, '$.steps') NOT BETWEEN 2 AND 8
          OR (
            json_type(NEW.plan_json, '$.title') IS NOT NULL
            AND (
              json_type(NEW.plan_json, '$.title') <> 'text'
              OR trim(json_extract(NEW.plan_json, '$.title')) = ''
              OR length(json_extract(NEW.plan_json, '$.title')) > 80
            )
          )
          THEN RAISE(ABORT, 'Agent Run plan shape is invalid')
      END;
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.plan_json) AS field
        WHERE field.key NOT IN ('createdAt', 'steps', 'title', 'version')
      )
        OR (
          SELECT COUNT(*) FROM json_each(NEW.plan_json) WHERE key = 'createdAt'
        ) <> 1
        OR (
          SELECT COUNT(*) FROM json_each(NEW.plan_json) WHERE key = 'steps'
        ) <> 1
        OR (
          SELECT COUNT(*) FROM json_each(NEW.plan_json) WHERE key = 'version'
        ) <> 1
        OR (
          SELECT COUNT(*) FROM json_each(NEW.plan_json) WHERE key = 'title'
        ) > 1
      THEN RAISE(ABORT, 'Agent Run plan fields are invalid') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.plan_json, '$.steps') AS step
        WHERE json_type(step.value) <> 'object'
          OR json_type(step.value, '$.id') <> 'text'
          OR trim(json_extract(step.value, '$.id')) = ''
          OR length(json_extract(step.value, '$.id')) > 200
          OR json_type(step.value, '$.ordinal') <> 'integer'
          OR CAST(json_extract(step.value, '$.ordinal') AS INTEGER) <> CAST(step.key AS INTEGER) + 1
          OR json_type(step.value, '$.title') <> 'text'
          OR trim(json_extract(step.value, '$.title')) = ''
          OR length(json_extract(step.value, '$.title')) > 100
          OR json_type(step.value, '$.expectedToolName') <> 'text'
          OR trim(json_extract(step.value, '$.expectedToolName')) = ''
          OR length(json_extract(step.value, '$.expectedToolName')) > 120
      ) THEN RAISE(ABORT, 'Agent Run plan step is invalid') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.plan_json, '$.steps') AS step
        WHERE EXISTS (
          SELECT 1
          FROM json_each(step.value) AS field
          WHERE field.key NOT IN ('expectedToolName', 'id', 'ordinal', 'title')
        )
          OR (
            SELECT COUNT(*) FROM json_each(step.value) WHERE key = 'expectedToolName'
          ) <> 1
          OR (
            SELECT COUNT(*) FROM json_each(step.value) WHERE key = 'id'
          ) <> 1
          OR (
            SELECT COUNT(*) FROM json_each(step.value) WHERE key = 'ordinal'
          ) <> 1
          OR (
            SELECT COUNT(*) FROM json_each(step.value) WHERE key = 'title'
          ) <> 1
      ) THEN RAISE(ABORT, 'Agent Run plan step fields are invalid') END;
      SELECT CASE WHEN (
        SELECT COUNT(*)
        FROM json_each(NEW.plan_json, '$.steps')
      ) <> (
        SELECT COUNT(DISTINCT json_extract(step.value, '$.id'))
        FROM json_each(NEW.plan_json, '$.steps') AS step
      ) THEN RAISE(ABORT, 'Agent Run plan step id must be unique') END;
    END;

    CREATE TRIGGER agent_runs_set_plan_once_before_tools
    BEFORE UPDATE OF plan_json ON agent_runs
    BEGIN
      SELECT CASE
        WHEN NEW.plan_json IS NULL
          OR OLD.plan_json IS NOT NULL
          OR OLD.status NOT IN ('running', 'awaiting_approval', 'awaiting_interaction')
          OR EXISTS (
            SELECT 1 FROM agent_tool_runs WHERE run_id = OLD.id
          )
          OR NEW.revision <> OLD.revision + 1
          OR NEW.updated_at <> json_extract(NEW.plan_json, '$.createdAt')
          THEN RAISE(ABORT, 'Agent Run plan can only be set once before its first Tool')
      END;
    END;

    CREATE TRIGGER agent_tool_runs_require_next_ordinal_on_insert
    BEFORE INSERT ON agent_tool_runs
    WHEN EXISTS (
      SELECT 1
      FROM agent_runs
      WHERE id = NEW.run_id
        AND status IN ('running', 'awaiting_approval', 'awaiting_interaction')
    )
      AND NEW.ordinal <> COALESCE((
        SELECT MAX(existing.ordinal)
        FROM agent_tool_runs AS existing
        WHERE existing.run_id = NEW.run_id
      ), 0) + 1
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool ordinal must be the next value in its Run');
    END;

    CREATE TRIGGER agent_tool_runs_reject_replace
    BEFORE INSERT ON agent_tool_runs
    WHEN EXISTS (
      SELECT 1
      FROM agent_tool_runs AS existing
      WHERE existing.id = NEW.id
        OR (
          existing.run_id = NEW.run_id
          AND (
            existing.call_id = NEW.call_id
            OR existing.ordinal = NEW.ordinal
          )
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool run identity cannot be replaced');
    END;

    CREATE TRIGGER agent_tool_runs_delete_only_with_run
    BEFORE DELETE ON agent_tool_runs
    WHEN EXISTS (
      SELECT 1 FROM agent_runs WHERE id = OLD.run_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool run can only be deleted with its Run');
    END;

    CREATE TRIGGER agent_tool_runs_validate_plan_step_on_insert
    BEFORE INSERT ON agent_tool_runs
    WHEN NEW.plan_step_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM agent_runs AS runs
        JOIN json_each(runs.plan_json, '$.steps') AS step
        WHERE runs.id = NEW.run_id
          AND json_extract(step.value, '$.id') = NEW.plan_step_id
          AND json_extract(step.value, '$.expectedToolName') = NEW.tool_name
          AND CAST(json_extract(step.value, '$.ordinal') AS INTEGER) = COALESCE((
            SELECT MAX(CAST(json_extract(linked_step.value, '$.ordinal') AS INTEGER))
            FROM agent_tool_runs AS linked_tool
            JOIN json_each(runs.plan_json, '$.steps') AS linked_step
              ON json_extract(linked_step.value, '$.id') = linked_tool.plan_step_id
            WHERE linked_tool.run_id = NEW.run_id
          ), 0) + 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool plan step association is invalid');
    END;

    CREATE TRIGGER agent_tool_runs_plan_step_is_immutable
    BEFORE UPDATE OF run_id, tool_name, ordinal, plan_step_id ON agent_tool_runs
    WHEN NEW.run_id IS NOT OLD.run_id
      OR NEW.tool_name IS NOT OLD.tool_name
      OR NEW.ordinal IS NOT OLD.ordinal
      OR NEW.plan_step_id IS NOT OLD.plan_step_id
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool plan association identity is immutable');
    END;
    COMMIT;
  `);
}

async function ensureRunFinalizationTriggers(database: sqlite3.Database): Promise<void> {
  await exec(database, `
    BEGIN IMMEDIATE;
    DROP TRIGGER IF EXISTS agent_runs_block_completed_with_open_tools;
    DROP TRIGGER IF EXISTS agent_runs_finalize_open_tools;
    DROP TRIGGER IF EXISTS agent_tool_runs_require_active_run_on_insert;
    DROP TRIGGER IF EXISTS agent_tool_runs_require_active_run_on_reactivation;

    CREATE TRIGGER agent_tool_runs_require_active_run_on_insert
    BEFORE INSERT ON agent_tool_runs
    WHEN NOT EXISTS (
      SELECT 1
      FROM agent_runs
      WHERE id = NEW.run_id
        AND status IN ('running', 'awaiting_approval', 'awaiting_interaction')
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool requires an active Run');
    END;

    CREATE TRIGGER agent_tool_runs_require_active_run_on_reactivation
    BEFORE UPDATE OF status ON agent_tool_runs
    WHEN NEW.status IN ('running', 'awaiting_approval', 'awaiting_interaction')
      AND NOT EXISTS (
        SELECT 1
        FROM agent_runs
        WHERE id = NEW.run_id
          AND status IN ('running', 'awaiting_approval', 'awaiting_interaction')
      )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Tool requires an active Run');
    END;

    CREATE TRIGGER agent_runs_block_completed_with_open_tools
    BEFORE UPDATE OF status ON agent_runs
    WHEN NEW.status = 'completed'
      AND EXISTS (
        SELECT 1
        FROM agent_tool_runs
        WHERE run_id = NEW.id
          AND status IN ('running', 'awaiting_approval', 'awaiting_interaction')
      )
    BEGIN
      SELECT RAISE(ABORT, 'Agent Run still has unfinished Tool');
    END;

    CREATE TRIGGER agent_runs_finalize_open_tools
    AFTER UPDATE OF status ON agent_runs
    WHEN NEW.status IN ('failed', 'cancelled', 'interrupted')
      AND OLD.status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')
    BEGIN
      UPDATE agent_tool_runs
      SET
        status = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'interrupted' END,
        result_json = CASE
          WHEN NEW.status = 'cancelled'
            THEN '{"message":"Agent Run 已取消","ok":false}'
          ELSE '{"message":"Agent Run 已结束，未完成 Tool 已中断","ok":false}'
        END,
        approval_status = CASE
          WHEN approval_status = 'pending'
            THEN CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'interrupted' END
          ELSE approval_status
        END,
        approval_decided_at = CASE
          WHEN approval_status = 'pending' THEN NEW.updated_at
          ELSE approval_decided_at
        END,
        interaction_status = CASE
          WHEN interaction_status = 'pending'
            THEN CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'interrupted' END
          ELSE interaction_status
        END,
        interaction_decided_at = CASE
          WHEN interaction_status = 'pending' THEN NEW.updated_at
          ELSE interaction_decided_at
        END,
        revision = revision + 1,
        finished_at = NEW.updated_at
      WHERE run_id = NEW.id
        AND status IN ('running', 'awaiting_approval', 'awaiting_interaction');
    END;
    COMMIT;
  `);
}

async function ensureContextCheckpointSchema(database: sqlite3.Database): Promise<void> {
  await exec(database, `
    BEGIN IMMEDIATE;
    ${CONTEXT_CHECKPOINT_TABLE_SQL}

    CREATE INDEX IF NOT EXISTS agent_context_checkpoints_session_completed_idx
      ON agent_context_checkpoints (
        session_id,
        status,
        through_sequence DESC,
        finished_at DESC
      );

    CREATE UNIQUE INDEX IF NOT EXISTS agent_context_checkpoints_one_started_idx
      ON agent_context_checkpoints (session_id)
      WHERE status = 'started';

    DROP TRIGGER IF EXISTS agent_context_checkpoints_validate_insert;
    DROP TRIGGER IF EXISTS agent_context_checkpoints_validate_transition;
    DROP TRIGGER IF EXISTS agent_context_checkpoints_delete_only_with_session;
    COMMIT;
  `);

  const completedRows = await all<Pick<ContextCheckpointRow, 'id' | 'summary_json'>>(
    database,
    `SELECT id, summary_json
     FROM agent_context_checkpoints
     WHERE status = 'completed'`,
  );
  const invalidIds = completedRows.flatMap((row) => {
    if (!row.summary_json) return [row.id];
    try {
      parseAgentConversationSummary(row.summary_json);
      return [];
    } catch {
      return [row.id];
    }
  });
  if (invalidIds.length > 0) {
    await exec(database, 'BEGIN IMMEDIATE;');
    try {
      for (const id of invalidIds) {
        await run(database, `
          UPDATE agent_context_checkpoints
          SET status = 'failed', summary_json = NULL,
              finished_at = COALESCE(finished_at, created_at)
          WHERE id = ? AND status = 'completed'
        `, [id]);
      }
      await exec(database, 'COMMIT;');
    } catch (error) {
      await exec(database, 'ROLLBACK;').catch(() => undefined);
      throw error;
    }
  }

  await exec(database, `
    BEGIN IMMEDIATE;

    CREATE TRIGGER agent_context_checkpoints_validate_insert
    BEFORE INSERT ON agent_context_checkpoints
    BEGIN
      SELECT CASE
        WHEN NEW.status <> 'started'
          OR trim(NEW.id) = ''
          OR length(NEW.id) > ${MAX_CONTEXT_CHECKPOINT_ID_LENGTH}
          OR trim(NEW.profile_id) = ''
          OR length(NEW.profile_id) > ${MAX_CONTEXT_CHECKPOINT_PROFILE_ID_LENGTH}
          OR trim(NEW.model) = ''
          OR length(NEW.model) > ${MAX_CONTEXT_CHECKPOINT_MODEL_LENGTH}
          OR trim(NEW.created_at) = ''
          OR length(NEW.created_at) > 100
          THEN RAISE(ABORT, 'Agent context checkpoint fields are invalid')
      END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM agent_messages
        WHERE id = NEW.through_message_id
          AND session_id = NEW.session_id
          AND sequence = NEW.through_sequence
      ) THEN RAISE(ABORT, 'Agent context checkpoint boundary is invalid') END;
      SELECT CASE WHEN NEW.base_checkpoint_id IS NOT (
        SELECT checkpoint.id
        FROM agent_context_checkpoints AS checkpoint
        WHERE checkpoint.session_id = NEW.session_id
          AND checkpoint.status = 'completed'
        ORDER BY
          checkpoint.through_sequence DESC,
          checkpoint.finished_at DESC,
          checkpoint.rowid DESC
        LIMIT 1
      ) THEN RAISE(ABORT, 'Agent context checkpoint base is stale') END;
      SELECT CASE WHEN NEW.through_sequence <= COALESCE((
        SELECT MAX(checkpoint.through_sequence)
        FROM agent_context_checkpoints AS checkpoint
        WHERE checkpoint.session_id = NEW.session_id
          AND checkpoint.status = 'completed'
      ), 0) THEN RAISE(ABORT, 'Agent context checkpoint boundary must advance') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM agent_runs AS active_run
        WHERE active_run.session_id = NEW.session_id
          AND active_run.status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')
          AND EXISTS (
            SELECT 1
            FROM agent_messages AS active_message
            WHERE active_message.run_id = active_run.id
              AND active_message.sequence <= NEW.through_sequence
          )
      ) THEN RAISE(ABORT, 'Agent context checkpoint cannot include an active Run') END;
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM agent_messages AS included_message
        JOIN agent_messages AS remaining_message
          ON remaining_message.session_id = included_message.session_id
          AND remaining_message.run_id = included_message.run_id
        WHERE included_message.session_id = NEW.session_id
          AND included_message.run_id IS NOT NULL
          AND included_message.sequence <= NEW.through_sequence
          AND remaining_message.sequence > NEW.through_sequence
      ) THEN RAISE(ABORT, 'Agent context checkpoint cannot split a Run') END;
    END;

    CREATE TRIGGER agent_context_checkpoints_validate_transition
    BEFORE UPDATE ON agent_context_checkpoints
    BEGIN
      SELECT CASE WHEN
        NEW.id IS NOT OLD.id
        OR NEW.session_id IS NOT OLD.session_id
        OR NEW.base_checkpoint_id IS NOT OLD.base_checkpoint_id
        OR NEW.through_message_id IS NOT OLD.through_message_id
        OR NEW.through_sequence IS NOT OLD.through_sequence
        OR NEW.profile_id IS NOT OLD.profile_id
        OR NEW.model IS NOT OLD.model
        OR NEW.created_at IS NOT OLD.created_at
      THEN RAISE(ABORT, 'Agent context checkpoint identity is immutable') END;
      SELECT CASE WHEN OLD.status <> 'started'
        OR NEW.status NOT IN ('completed', 'failed', 'interrupted')
      THEN RAISE(ABORT, 'Agent context checkpoint can only finish once') END;
    END;

    CREATE TRIGGER agent_context_checkpoints_delete_only_with_session
    BEFORE DELETE ON agent_context_checkpoints
    WHEN EXISTS (
      SELECT 1 FROM agent_sessions WHERE id = OLD.session_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Agent context checkpoint can only be deleted with its Session');
    END;
    COMMIT;
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
        plan_json TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
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

      ${CONTEXT_CHECKPOINT_TABLE_SQL}

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
        progress_json TEXT,
        progress_updated_at TEXT,
        interaction_id TEXT,
        interaction_request_json TEXT,
        interaction_status TEXT,
        interaction_response_json TEXT,
        interaction_decided_at TEXT,
        ordinal INTEGER NOT NULL DEFAULT 0,
        plan_step_id TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        UNIQUE (run_id, call_id)
      );

      CREATE UNIQUE INDEX agent_tool_runs_approval_idx
        ON agent_tool_runs (approval_id)
        WHERE approval_id IS NOT NULL;

      CREATE UNIQUE INDEX agent_tool_runs_interaction_idx
        ON agent_tool_runs (interaction_id)
        WHERE interaction_id IS NOT NULL;

      CREATE UNIQUE INDEX agent_tool_runs_run_ordinal_idx
        ON agent_tool_runs (run_id, ordinal);

      CREATE UNIQUE INDEX agent_tool_runs_run_plan_step_idx
        ON agent_tool_runs (run_id, plan_step_id)
        WHERE plan_step_id IS NOT NULL;

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

  await ensureRunColumns(database);
  await ensureToolRunColumns(database);
  await ensureRunPlanTriggers(database);
  await ensureRunFinalizationTriggers(database);
  await ensureContextCheckpointSchema(database);

  const recoveredAt = new Date().toISOString();
  await run(database, `
    UPDATE agent_context_checkpoints
    SET status = 'interrupted', finished_at = ?
    WHERE status = 'started'
  `, [recoveredAt]);
  await run(database, `
    UPDATE agent_runs
    SET
      status = 'interrupted',
      current_step = '上次运行已中断',
      error = '应用退出时任务仍在运行，可重新发送上一条消息',
      revision = revision + 1,
      updated_at = ?,
      finished_at = ?
    WHERE status IN ('running', 'awaiting_approval', 'awaiting_interaction')
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
      approval_decided_at = CASE
        WHEN approval_status = 'pending' THEN ?
        ELSE approval_decided_at
      END,
      interaction_status = CASE
        WHEN interaction_status = 'pending' THEN 'interrupted'
        ELSE interaction_status
      END,
      interaction_decided_at = CASE
        WHEN interaction_status = 'pending' THEN ?
        ELSE interaction_decided_at
      END,
      revision = revision + 1,
      finished_at = ?
    WHERE status IN ('running', 'awaiting_approval', 'awaiting_interaction')
  `, [
    JSON.stringify({ message: '应用退出时 Agent Tool 仍在运行', ok: false }),
    recoveredAt,
    recoveredAt,
    recoveredAt,
  ]);
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

  async function readRun(runId: string): Promise<AgentRunSnapshot> {
    const row = await get<RunRow>(database, `
      SELECT
        id,
        session_id,
        status,
        user_prompt,
        profile_id,
        model,
        reasoning_effort,
        plan_json,
        revision,
        current_step,
        error,
        created_at,
        updated_at,
        finished_at
      FROM agent_runs
      WHERE id = ?
    `, [runId]);
    if (!row) throw new Error('Agent 运行记录不存在');
    return toRunSnapshot(row);
  }

  async function readToolActivity(id: string): Promise<AgentToolActivitySnapshot> {
    const row = await get<ToolActivityRow>(database, `
      SELECT
        tools.id,
        tools.call_id,
        tools.tool_name,
        tools.input_json,
        tools.result_json,
        tools.status,
        tools.permission_behavior,
        tools.approval_id,
        tools.approval_preview_json,
        tools.approval_status,
        tools.approval_decided_at,
        tools.progress_json,
        tools.progress_updated_at,
        tools.interaction_id,
        tools.interaction_request_json,
        tools.interaction_status,
        tools.interaction_response_json,
        tools.interaction_decided_at,
        tools.ordinal,
        tools.plan_step_id,
        tools.revision,
        tools.created_at,
        tools.finished_at,
        tools.run_id,
        runs.session_id
      FROM agent_tool_runs AS tools
      JOIN agent_runs AS runs ON runs.id = tools.run_id
      WHERE tools.id = ?
    `, [id]);
    if (!row) throw new Error('Agent Tool 运行记录不存在');
    return toToolActivity(row);
  }

  async function readContextCheckpoint(id: string): Promise<AgentContextCheckpoint> {
    const row = await get<ContextCheckpointRow>(database, `${CONTEXT_CHECKPOINT_SELECT}
      WHERE checkpoint.id = ?
    `, [id]);
    const checkpoint = row ? toContextCheckpoint(row) : null;
    if (!checkpoint) throw new Error('Agent 上下文 checkpoint 不存在或数据无效');
    return checkpoint;
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

    async beginContextCheckpoint(input) {
      const checkpointId = normalizeContextCheckpointText(
        input.id,
        'ID',
        MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
      );
      const sessionId = normalizeContextCheckpointText(
        input.sessionId,
        'Session ID',
        MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
      );
      const throughMessageId = normalizeContextCheckpointText(
        input.throughMessageId,
        '消息边界',
        MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
      );
      const baseCheckpointId = input.baseCheckpointId === undefined
        ? null
        : normalizeContextCheckpointText(
            input.baseCheckpointId,
            '基础 checkpoint',
            MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
          );
      const profileId = normalizeContextCheckpointText(
        input.profileId,
        'AI 服务配置',
        MAX_CONTEXT_CHECKPOINT_PROFILE_ID_LENGTH,
      );
      const model = normalizeContextCheckpointText(
        input.model,
        '模型',
        MAX_CONTEXT_CHECKPOINT_MODEL_LENGTH,
      );
      const createdAt = normalizeContextCheckpointText(input.now, '创建时间', 100);
      const scope = normalizeAgentOwnerScope(input.ownerScope);
      let result: RunStatementResult;
      try {
        result = await run(database, `
          INSERT INTO agent_context_checkpoints (
            id,
            session_id,
            base_checkpoint_id,
            through_message_id,
            through_sequence,
            status,
            summary_json,
            profile_id,
            model,
            created_at,
            finished_at
          )
          SELECT
            ?,
            sessions.id,
            ?,
            messages.id,
            messages.sequence,
            'started',
            NULL,
            ?,
            ?,
            ?,
            NULL
          FROM agent_sessions AS sessions
          JOIN agent_messages AS messages
            ON messages.session_id = sessions.id
          WHERE sessions.id = ?
            AND sessions.backend_scope = ?
            AND sessions.account_scope = ?
            AND sessions.library_id = ?
            AND sessions.archived_at IS NULL
            AND messages.id = ?
        `, [
          checkpointId,
          baseCheckpointId,
          profileId,
          model,
          createdAt,
          sessionId,
          scope.backendScope,
          scope.accountScope,
          normalizeLibraryId(input.libraryId),
          throughMessageId,
        ]);
      } catch (error) {
        if (String(error).includes('agent_context_checkpoints.session_id')) {
          throw new Error('Agent 上下文 checkpoint 已有压缩任务正在进行');
        }
        throw error;
      }
      if (result.changes === 0) {
        throw new Error('Agent 上下文 checkpoint 的会话或消息边界无效');
      }
      return readContextCheckpoint(checkpointId);
    },

    async close() {
      await close(database);
    },

    async completeContextCheckpoint(id, summary, now) {
      const checkpointId = normalizeContextCheckpointText(
        id,
        'ID',
        MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
      );
      const summaryJson = serializeContextCheckpointSummary(summary);
      const finishedAt = normalizeContextCheckpointText(now, '完成时间', 100);
      const result = await run(database, `
        UPDATE agent_context_checkpoints
        SET status = 'completed', summary_json = ?, finished_at = ?
        WHERE id = ? AND status = 'started'
      `, [summaryJson, finishedAt, checkpointId]);
      if (result.changes === 0) {
        throw new Error('Agent 上下文 checkpoint 不存在或已经结束');
      }
      return readContextCheckpoint(checkpointId);
    },

    async completeToolRun(id, result, now, status) {
      const finalStatus = status || (result.ok ? 'completed' : 'failed');
      const unresolvedStatus = finalStatus === 'cancelled' ? 'cancelled' : 'interrupted';
      const update = await run(database, `
        UPDATE agent_tool_runs
        SET
          result_json = ?,
          status = ?,
          approval_status = CASE
            WHEN approval_status = 'pending' THEN ?
            ELSE approval_status
          END,
          approval_decided_at = CASE
            WHEN approval_status = 'pending' THEN ?
            ELSE approval_decided_at
          END,
          interaction_status = CASE
            WHEN interaction_status = 'pending' THEN ?
            ELSE interaction_status
          END,
          interaction_decided_at = CASE
            WHEN interaction_status = 'pending' THEN ?
            ELSE interaction_decided_at
          END,
          revision = revision + 1,
          finished_at = ?
        WHERE id = ?
          AND (
            status IN ('running', 'awaiting_approval', 'awaiting_interaction')
            OR (status = ? AND result_json IS NULL)
          )
      `, [
        JSON.stringify(result),
        finalStatus,
        unresolvedStatus,
        now,
        unresolvedStatus,
        now,
        now,
        id,
        finalStatus,
      ]);
      if (update.changes === 0) throw new Error('Agent Tool 运行记录不存在或已经结束');
      return readToolActivity(id);
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
      return readRun(input.id);
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
      return { ...created, messages: [], runs: [], toolActivities: [] };
    },

    async createToolRun(input) {
      const result = await run(database, `
        WITH target_run AS (
          SELECT
            runs.id,
            runs.plan_json,
            COALESCE((
              SELECT MAX(existing.ordinal)
              FROM agent_tool_runs AS existing
              WHERE existing.run_id = runs.id
            ), 0) + 1 AS next_tool_ordinal,
            COALESCE((
              SELECT MAX(CAST(json_extract(linked_step.value, '$.ordinal') AS INTEGER))
              FROM agent_tool_runs AS linked_tool
              JOIN json_each(runs.plan_json, '$.steps') AS linked_step
                ON json_extract(linked_step.value, '$.id') = linked_tool.plan_step_id
              WHERE linked_tool.run_id = runs.id
            ), 0) + 1 AS next_plan_ordinal
          FROM agent_runs AS runs
          WHERE runs.id = ?
        ),
        next_plan_step AS (
          SELECT
            target_run.id AS run_id,
            json_extract(step.value, '$.expectedToolName') AS expected_tool_name,
            json_extract(step.value, '$.id') AS step_id
          FROM target_run
          JOIN json_each(target_run.plan_json, '$.steps') AS step
          WHERE CAST(json_extract(step.value, '$.ordinal') AS INTEGER)
            = target_run.next_plan_ordinal
        )
        INSERT INTO agent_tool_runs (
          id, run_id, call_id, tool_name, input_json, status,
          permission_behavior, approval_id, approval_input_hash,
          approval_preview_json, approval_status, ordinal, plan_step_id, created_at
        )
        SELECT
          ?,
          target_run.id,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          target_run.next_tool_ordinal,
          CASE
            WHEN next_plan_step.expected_tool_name = ? THEN next_plan_step.step_id
            ELSE NULL
          END,
          ?
        FROM target_run
        LEFT JOIN next_plan_step ON next_plan_step.run_id = target_run.id
      `, [
        input.runId,
        input.id,
        input.callId,
        input.toolName,
        JSON.stringify(input.input),
        input.status,
        input.permissionBehavior,
        input.approvalId || null,
        input.approvalInputHash || null,
        input.approvalPreview ? JSON.stringify(input.approvalPreview) : null,
        input.permissionBehavior === 'ask' ? 'pending' : null,
        input.toolName,
        input.now,
      ]);
      if (result.changes === 0) throw new Error('Agent 运行记录不存在');
      return readToolActivity(input.id);
    },

    async createToolInteraction(id, interactionId, request) {
      const result = await run(database, `
        UPDATE agent_tool_runs
        SET
          interaction_id = ?,
          interaction_request_json = ?,
          interaction_status = 'pending',
          interaction_response_json = NULL,
          interaction_decided_at = NULL,
          revision = revision + 1,
          status = 'awaiting_interaction'
        WHERE id = ? AND status = 'running' AND interaction_id IS NULL
      `, [interactionId, JSON.stringify(request), id]);
      if (result.changes === 0) throw new Error('Agent Tool 无法进入交互等待状态');
      return readToolActivity(id);
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

    async failContextCheckpoint(id, now, status = 'failed') {
      const checkpointId = normalizeContextCheckpointText(
        id,
        'ID',
        MAX_CONTEXT_CHECKPOINT_ID_LENGTH,
      );
      const finishedAt = normalizeContextCheckpointText(now, '完成时间', 100);
      if (status !== 'failed' && status !== 'interrupted') {
        throw new Error('Agent 上下文 checkpoint 终态无效');
      }
      const result = await run(database, `
        UPDATE agent_context_checkpoints
        SET status = ?, summary_json = NULL, finished_at = ?
        WHERE id = ? AND status = 'started'
      `, [status, finishedAt, checkpointId]);
      if (result.changes === 0) {
        throw new Error('Agent 上下文 checkpoint 不存在或已经结束');
      }
      return readContextCheckpoint(checkpointId);
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
      const runRows = await all<RunRow>(database, `
        SELECT
          id,
          session_id,
          status,
          user_prompt,
          profile_id,
          model,
          reasoning_effort,
          plan_json,
          revision,
          current_step,
          error,
          created_at,
          updated_at,
          finished_at
        FROM agent_runs
        WHERE session_id = ?
        ORDER BY created_at ASC, rowid ASC
      `, [sessionId]);
      const toolRows = await all<ToolActivityRow>(database, `
        SELECT
          tools.id,
          tools.call_id,
          tools.tool_name,
          tools.input_json,
          tools.result_json,
          tools.status,
          tools.permission_behavior,
          tools.approval_id,
          tools.approval_preview_json,
          tools.approval_status,
          tools.approval_decided_at,
          tools.progress_json,
          tools.progress_updated_at,
          tools.interaction_id,
          tools.interaction_request_json,
          tools.interaction_status,
          tools.interaction_response_json,
          tools.interaction_decided_at,
          tools.ordinal,
          tools.plan_step_id,
          tools.revision,
          tools.created_at,
          tools.finished_at,
          tools.run_id,
          runs.session_id
        FROM agent_tool_runs AS tools
        JOIN agent_runs AS runs ON runs.id = tools.run_id
        WHERE runs.session_id = ?
        ORDER BY runs.created_at ASC, runs.rowid ASC, tools.ordinal ASC
      `, [sessionId]);
      return {
        ...summary,
        messages: rows.map(toMessage),
        runs: runRows.map(toRunSnapshot),
        toolActivities: toolRows.map(toToolActivity),
      };
    },

    async readContextCheckpointState(sessionId, ownerScope, libraryId) {
      const summary = await readSummary(sessionId, ownerScope, libraryId);
      if (!summary) return null;

      const completedRows = await all<ContextCheckpointRow>(database, `
        ${CONTEXT_CHECKPOINT_SELECT}
        WHERE checkpoint.session_id = ?
          AND checkpoint.status = 'completed'
        ORDER BY
          checkpoint.through_sequence DESC,
          checkpoint.finished_at DESC,
          checkpoint.rowid DESC
      `, [sessionId]);
      let latestCompleted: AgentContextCheckpoint | undefined;
      let latestCompletedRowId = 0;
      for (const row of completedRows) {
        const candidate = toContextCheckpoint(row);
        if (!candidate) continue;
        latestCompleted = candidate;
        latestCompletedRowId = Number(row.checkpoint_rowid);
        break;
      }
      const failureRow = await get<{ failure_count: number }>(database, `
        SELECT COUNT(*) AS failure_count
        FROM agent_context_checkpoints
        WHERE session_id = ?
          AND status = 'failed'
          AND rowid > ?
      `, [sessionId, latestCompletedRowId]);
      return {
        consecutiveFailureCount: Number(failureRow?.failure_count || 0),
        ...(latestCompleted ? { latestCompleted } : {}),
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

    async setRunPlan(runId, plan) {
      const canonicalPlan = parseStoredAgentRunPlan(JSON.stringify(plan));
      if (!canonicalPlan) throw new Error('Agent 计划不能为空');
      const result = await run(database, `
        UPDATE agent_runs
        SET
          plan_json = ?,
          revision = revision + 1,
          updated_at = ?
        WHERE id = ?
          AND plan_json IS NULL
          AND status IN ('running', 'awaiting_approval', 'awaiting_interaction')
          AND NOT EXISTS (
            SELECT 1 FROM agent_tool_runs WHERE run_id = agent_runs.id
          )
      `, [JSON.stringify(canonicalPlan), canonicalPlan.createdAt, runId]);
      if (result.changes === 0) {
        throw new Error('Agent 计划只能在活跃 Run 的首个 Tool 前设置一次');
      }
      return readRun(runId);
    },

    async resolveToolApproval(approvalId, resolution, now) {
      const approved = resolution === 'approved';
      const result = await run(database, `
        UPDATE agent_tool_runs
        SET
          approval_status = ?,
          approval_decided_at = ?,
          revision = revision + 1,
          status = ?
        WHERE approval_id = ?
          AND status = 'awaiting_approval'
          AND approval_status = 'pending'
      `, [
        resolution,
        now,
        approved ? 'running' : resolution === 'cancelled' ? 'cancelled' : 'failed',
        approvalId,
      ]);
      if (result.changes === 0) throw new Error('Agent 确认请求不存在或已经处理');
      const row = await get<{ id: string }>(database, `
        SELECT id FROM agent_tool_runs WHERE approval_id = ?
      `, [approvalId]);
      if (!row) throw new Error('Agent Tool 运行记录不存在');
      return readToolActivity(row.id);
    },

    async resolveToolInteraction(interactionId, resolution, response, now) {
      const submitted = resolution === 'submitted';
      if (submitted !== Boolean(response)) {
        throw new Error('Agent 交互回答与处理状态不匹配');
      }
      const result = await run(database, `
        UPDATE agent_tool_runs
        SET
          interaction_status = ?,
          interaction_response_json = ?,
          interaction_decided_at = ?,
          revision = revision + 1,
          status = ?
        WHERE interaction_id = ?
          AND status = 'awaiting_interaction'
          AND interaction_status = 'pending'
      `, [
        resolution,
        response ? JSON.stringify(response) : null,
        now,
        submitted ? 'running' : resolution === 'cancelled' ? 'cancelled' : 'failed',
        interactionId,
      ]);
      if (result.changes === 0) throw new Error('Agent 交互请求不存在或已经处理');
      const row = await get<{ id: string }>(database, `
        SELECT id FROM agent_tool_runs WHERE interaction_id = ?
      `, [interactionId]);
      if (!row) throw new Error('Agent Tool 运行记录不存在');
      return readToolActivity(row.id);
    },

    async updateToolRunProgress(id, progress, updatedAt) {
      const result = await run(database, `
        UPDATE agent_tool_runs
        SET
          progress_json = ?,
          progress_updated_at = ?,
          revision = revision + 1
        WHERE id = ?
          AND status IN ('running', 'awaiting_approval')
      `, [JSON.stringify(progress), updatedAt, id]);
      if (result.changes === 0) throw new Error('Agent Tool 运行记录不存在或已经结束');
      return readToolActivity(id);
    },

    async updateRun(runId, update) {
      const terminal = isTerminalRunStatus(update.status);
      try {
        const result = await run(database, `
          UPDATE agent_runs
          SET
            status = ?,
            current_step = ?,
            error = ?,
            revision = revision + 1,
            updated_at = ?,
            finished_at = ?
          WHERE id = ?
            AND status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')
        `, [
          update.status,
          update.currentStep || null,
          update.error || null,
          update.updatedAt,
          terminal ? update.finishedAt || update.updatedAt : null,
          runId,
        ]);
        if (result.changes === 0) {
          throw new Error('Agent 运行记录不存在或已经结束');
        }
      } catch (error) {
        if (String(error).includes('Agent Run still has unfinished Tool')) {
          throw new Error('Agent Run 仍有未完成 Tool，不能标记为已完成');
        }
        throw error;
      }
      return readRun(runId);
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

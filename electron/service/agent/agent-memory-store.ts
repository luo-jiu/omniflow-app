import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';

import type {
  AgentMemoryCursor,
  AgentMemoryItem,
  AgentMemoryPage,
  AgentMemoryProposal,
  AgentOwnerScope,
} from '@/shared/agent/agent.types';
import { normalizeAgentMemoryQuery } from '../../../src/shared/agent/agent-memory-query';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import {
  normalizeAgentMemoryEditableFields,
  normalizeAgentMemoryProposal,
} from './agent-memory-model';

const MAX_MEMORY_ID_LENGTH = 200;
const MAX_SOURCE_ID_LENGTH = 200;
const MEMORY_PAGE_SIZE = 50;
const MAX_MEMORY_CANDIDATES = 200;

interface AgentMemoryRow {
  application: string;
  content: string;
  created_at: string;
  id: string;
  kind: AgentMemoryItem['kind'];
  library_id: number | null;
  reason: string;
  revision: number;
  source_run_id: string | null;
  source_session_id: string | null;
  title: string;
  updated_at: string;
}

interface RunStatementResult {
  changes: number;
  lastID: number;
}

export interface CreateAgentMemoryInput {
  id: string;
  libraryId?: number;
  now: string;
  ownerScope: AgentOwnerScope;
  proposal: AgentMemoryProposal;
  sourceRunId?: string;
  sourceSessionId?: string;
}

export interface UpdateAgentMemoryInput {
  application: string;
  content: string;
  id: string;
  libraryId: number;
  now: string;
  ownerScope: AgentOwnerScope;
  reason: string;
  revision: number;
  title: string;
}

export interface DeleteAgentMemoryInput {
  id: string;
  libraryId: number;
  ownerScope: AgentOwnerScope;
  revision: number;
}

export interface AgentMemoryStore {
  close: () => Promise<void>;
  create: (input: CreateAgentMemoryInput) => Promise<AgentMemoryItem>;
  delete: (input: DeleteAgentMemoryInput) => Promise<boolean>;
  list: (
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query?: string,
    cursor?: AgentMemoryCursor,
  ) => Promise<AgentMemoryPage>;
  listCandidates: (
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ) => Promise<AgentMemoryItem[]>;
  update: (input: UpdateAgentMemoryInput) => Promise<AgentMemoryItem>;
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
    database.get<T>(sql, parameters, (error, row) => (
      error ? reject(error) : resolve(row)
    ));
  });
}

function all<T>(
  database: sqlite3.Database,
  sql: string,
  parameters: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, parameters, (error, rows) => (
      error ? reject(error) : resolve(rows)
    ));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}无效`);
  return parsed;
}

function normalizeId(value: unknown, label: string, maximum = MAX_MEMORY_ID_LENGTH): string {
  const id = String(value || '').trim();
  if (!id || id.length > maximum) throw new Error(`${label}无效`);
  return id;
}

function optionalSourceId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeId(value, label, MAX_SOURCE_ID_LENGTH);
}

function normalizeMemoryCursor(
  value: AgentMemoryCursor | undefined,
): AgentMemoryCursor | null {
  if (!value) return null;
  const id = String(value.id || '').trim();
  const updatedAt = String(value.updatedAt || '').trim();
  if (
    !id
    || id.length > MAX_MEMORY_ID_LENGTH
    || !updatedAt
    || updatedAt.length > 100
  ) {
    throw new Error('长期记忆分页游标无效');
  }
  return { id, updatedAt };
}

function toMemoryItem(row: AgentMemoryRow): AgentMemoryItem {
  return {
    application: row.application,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    ...(row.library_id === null ? {} : { libraryId: Number(row.library_id) }),
    reason: row.reason,
    revision: Number(row.revision),
    scope: row.library_id === null ? 'global' : 'library',
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    ...(row.source_session_id ? { sourceSessionId: row.source_session_id } : {}),
    title: row.title,
    updatedAt: row.updated_at,
  };
}

const MEMORY_SELECT = `
  SELECT
    id,
    library_id,
    kind,
    title,
    content,
    reason,
    application,
    source_session_id,
    source_run_id,
    revision,
    created_at,
    updated_at
  FROM agent_memories
`;

async function initializeDatabase(database: sqlite3.Database): Promise<void> {
  await exec(database, `
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      backend_scope TEXT NOT NULL,
      account_scope TEXT NOT NULL,
      library_id INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('preference', 'project', 'reference')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      reason TEXT NOT NULL,
      application TEXT NOT NULL,
      source_session_id TEXT,
      source_run_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (library_id IS NULL OR library_id > 0),
      CHECK (kind <> 'project' OR library_id IS NOT NULL)
    );

    CREATE INDEX IF NOT EXISTS agent_memories_owner_scope_updated_idx
      ON agent_memories (
        backend_scope,
        account_scope,
        library_id,
        updated_at DESC,
        id ASC
      );

    DROP TRIGGER IF EXISTS agent_memories_owner_limit_before_insert;
    DROP TRIGGER IF EXISTS agent_memories_accessible_limit_before_insert;

    CREATE TRIGGER agent_memories_accessible_limit_before_insert
    BEFORE INSERT ON agent_memories
    WHEN
      (
        NEW.library_id IS NOT NULL
        AND (
          SELECT COUNT(*)
          FROM agent_memories
          WHERE backend_scope = NEW.backend_scope
            AND account_scope = NEW.account_scope
            AND (library_id IS NULL OR library_id = NEW.library_id)
        ) >= ${MAX_MEMORY_CANDIDATES}
      )
      OR (
        NEW.library_id IS NULL
        AND (
          (
            SELECT COUNT(*)
            FROM agent_memories
            WHERE backend_scope = NEW.backend_scope
              AND account_scope = NEW.account_scope
              AND library_id IS NULL
          ) >= ${MAX_MEMORY_CANDIDATES}
          OR EXISTS (
            SELECT 1
            FROM agent_memories AS scoped
            WHERE scoped.backend_scope = NEW.backend_scope
              AND scoped.account_scope = NEW.account_scope
              AND scoped.library_id IS NOT NULL
            GROUP BY scoped.library_id
            HAVING COUNT(*) + (
              SELECT COUNT(*)
              FROM agent_memories AS global_memory
              WHERE global_memory.backend_scope = NEW.backend_scope
                AND global_memory.account_scope = NEW.account_scope
                AND global_memory.library_id IS NULL
            ) >= ${MAX_MEMORY_CANDIDATES}
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, '长期记忆数量已达到上限');
    END;
  `);
}

export async function createSQLiteAgentMemoryStore(
  databasePath: string,
): Promise<AgentMemoryStore> {
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

  async function readAccessibleMemory(
    id: string,
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<AgentMemoryItem | null> {
    const scope = normalizeAgentOwnerScope(ownerScope);
    const row = await get<AgentMemoryRow>(database, `${MEMORY_SELECT}
      WHERE id = ?
        AND backend_scope = ?
        AND account_scope = ?
        AND (library_id IS NULL OR library_id = ?)
    `, [id, scope.backendScope, scope.accountScope, libraryId]);
    return row ? toMemoryItem(row) : null;
  }

  async function readOwnedMemory(
    id: string,
    ownerScope: AgentOwnerScope,
  ): Promise<AgentMemoryItem | null> {
    const scope = normalizeAgentOwnerScope(ownerScope);
    const row = await get<AgentMemoryRow>(database, `${MEMORY_SELECT}
      WHERE id = ?
        AND backend_scope = ?
        AND account_scope = ?
    `, [id, scope.backendScope, scope.accountScope]);
    return row ? toMemoryItem(row) : null;
  }

  async function listAccessiblePage(
    ownerScope: AgentOwnerScope,
    libraryId: number,
    query?: string,
    cursorInput?: AgentMemoryCursor,
  ): Promise<AgentMemoryPage> {
    const scope = normalizeAgentOwnerScope(ownerScope);
    const normalizedLibraryId = normalizePositiveInteger(libraryId, '资料库 ID');
    const normalizedQuery = normalizeAgentMemoryQuery(query);
    const escapedQuery = normalizedQuery.replace(/[\\%_]/g, value => `\\${value}`);
    const searchParameters = normalizedQuery
      ? Array.from({ length: 4 }, () => `%${escapedQuery}%`)
      : [];
    const cursor = normalizeMemoryCursor(cursorInput);
    const cursorClause = cursor
      ? 'AND (updated_at < ? OR (updated_at = ? AND id > ?))'
      : '';
    const rows = await all<AgentMemoryRow>(database, `${MEMORY_SELECT}
      WHERE backend_scope = ?
        AND account_scope = ?
        AND (library_id IS NULL OR library_id = ?)
        ${normalizedQuery ? `AND (
          title LIKE ? ESCAPE '\\'
          OR content LIKE ? ESCAPE '\\'
          OR reason LIKE ? ESCAPE '\\'
          OR application LIKE ? ESCAPE '\\'
        )` : ''}
        ${cursorClause}
      ORDER BY updated_at DESC, id ASC
      LIMIT ${MEMORY_PAGE_SIZE + 1}
    `, [
      scope.backendScope,
      scope.accountScope,
      normalizedLibraryId,
      ...searchParameters,
      ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.id] : []),
    ]);
    const totalRow = await get<{ total: number }>(database, `
      SELECT COUNT(*) AS total
      FROM agent_memories
      WHERE backend_scope = ?
        AND account_scope = ?
        AND (library_id IS NULL OR library_id = ?)
        ${normalizedQuery ? `AND (
          title LIKE ? ESCAPE '\\'
          OR content LIKE ? ESCAPE '\\'
          OR reason LIKE ? ESCAPE '\\'
          OR application LIKE ? ESCAPE '\\'
        )` : ''}
    `, [
      scope.backendScope,
      scope.accountScope,
      normalizedLibraryId,
      ...searchParameters,
    ]);
    const hasMore = rows.length > MEMORY_PAGE_SIZE;
    const memories = rows.slice(0, MEMORY_PAGE_SIZE).map(toMemoryItem);
    const lastMemory = memories.at(-1);
    return {
      memories,
      ...(hasMore && lastMemory
        ? { nextCursor: { id: lastMemory.id, updatedAt: lastMemory.updatedAt } }
        : {}),
      total: Number(totalRow?.total || 0),
    };
  }

  async function listAccessibleCandidates(
    ownerScope: AgentOwnerScope,
    libraryId: number,
  ): Promise<AgentMemoryItem[]> {
    const scope = normalizeAgentOwnerScope(ownerScope);
    const normalizedLibraryId = normalizePositiveInteger(libraryId, '资料库 ID');
    const rows = await all<AgentMemoryRow>(database, `${MEMORY_SELECT}
      WHERE backend_scope = ?
        AND account_scope = ?
        AND (library_id IS NULL OR library_id = ?)
      ORDER BY updated_at DESC, id ASC
      LIMIT ${MAX_MEMORY_CANDIDATES + 1}
    `, [scope.backendScope, scope.accountScope, normalizedLibraryId]);
    if (rows.length > MAX_MEMORY_CANDIDATES) {
      throw new Error('当前资料库可见长期记忆超过 200 条，请先在长期记忆管理中清理');
    }
    return rows.map(toMemoryItem);
  }

  return {
    async close() {
      await close(database);
    },

    async create(input) {
      const scope = normalizeAgentOwnerScope(input.ownerScope);
      const proposal = normalizeAgentMemoryProposal(input.proposal);
      const id = normalizeId(input.id, '长期记忆 ID');
      const libraryId = proposal.scope === 'library'
        ? normalizePositiveInteger(input.libraryId, '资料库 ID')
        : null;
      if (proposal.scope === 'global' && input.libraryId !== undefined) {
        throw new Error('用户级长期记忆不能绑定资料库');
      }
      const sourceSessionId = optionalSourceId(input.sourceSessionId, '来源会话 ID');
      const sourceRunId = optionalSourceId(input.sourceRunId, '来源运行 ID');
      const createdAt = String(input.now || '').trim();
      if (!createdAt) throw new Error('长期记忆创建时间不能为空');

      await run(database, `
        INSERT INTO agent_memories (
          id,
          backend_scope,
          account_scope,
          library_id,
          kind,
          title,
          content,
          reason,
          application,
          source_session_id,
          source_run_id,
          revision,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `, [
        id,
        scope.backendScope,
        scope.accountScope,
        libraryId,
        proposal.kind,
        proposal.title,
        proposal.content,
        proposal.reason,
        proposal.application,
        sourceSessionId || null,
        sourceRunId || null,
        createdAt,
        createdAt,
      ]);
      const created = await readOwnedMemory(id, scope);
      if (!created) throw new Error('长期记忆保存后无法读取');
      return created;
    },

    async delete(input) {
      const scope = normalizeAgentOwnerScope(input.ownerScope);
      const id = normalizeId(input.id, '长期记忆 ID');
      const libraryId = normalizePositiveInteger(input.libraryId, '资料库 ID');
      const revision = normalizePositiveInteger(input.revision, '长期记忆 revision');
      const result = await run(database, `
        DELETE FROM agent_memories
        WHERE id = ?
          AND backend_scope = ?
          AND account_scope = ?
          AND (library_id IS NULL OR library_id = ?)
          AND revision = ?
      `, [id, scope.backendScope, scope.accountScope, libraryId, revision]);
      return result.changes === 1;
    },

    async list(ownerScope, libraryId, query, cursor) {
      return listAccessiblePage(ownerScope, libraryId, query, cursor);
    },

    async listCandidates(ownerScope, libraryId) {
      return listAccessibleCandidates(ownerScope, libraryId);
    },

    async update(input) {
      const scope = normalizeAgentOwnerScope(input.ownerScope);
      const id = normalizeId(input.id, '长期记忆 ID');
      const libraryId = normalizePositiveInteger(input.libraryId, '资料库 ID');
      const revision = normalizePositiveInteger(input.revision, '长期记忆 revision');
      const fields = normalizeAgentMemoryEditableFields(input);
      const updatedAt = String(input.now || '').trim();
      if (!updatedAt) throw new Error('长期记忆更新时间不能为空');
      const result = await run(database, `
        UPDATE agent_memories
        SET
          title = ?,
          content = ?,
          reason = ?,
          application = ?,
          revision = revision + 1,
          updated_at = ?
        WHERE id = ?
          AND backend_scope = ?
          AND account_scope = ?
          AND (library_id IS NULL OR library_id = ?)
          AND revision = ?
      `, [
        fields.title,
        fields.content,
        fields.reason,
        fields.application,
        updatedAt,
        id,
        scope.backendScope,
        scope.accountScope,
        libraryId,
        revision,
      ]);
      if (result.changes !== 1) {
        throw new Error('长期记忆已被修改、删除或不属于当前资料库');
      }
      const updated = await readAccessibleMemory(id, scope, libraryId);
      if (!updated) throw new Error('长期记忆修改后无法读取');
      return updated;
    },
  };
}

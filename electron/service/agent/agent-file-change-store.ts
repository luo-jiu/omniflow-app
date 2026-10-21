import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import type { AgentToolResult } from '../../../src/shared/agent/agent.types';
import type { AgentFileMutationSnapshot } from '../../../src/shared/agent/agent-file-write';
import type { AgentFileChangeScope, AgentFileChangeSummary, AgentFileChangeList, AgentFileDiffRequest, AgentFileDiffResult } from '../../../src/shared/agent/agent-file-changes';
import { normalizeAgentOwnerScope } from '../../../src/shared/agent/agent-owner-scope';
import { agentDatabaseSchemaCoordinator } from './storage/agent-database-schema-coordinator';
import { createAgentFileDiffRuntime, type AgentFileDiffRuntimeOptions } from './agent-file-diff-runtime';

const MAX_BYTES = 8 * 1024 * 1024;
const RUN_BYTES = 64 * 1024 * 1024;
const OWNER_BYTES = 512 * 1024 * 1024;
const RUN_RECORDS = 1_000;
const OWNER_RECORDS = 20_000;
const TTL = 7 * 24 * 60 * 60 * 1000;
const UNKNOWN_TTL = 14 * 24 * 60 * 60 * 1000;
const ID = /^[a-f0-9-]{36}$/u;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_file_changes (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
 backend_scope TEXT NOT NULL, account_scope TEXT NOT NULL, library_id INTEGER NOT NULL,
 session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 tool_run_id TEXT NOT NULL REFERENCES agent_tool_runs(id) ON DELETE CASCADE,
 scope TEXT NOT NULL CHECK(scope IN ('library','host')), path TEXT NOT NULL, node_id INTEGER,
 kind TEXT NOT NULL CHECK(kind IN ('create','update')),
 state TEXT NOT NULL CHECK(state IN ('committed','uncommitted','commit_unknown')),
 before_revision TEXT, after_revision TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes >= 0), retained INTEGER NOT NULL CHECK(retained IN (0,1)),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_file_changes_owner_idx
 ON agent_file_changes(backend_scope,account_scope,library_id,session_id,run_id,created_at);
CREATE TABLE IF NOT EXISTS agent_file_change_cleanup (
 id TEXT PRIMARY KEY, backend_scope TEXT NOT NULL, account_scope TEXT NOT NULL,
 run_id TEXT NOT NULL, bytes INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS agent_file_changes_cleanup_delete AFTER DELETE ON agent_file_changes
 WHEN OLD.retained = 1 BEGIN
 INSERT OR IGNORE INTO agent_file_change_cleanup VALUES(OLD.id,OLD.backend_scope,OLD.account_scope,OLD.run_id,OLD.bytes);
END;
CREATE TRIGGER IF NOT EXISTS agent_file_changes_cleanup_expire AFTER UPDATE OF retained ON agent_file_changes
 WHEN OLD.retained = 1 AND NEW.retained = 0 BEGIN
 INSERT OR IGNORE INTO agent_file_change_cleanup VALUES(OLD.id,OLD.backend_scope,OLD.account_scope,OLD.run_id,OLD.bytes);
END;
`;

interface ChangeRow {
  id: string; operation_id: string; backend_scope: string; account_scope: string; library_id: number;
  session_id: string; run_id: string; tool_run_id: string; scope: 'library' | 'host'; path: string;
  node_id: number | null; kind: 'create' | 'update'; state: AgentFileChangeSummary['state'];
  before_revision: string | null; after_revision: string; bytes: number; retained: number;
  created_at: number; expires_at: number;
}

export interface AgentFileMutationIdentity extends AgentFileChangeScope {
  operationId: string; runId: string; toolRunId: string;
}

function exec(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}
function run(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}
function all<T>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows as T[])));
}
function hash(bytes: Uint8Array): string { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function scopeParams(scope: AgentFileChangeScope): unknown[] {
  const owner = normalizeAgentOwnerScope(scope.ownerScope);
  if (!Number.isSafeInteger(scope.libraryId) || scope.libraryId < 1 || !scope.sessionId || scope.sessionId.length > 200) throw new Error('改动记录范围无效');
  return [owner.backendScope, owner.accountScope, scope.libraryId, scope.sessionId];
}
const WHERE_SCOPE = 'backend_scope=? AND account_scope=? AND library_id=? AND session_id=?';
function summary(row: ChangeRow): AgentFileChangeSummary {
  return { id: row.id, operationId: row.operation_id, runId: row.run_id, toolRunId: row.tool_run_id,
    scope: row.scope, path: row.path, ...(row.node_id ? { nodeId: row.node_id } : {}), kind: row.kind,
    state: row.state, available: row.retained === 1, ...(row.before_revision ? { beforeRevision: row.before_revision } : {}),
    afterRevision: row.after_revision, createdAt: row.created_at };
}

export async function initializeAgentFileChangeDatabaseSchema(db: sqlite3.Database): Promise<void> { await exec(db, SCHEMA); }

export async function createAgentFileChangeStore(databasePath: string, root: string, clock = Date.now,
  diffOptions: AgentFileDiffRuntimeOptions = {}) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const anchor = await lstat(root);
  if (!anchor.isDirectory() || anchor.isSymbolicLink()) throw new Error('改动快照目录无效');
  const canonicalRoot = await realpath(root);
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(opened));
  });
  try {
    await exec(db, 'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    await agentDatabaseSchemaCoordinator.ensureReady(databasePath, 'file-changes', () => initializeAgentFileChangeDatabaseSchema(db), db);
  } catch (error) { await new Promise<void>(resolve => db.close(() => resolve())); throw error; }
  let tail = Promise.resolve();
  let closed = false;
  const active = new Map<string, string>();
  const diffRuntime = createAgentFileDiffRuntime({ clock, ...diffOptions });
  async function guard() {
    const current = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== anchor.dev || current.ino !== anchor.ino || await realpath(root) !== canonicalRoot) throw new Error('改动快照目录已变化');
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error('改动记录已关闭'));
    const next = tail.then(operation);
    tail = next.then(() => undefined, () => undefined);
    return next;
  }
  function filename(id: string, side: 'before' | 'after') {
    if (!ID.test(id)) throw new Error('快照引用无效');
    return path.join(canonicalRoot, `${id}.${side}`);
  }
  async function transaction<T>(operation: () => Promise<T>) {
    await exec(db, 'BEGIN IMMEDIATE;');
    try {
      const value = await operation();
      await exec(db, 'COMMIT;');
      return value;
    } catch (error) { await exec(db, 'ROLLBACK;').catch(() => undefined); throw error; }
  }
  async function writeSnapshot(id: string, side: 'before' | 'after', bytes: Uint8Array) {
    await guard();
    const handle = await open(filename(id, side), 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  async function readSnapshot(row: ChangeRow, side: 'before' | 'after', signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (side === 'before' && row.kind === 'create') return '';
    await guard();
    const handle = await open(filename(row.id, side), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error('历史快照无效');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
      let length = 0;
      while (length < buffer.length) {
        signal.throwIfAborted();
        const result = await handle.read(buffer, length, buffer.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      const fresh = await handle.stat();
      if (fresh.size !== stat.size || fresh.mtimeMs !== stat.mtimeMs || fresh.ctimeMs !== stat.ctimeMs || fresh.nlink !== 1) throw new Error('历史快照读取期间发生变化');
      const bytes = buffer.subarray(0, length);
      if (bytes.length > MAX_BYTES || hash(bytes) !== (side === 'before' ? row.before_revision : row.after_revision)) throw new Error('历史快照校验失败');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } finally { await handle.close(); }
  }
  async function cleanup() {
    await guard();
    const leases = [...active.keys()];
    await run(db, `UPDATE agent_file_changes SET retained=0 WHERE retained=1 AND expires_at<=?
      ${leases.length ? `AND id NOT IN (${leases.map(() => '?').join(',')})` : ''}`, [clock(), ...leases]);
    const pending = await all<{ id: string }>(db, 'SELECT id FROM agent_file_change_cleanup');
    for (const { id } of pending) {
      if (active.has(id)) continue;
      try {
        for (const side of ['before', 'after'] as const) await unlink(filename(id, side)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        await run(db, 'DELETE FROM agent_file_change_cleanup WHERE id=?', [id]);
      } catch { /* Keep deletion intent and occupied bytes until a later sweep. */ }
    }
  }
  async function prepare(identity: AgentFileMutationIdentity, snapshot: AgentFileMutationSnapshot, signal: AbortSignal) {
    return serial(async () => {
      signal.throwIfAborted();
      const params = scopeParams(identity);
      if (!ID.test(identity.operationId) || !identity.runId || !identity.toolRunId || !['library', 'host'].includes(snapshot.scope)
        || identity.runId.length > 200 || identity.toolRunId.length > 200 || !snapshot.path || snapshot.path.length > 4096
        || snapshot.afterBytes.byteLength > MAX_BYTES || (snapshot.beforeBytes?.byteLength || 0) > MAX_BYTES
        || snapshot.libraryId !== undefined && snapshot.libraryId !== identity.libraryId) throw new Error('文件改动快照无效');
      const afterHash = hash(snapshot.afterBytes);
      const beforeHash = snapshot.beforeBytes === null ? null : hash(snapshot.beforeBytes);
      if (snapshot.afterRevision !== afterHash || (snapshot.beforeRevision && snapshot.beforeRevision !== beforeHash)) throw new Error('文件快照版本不匹配');
      await cleanup();
      const bytes = snapshot.afterBytes.byteLength + (snapshot.beforeBytes?.byteLength || 0);
      const id = crypto.randomUUID();
      await transaction(async () => {
        const belongs = await all<{ id: string }>(db, `SELECT tools.id FROM agent_tool_runs tools
          JOIN agent_runs runs ON runs.id=tools.run_id JOIN agent_sessions sessions ON sessions.id=runs.session_id
          WHERE sessions.backend_scope=? AND sessions.account_scope=? AND sessions.library_id=? AND sessions.id=?
          AND runs.id=? AND tools.id=?`, [...params, identity.runId, identity.toolRunId]);
        if (!belongs.length) throw new Error('改动不属于该用户、资料库、会话或执行');
        const existing = await all<{ id: string }>(db, 'SELECT id FROM agent_file_changes WHERE operation_id=?', [identity.operationId]);
        if (existing.length) throw new Error('文件改动已准备，不能重复提交');
        const usage = await all<{ used: number; runUsed: number }>(db, `SELECT COALESCE(SUM(bytes),0) AS used,
          COALESCE(SUM(CASE WHEN run_id=? THEN bytes ELSE 0 END),0) AS runUsed FROM (
            SELECT bytes,run_id FROM agent_file_changes WHERE backend_scope=? AND account_scope=? AND retained=1
            UNION ALL SELECT bytes,run_id FROM agent_file_change_cleanup WHERE backend_scope=? AND account_scope=?)`, [identity.runId, params[0], params[1], params[0], params[1]]);
        const counts = await all<{ count: number; runCount: number }>(db, `SELECT COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN run_id=? THEN 1 ELSE 0 END),0) AS runCount FROM (
            SELECT id,run_id FROM agent_file_changes WHERE backend_scope=? AND account_scope=?
            UNION SELECT id,run_id FROM agent_file_change_cleanup WHERE backend_scope=? AND account_scope=?)`, [identity.runId, params[0], params[1], params[0], params[1]]);
        if (usage[0].used + bytes > OWNER_BYTES || usage[0].runUsed + bytes > RUN_BYTES) throw new Error('文件改动快照空间不足，尚未写入文件');
        if (counts[0].count >= OWNER_RECORDS || counts[0].runCount >= RUN_RECORDS) throw new Error('文件改动记录数量达到上限，尚未写入文件');
        // Reserve cleanup and occupied bytes before creating a physical file, including failed prepares.
        await run(db, 'INSERT INTO agent_file_change_cleanup VALUES(?,?,?,?,?)', [id, params[0], params[1], identity.runId, bytes]);
      });
      active.set(id, JSON.stringify([...params, identity.operationId, identity.runId, identity.toolRunId]));
      try {
        if (snapshot.beforeBytes !== null) await writeSnapshot(id, 'before', snapshot.beforeBytes);
        await writeSnapshot(id, 'after', snapshot.afterBytes);
        signal.throwIfAborted();
        // Unknown is durable before dispatch; a crash must never imply no write occurred.
        await transaction(async () => {
          await run(db, `INSERT INTO agent_file_changes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, identity.operationId,
            ...params.slice(0, 3), identity.sessionId, identity.runId, identity.toolRunId, snapshot.scope, snapshot.path,
            snapshot.nodeId || null, snapshot.beforeBytes === null ? 'create' : 'update', 'commit_unknown', beforeHash, afterHash,
            bytes, 1, clock(), clock() + UNKNOWN_TTL]);
          await run(db, 'DELETE FROM agent_file_change_cleanup WHERE id=?', [id]);
        });
      } catch (error) {
        active.delete(id);
        await cleanup().catch(() => undefined);
        throw error;
      }
    });
  }
  async function settle(identity: AgentFileMutationIdentity, result: AgentToolResult) {
    return serial(async () => {
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      const requestedState = data.writeCommitState || data.mutationCommitState;
      const state = typeof requestedState === 'string' && ['committed', 'uncommitted', 'commit_unknown'].includes(requestedState) ? requestedState : 'commit_unknown';
      const params = scopeParams(identity);
      const key = JSON.stringify([...params, identity.operationId, identity.runId, identity.toolRunId]);
      const lease = [...active].find(([, identityKey]) => identityKey === key);
      if (!lease) return;
      const nodeId = (data.destination as { nodeId?: number } | undefined)?.nodeId;
      try {
        await run(db, `UPDATE agent_file_changes SET state=?, node_id=COALESCE(node_id,?), expires_at=created_at+?
          WHERE id=? AND ${WHERE_SCOPE} AND operation_id=? AND run_id=? AND tool_run_id=?`, [state,
          Number.isSafeInteger(nodeId) && nodeId! > 0 ? nodeId : null, state === 'commit_unknown' ? UNKNOWN_TTL : TTL,
          lease[0], ...params, identity.operationId, identity.runId, identity.toolRunId]);
      } finally { active.delete(lease[0]); }
    });
  }
  async function list(scope: AgentFileChangeScope, runIds: string[]): Promise<AgentFileChangeList> {
    return serial(async () => {
      if (!Array.isArray(runIds) || !runIds.length || runIds.length > 16 || runIds.some(id => typeof id !== 'string' || id.length > 200)) throw new Error('执行记录范围无效');
      await cleanup();
      const rows = await all<ChangeRow>(db, `SELECT * FROM agent_file_changes WHERE ${WHERE_SCOPE} AND run_id IN (${runIds.map(() => '?').join(',')}) ORDER BY created_at,rowid LIMIT 201`, [...scopeParams(scope), ...runIds]);
      return { changes: rows.slice(0, 200).map(summary), truncated: rows.length > 200, coverage: 'structured-file-writes' };
    });
  }
  async function read(scope: AgentFileChangeScope & Partial<Pick<AgentFileDiffRequest, 'cursor' | 'pageLines'>>,
    id: string, throughId?: string, signal?: AbortSignal): Promise<AgentFileDiffResult> {
    return diffRuntime.read((readSignal, needsContent) => serial(async () => {
      readSignal.throwIfAborted();
      if (!ID.test(id) || throughId && !ID.test(throughId)) throw new Error('改动引用无效');
      await cleanup();
      const endpoints = await all<ChangeRow & { ordinal: number }>(db, `SELECT *,rowid AS ordinal FROM agent_file_changes WHERE ${WHERE_SCOPE} AND id IN (?,?)`, [...scopeParams(scope), id, throughId ?? id]);
      const first = endpoints.find(row => row.id === id);
      const last = throughId ? endpoints.find(row => row.id === throughId) : first;
      if (!first || !last || first.run_id !== last.run_id || first.scope !== last.scope || first.path !== last.path
        || first.node_id !== last.node_id || last.ordinal < first.ordinal) throw new Error('改动不属于该文件或执行');
      if (first !== last) {
        if (first.scope === 'host') throw new Error('本机路径不能证明文件身份，请查看单次操作');
        if (!first.node_id) throw new Error('资料库文件身份未知，请查看单次操作');
        const chain = await all<ChangeRow>(db, `SELECT * FROM agent_file_changes WHERE ${WHERE_SCOPE}
          AND run_id=? AND scope=? AND path=? AND rowid>=? AND rowid<=? ORDER BY rowid LIMIT ?`,
        [...scopeParams(scope), first.run_id, first.scope, first.path, first.ordinal, last.ordinal, RUN_RECORDS + 1]);
        if (chain.length > RUN_RECORDS || chain.some((row, i) => row.state !== 'committed' || row.node_id !== first.node_id
          || i > 0 && row.before_revision !== chain[i - 1].after_revision)) throw new Error('期间存在外部变化，需查看单次操作');
      }
      const result: AgentFileDiffResult = { scope: first.scope, path: first.path, state: last.state, available: first.retained === 1 && last.retained === 1,
        baseline: first === last ? 'operation' : 'run', patch: '', truncated: false };
      const key = JSON.stringify([...scopeParams(scope), first.id, last.id, first.scope, first.path, first.node_id,
        first.before_revision, last.after_revision, first.state, last.state, result.baseline]);
      if (!result.available) return { key, result: { ...result, warning: '历史差异内容已过期或清理' } };
      if (!needsContent) return { key, result };
      try {
        const before = await readSnapshot(first, 'before', readSignal);
        const after = await readSnapshot(last, 'after', readSignal);
        return { key, result, job: { before, after, beforeLabel: `a${first.path}`, afterLabel: `b${last.path}` } };
      } catch {
        readSignal.throwIfAborted();
        return { key, result: { ...result, available: false, warning: '历史快照读取或校验失败' } };
      }
    }), scope, signal);
  }
  try {
    await serial(async () => {
      await cleanup();
      // Interrupted operations retain unknown. Remove only unreferenced old snapshots.
      const known = new Set((await all<{ id: string }>(db, 'SELECT id FROM agent_file_changes UNION SELECT id FROM agent_file_change_cleanup')).map(row => row.id));
      for (const name of await readdir(canonicalRoot)) {
        const match = /^([a-f0-9-]{36})\.(before|after)$/u.exec(name);
        if (!match || known.has(match[1])) continue;
        const stat = await lstat(path.join(canonicalRoot, name));
        if (stat.mtimeMs < clock() - 60 * 60 * 1000) await unlink(path.join(canonicalRoot, name));
      }
    });
  } catch (error) {
    closed = true;
    await diffRuntime.close();
    await new Promise<void>(resolve => db.close(() => resolve()));
    throw error;
  }
  return { prepare, settle, list, read, sweep: () => serial(cleanup), async close() {
    closed = true; await diffRuntime.close(); await tail; active.clear(); await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  } };
}

export type AgentFileChangeStore = Awaited<ReturnType<typeof createAgentFileChangeStore>>;

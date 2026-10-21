import crypto from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentFileMutationSnapshot } from '../../../src/shared/agent/agent-file-write';
import type { AgentOwnerScope } from '../../../src/shared/agent/agent.types';
import { createAgentFileChangeStore, type AgentFileMutationIdentity, type AgentFileChangeStore } from './agent-file-change-store';
import { bootstrapAgentPersistenceDatabase } from './agent-persistence-runtime';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';
import { computeAgentFileDiff } from './agent-file-diff-engine';
import type { runAgentFileDiff } from './agent-file-diff-runner';

const faults = vi.hoisted(() => ({ writeAfter: false, unlink: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      if (faults.writeAfter && String(args[0]).endsWith('.after')) throw new Error('snapshot write failed');
      return actual.open(...args);
    }),
    unlink: vi.fn(async (...args: Parameters<typeof actual.unlink>) => {
      if (faults.unlink) throw Object.assign(new Error('snapshot deletion denied'), { code: 'EACCES' });
      return actual.unlink(...args);
    }),
  };
});

const OWNER: AgentOwnerScope = { backendScope: 'https://fixture.invalid/api', accountScope: 'user:7' };
const DAY = 24 * 60 * 60 * 1000;
const signal = () => new AbortController().signal;
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
function snapshot(before: string | null, after: string, options: Partial<AgentFileMutationSnapshot> = {}): AgentFileMutationSnapshot {
  return { scope: 'library', path: '/a.txt', fileName: 'a.txt', libraryId: 3, nodeId: 7,
    beforeBytes: before === null ? null : Buffer.from(before), afterBytes: Buffer.from(after),
    ...(before === null ? {} : { beforeRevision: sha(before) }), afterRevision: sha(after), ...options };
}

async function sql<T = Record<string, unknown>>(databasePath: string, statement: string, params: unknown[] = []): Promise<T[]> {
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => error ? reject(error) : resolve(opened));
  });
  try { return await new Promise((resolve, reject) => db.all(statement, params, (error, rows) => error ? reject(error) : resolve(rows as T[]))); }
  finally { await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}

describe('durable file-change store', () => {
  const stores: (AgentSessionStore | AgentFileChangeStore)[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    faults.writeAfter = false; faults.unlink = false;
    await Promise.all(stores.splice(0).map(store => store.close()));
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  });
  async function fixture(diffRun: typeof runAgentFileDiff = async (job, signal) => {
    signal.throwIfAborted(); return computeAgentFileDiff(job);
  }) {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-file-changes-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const root = path.join(directory, 'snapshots');
    let now = Date.parse('2026-10-21T00:00:00Z');
    await bootstrapAgentPersistenceDatabase(databasePath);
    const sessions = await createSQLiteAgentSessionStore(databasePath); stores.push(sessions);
    let changes = await createAgentFileChangeStore(databasePath, root, () => now, { run: diffRun }); stores.push(changes);
    async function identity(suffix = 'main', ownerScope = OWNER): Promise<AgentFileMutationIdentity> {
      const sessionId = `session-${suffix}`, runId = `run-${suffix}`, toolRunId = `tool-${suffix}`;
      if (!await sessions.getSession(sessionId, ownerScope, 3)) {
        await sessions.createSession({ id: sessionId, title: 'Synthetic fixture', ownerScope, now: new Date(now).toISOString(),
          appContext: { libraryId: 3, platform: 'darwin', selectedNodeIds: [] } });
        await sessions.createRun({ id: runId, sessionId, model: 'fixture-model', profileId: 'fixture-profile', reasoningEffort: 'auto', userPrompt: 'fixture', now: new Date(now).toISOString() });
        await sessions.createToolRun({ id: toolRunId, runId, callId: `call-${suffix}`, toolName: 'file.patch', input: {}, permissionBehavior: 'allow', status: 'running', now: new Date(now).toISOString() });
      }
      return { ownerScope, libraryId: 3, sessionId, runId, toolRunId, operationId: crypto.randomUUID() };
    }
    async function reopen() {
      await changes.close(); stores.splice(stores.indexOf(changes), 1);
      changes = await createAgentFileChangeStore(databasePath, root, () => now, { run: diffRun }); stores.push(changes);
      return changes;
    }
    return { root, databasePath, sessions, changes, identity, reopen, advance: (days: number) => { now += days * DAY; } };
  }

  it('bootstraps the schema, persists unknown before dispatch and restores exact immutable snapshots after restart', async () => {
    const f = await fixture(); const id = await f.identity();
    await f.changes.prepare(id, snapshot('before\r\n', 'after\r\n'), signal());
    const list = await f.changes.list(id, [id.runId]);
    expect(list).toMatchObject({ truncated: false, coverage: 'structured-file-writes', changes: [{ state: 'commit_unknown', available: true, beforeRevision: sha('before\r\n'), afterRevision: sha('after\r\n') }] });
    const change = list.changes[0];
    expect(await readFile(path.join(f.root, `${change.id}.before`), 'utf8')).toBe('before\r\n');
    expect(await readFile(path.join(f.root, `${change.id}.after`), 'utf8')).toBe('after\r\n');
    const reopened = await f.reopen();
    const diff = await reopened.read(id, change.id);
    expect(diff).toMatchObject({ state: 'commit_unknown', available: true, baseline: 'operation', truncated: false });
    expect(diff.patch).toContain('-before'); expect(diff.patch).toContain('+after');
    await reopened.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    expect((await reopened.list(id, [id.runId])).changes[0].state).toBe('commit_unknown');
    expect(await sql(f.databasePath, "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'agent_file_changes_cleanup_%'" )).toHaveLength(2);
  });

  it('rejects mixed owner/session/run/tool identities and isolates history reads and settlement', async () => {
    const f = await fixture(); const id = await f.identity(); const other = await f.identity('other', { ...OWNER, accountScope: 'user:8' });
    for (const invalid of [{ ...id, ownerScope: other.ownerScope }, { ...id, libraryId: 4 }, { ...id, runId: other.runId }, { ...id, toolRunId: other.toolRunId }]) {
      await expect(f.changes.prepare(invalid, snapshot('a', 'b'), signal())).rejects.toThrow();
    }
    expect(await readdir(f.root)).toEqual([]);
    await f.changes.prepare(id, snapshot('a', 'b'), signal());
    const change = (await f.changes.list(id, [id.runId])).changes[0];
    expect((await f.changes.list({ ...id, ownerScope: other.ownerScope }, [id.runId])).changes).toEqual([]);
    await expect(f.changes.read({ ...id, ownerScope: other.ownerScope }, change.id)).rejects.toThrow('不属于');
    await f.changes.settle({ ...id, toolRunId: other.toolRunId }, { ok: true, data: { writeCommitState: 'committed' } });
    expect((await f.changes.list(id, [id.runId])).changes[0].state).toBe('commit_unknown');
    await f.changes.settle(id, { ok: false });
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    expect((await f.changes.list(id, [id.runId])).changes[0].state).toBe('commit_unknown');
  });

  it('uses a seven-day committed TTL and a fourteen-day unknown TTL while protecting active preparations', async () => {
    const f = await fixture(); const committed = await f.identity();
    await f.changes.prepare(committed, snapshot('a', 'b'), signal());
    await f.changes.settle(committed, { ok: true, data: { writeCommitState: 'committed' } });
    const unknown = { ...committed, operationId: crypto.randomUUID() };
    await f.changes.prepare(unknown, snapshot('b', 'c'), signal());
    await f.changes.settle(unknown, { ok: false, data: { writeCommitState: 'commit_unknown' } });
    const active = { ...committed, operationId: crypto.randomUUID() };
    await f.changes.prepare(active, snapshot('c', 'd'), signal());
    f.advance(8);
    expect((await f.changes.list(committed, [committed.runId])).changes.map(change => [change.state, change.available])).toEqual([
      ['committed', false], ['commit_unknown', true], ['commit_unknown', true],
    ]);
    f.advance(7);
    expect((await f.changes.list(committed, [committed.runId])).changes.map(change => change.available)).toEqual([false, false, true]);
    await f.changes.settle(active, { ok: false });
    expect((await f.changes.list(committed, [committed.runId])).changes.every(change => !change.available)).toBe(true);
    expect(await readdir(f.root)).toEqual([]);
  });

  it('allows only continuous committed library node chains and rejects host pathname aggregation', async () => {
    const f = await fixture(); const id = await f.identity();
    const append = async (before: string, after: string, options?: Partial<AgentFileMutationSnapshot>, state = 'committed') => {
      const identity = { ...id, operationId: crypto.randomUUID() };
      await f.changes.prepare(identity, snapshot(before, after, options), signal());
      await f.changes.settle(identity, { ok: state === 'committed', data: { writeCommitState: state } });
      return (await f.changes.list(id, [id.runId])).changes.at(-1)!;
    };
    const first = await append('a', 'b'); const last = await append('b', 'c');
    expect(await f.changes.read(id, first.id, last.id)).toMatchObject({ baseline: 'run', available: true, state: 'committed' });
    const external = await append('outside', 'd');
    await expect(f.changes.read(id, first.id, external.id)).rejects.toThrow('外部变化');
    const replacement = await append('d', 'e', { nodeId: 8 });
    await expect(f.changes.read(id, external.id, replacement.id)).rejects.toThrow('不属于');
    const h1 = await append('x', 'y', { scope: 'host', path: '/tmp/fixture.txt', nodeId: undefined });
    const h2 = await append('y', 'z', { scope: 'host', path: '/tmp/fixture.txt', nodeId: undefined });
    await expect(f.changes.read(id, h1.id, h2.id)).rejects.toThrow('本机路径');
    expect(await f.changes.read(id, h1.id)).toMatchObject({ baseline: 'operation', available: true });
  });

  it('persists failed-prepare cleanup and occupied quota until deletion actually succeeds, including restart', async () => {
    const f = await fixture(); const id = await f.identity();
    faults.writeAfter = true; faults.unlink = true;
    await expect(f.changes.prepare(id, snapshot('before', 'after'), signal())).rejects.toThrow('write failed');
    expect((await f.changes.list(id, [id.runId])).changes).toEqual([]);
    const pending = await sql<{ id: string; bytes: number }>(f.databasePath, 'SELECT id,bytes FROM agent_file_change_cleanup');
    expect(pending).toHaveLength(1); expect(pending[0].bytes).toBe(11);
    expect(await readdir(f.root)).toEqual([`${pending[0].id}.before`]);
    await sql(f.databasePath, 'UPDATE agent_file_change_cleanup SET bytes=?', [64 * 1024 * 1024]);
    faults.writeAfter = false;
    await expect(f.changes.prepare({ ...id, operationId: crypto.randomUUID() }, snapshot('', 'new'), signal())).rejects.toThrow('空间不足');
    faults.unlink = false;
    await f.reopen();
    expect(await sql(f.databasePath, 'SELECT id FROM agent_file_change_cleanup')).toEqual([]);
    expect(await readdir(f.root)).toEqual([]);
  });

  it('records cascade cleanup in the session-deletion transaction and retries failed physical deletion', async () => {
    const f = await fixture(); const id = await f.identity();
    await f.changes.prepare(id, snapshot('a', 'b'), signal());
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    expect(await f.sessions.deleteSession(id.sessionId, id.ownerScope, 3)).toBe(true);
    expect(await sql(f.databasePath, 'SELECT id FROM agent_file_changes')).toEqual([]);
    expect(await sql(f.databasePath, 'SELECT id FROM agent_file_change_cleanup')).toHaveLength(1);
    faults.unlink = true; await f.changes.sweep();
    expect(await sql(f.databasePath, 'SELECT id FROM agent_file_change_cleanup')).toHaveLength(1);
    expect(await readdir(f.root)).toHaveLength(2);
    faults.unlink = false; await f.changes.sweep();
    expect(await sql(f.databasePath, 'SELECT id FROM agent_file_change_cleanup')).toEqual([]);
    expect(await readdir(f.root)).toEqual([]);
  });

  it('bounds metadata counts even for zero-byte/expired snapshots and reports list truncation', async () => {
    const f = await fixture(); const id = await f.identity();
    await f.changes.prepare(id, snapshot('', ''), signal());
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    await sql(f.databasePath, `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<999)
      INSERT INTO agent_file_changes SELECT printf('00000000-0000-0000-0000-%012d',x), printf('10000000-0000-0000-0000-%012d',x),
      ?,?,3,?,?,?,'library','/empty.txt',7,'update','committed',?,?,0,0,0,0 FROM n`,
    [OWNER.backendScope, OWNER.accountScope, id.sessionId, id.runId, id.toolRunId, sha(''), sha('')]);
    const list = await f.changes.list(id, [id.runId]);
    expect(list.changes).toHaveLength(200); expect(list.truncated).toBe(true);
    await expect(f.changes.prepare({ ...id, operationId: crypto.randomUUID() }, snapshot('', ''), signal())).rejects.toThrow('数量达到上限');
    const other = await f.identity('owner2', { ...OWNER, accountScope: 'user:8' });
    await expect(f.changes.prepare(other, snapshot('', ''), signal())).resolves.toBeUndefined();
  });

  it('detects changed snapshot bytes instead of returning a fabricated or current-file diff', async () => {
    const f = await fixture(); const id = await f.identity();
    await f.changes.prepare(id, snapshot('a', 'b'), signal());
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    const change = (await f.changes.list(id, [id.runId])).changes[0];
    await writeFile(path.join(f.root, `${change.id}.after`), 'tampered');
    expect(await f.changes.read(id, change.id)).toMatchObject({ available: false, patch: '', warning: '历史快照读取或校验失败' });
  });

  it('releases the store queue while a worker computes and retains normal list/settlement access', async () => {
    let finish!: () => void;
    const diffRun = vi.fn((job, operationSignal: AbortSignal) => new Promise<ReturnType<typeof computeAgentFileDiff>>(resolve => {
      finish = () => { operationSignal.throwIfAborted(); resolve(computeAgentFileDiff(job)); };
    }));
    const f = await fixture(diffRun); const id = await f.identity();
    await f.changes.prepare(id, snapshot('a', 'b'), signal());
    const change = (await f.changes.list(id, [id.runId])).changes[0];
    const reading = f.changes.read(id, change.id);
    await vi.waitFor(() => expect(diffRun).toHaveBeenCalledOnce());
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    expect((await f.changes.list(id, [id.runId])).changes[0].state).toBe('committed');
    finish(); expect((await reading).patch).toContain('+b');
  });

  it('pages a large immutable diff and rejects a cursor after its stored revision changes', async () => {
    const diffRun = vi.fn(async (job, operationSignal: AbortSignal) => {
      operationSignal.throwIfAborted(); return computeAgentFileDiff(job);
    });
    const f = await fixture(diffRun); const id = await f.identity();
    const after = Array.from({ length: 650 }, (_, index) => `${index}: ${'text'.repeat(60)}`).join('\n');
    await f.changes.prepare(id, snapshot('', after), signal());
    await f.changes.settle(id, { ok: true, data: { writeCommitState: 'committed' } });
    const change = (await f.changes.list(id, [id.runId])).changes[0];
    const first = await f.changes.read(id, change.id);
    expect(first.page!.totalPages).toBeGreaterThan(4); expect(first.truncated).toBe(false);
    let current = first; let whole = first.patch;
    while (current.page?.nextCursor) {
      current = await f.changes.read({ ...id, cursor: current.page.nextCursor }, change.id);
      whole += current.patch;
    }
    expect(whole.length).toBeGreaterThan(128 * 1024);
    expect(whole).toContain('+649:'); expect(diffRun).toHaveBeenCalledOnce();
    expect(JSON.stringify(first)).not.toContain(f.root);
    await sql(f.databasePath, 'UPDATE agent_file_changes SET after_revision=? WHERE id=?', ['c'.repeat(64), change.id]);
    await expect(f.changes.read({ ...id, cursor: first.page!.nextCursor }, change.id)).rejects.toThrow('范围已变化');
  });

  it('enforces owner-wide byte and metadata quotas across runs', async () => {
    const f = await fixture(); const id = await f.identity(); const otherRun = await f.identity('same-owner-run');
    await f.changes.prepare(otherRun, snapshot('', ''), signal());
    await f.changes.settle(otherRun, { ok: true, data: { writeCommitState: 'committed' } });
    await sql(f.databasePath, 'UPDATE agent_file_changes SET bytes=?', [512 * 1024 * 1024]);
    await expect(f.changes.prepare(id, snapshot('', 'new'), signal())).rejects.toThrow('空间不足');
    await sql(f.databasePath, 'UPDATE agent_file_changes SET bytes=0,retained=0');
    await sql(f.databasePath, `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<19999)
      INSERT INTO agent_file_changes SELECT printf('20000000-0000-0000-0000-%012d',x), printf('30000000-0000-0000-0000-%012d',x),
      ?,?,3,?,?,?,'library','/empty.txt',7,'update','committed',?,?,0,0,0,0 FROM n`,
    [OWNER.backendScope, OWNER.accountScope, otherRun.sessionId, otherRun.runId, otherRun.toolRunId, sha(''), sha('')]);
    await expect(f.changes.prepare(id, snapshot('', ''), signal())).rejects.toThrow('数量达到上限');
  });
});

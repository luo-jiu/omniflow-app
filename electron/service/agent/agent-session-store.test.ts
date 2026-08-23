import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/shared/agent/agent.types';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';

function timestamp(second: number): string {
  return `2026-08-22T12:00:${String(second).padStart(2, '0')}.000Z`;
}

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};

const OTHER_OWNER_SCOPE = {
  accountScope: 'user:8',
  backendScope: 'https://example.com/api',
};

async function createLegacyV1Database(databasePath: string): Promise<void> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.exec(`
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        library_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        context_json TEXT NOT NULL,
        last_message_preview TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agent_sessions_library_updated_idx
        ON agent_sessions (library_id, archived_at, updated_at DESC);
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
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
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agent_tool_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        result_json TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      INSERT INTO agent_sessions (
        id, library_id, title, context_json, created_at, updated_at
      ) VALUES (
        'legacy-session', 3, '旧会话', '{}', '${timestamp(0)}', '${timestamp(0)}'
      );
      PRAGMA user_version = 1;
    `, error => error ? reject(error) : resolve());
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

function message(
  sessionId: string,
  runId: string,
  sequence: number,
  role: AgentMessage['role'],
  content: string,
): AgentMessage {
  return {
    content,
    createdAt: timestamp(sequence),
    id: `${sessionId}-message-${sequence}`,
    role,
    runId,
    sessionId,
  };
}

describe('SQLite Agent session store', () => {
  const stores: AgentSessionStore[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()));
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  async function createStore(databasePath = ':memory:') {
    const store = await createSQLiteAgentSessionStore(databasePath);
    stores.push(store);
    return store;
  }

  async function createSession(
    store: AgentSessionStore,
    id: string,
    libraryId: number,
    title: string,
    ownerScope = OWNER_SCOPE,
  ) {
    return store.createSession({
      appContext: {
        currentDirectory: { id: 10, name: '测试目录' },
        libraryId,
        platform: 'darwin',
        selectedNodeIds: [],
      },
      id,
      now: timestamp(0),
      ownerScope,
      title,
    });
  }

  it('stores ordered messages and isolates sessions by library', async () => {
    const store = await createStore();
    await createSession(store, 'session-win', 3, 'Win 会话');
    await createSession(store, 'session-other', 4, '其他会话');
    await store.createRun({
      id: 'run-1',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'medium',
      sessionId: 'session-win',
      userPrompt: '列出文件',
    });
    await store.appendMessage(message('session-win', 'run-1', 3, 'assistant', '共有三个文件'));
    await store.updateRun('run-1', {
      currentStep: '已完成',
      finishedAt: timestamp(4),
      status: 'completed',
      updatedAt: timestamp(4),
    });

    expect((await store.listSessions(OWNER_SCOPE, 3)).sessions).toEqual([
      expect.objectContaining({
        id: 'session-win',
        lastMessagePreview: '共有三个文件',
        lastRunStatus: 'completed',
        messageCount: 2,
      }),
    ]);
    expect((await store.listSessions(OWNER_SCOPE, 4)).sessions).toEqual([
      expect.objectContaining({ id: 'session-other' }),
    ]);
    expect((await store.getSession('session-win', OWNER_SCOPE, 3))?.messages.map(item => item.content)).toEqual([
      '列出文件',
      '共有三个文件',
    ]);
    expect(await store.getSession('session-win', OWNER_SCOPE, 4)).toBeNull();
  });

  it('renames, searches and deletes a session without leaking wildcard matches', async () => {
    const store = await createStore();
    await createSession(store, 'session-percent', 3, '初始标题');
    await createSession(store, 'session-plain', 3, '普通标题');

    const renamed = await store.renameSession(
      'session-percent',
      OWNER_SCOPE,
      3,
      '  进度 100%   检查  ',
      timestamp(1),
    );
    expect(renamed.title).toBe('进度 100% 检查');
    expect((await store.listSessions(OWNER_SCOPE, 3, '%')).sessions.map(item => item.id))
      .toEqual(['session-percent']);
    expect(await store.deleteSession('session-percent', OWNER_SCOPE, 3)).toBe(true);
    expect(await store.getSession('session-percent', OWNER_SCOPE, 3)).toBeNull();
    expect(await store.deleteSession('session-percent', OWNER_SCOPE, 3)).toBe(false);
  });

  it('marks unfinished runs as interrupted when reopening the database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-session-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-running', 3, '运行中的会话');
    await firstStore.createRun({
      id: 'run-running',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-running',
      userPrompt: '继续执行',
    });
    await firstStore.createToolRun({
      callId: 'call-running',
      id: 'tool-running',
      input: {},
      now: timestamp(2),
      runId: 'run-running',
      toolName: 'file.list',
    });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.getSession('session-running', OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'interrupted',
    });
  });

  it('migrates v1 without assigning legacy sessions to the current account', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-session-v1-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    await createLegacyV1Database(databasePath);

    const store = await createStore(databasePath);
    expect((await store.listSessions(OWNER_SCOPE, 3)).sessions).toEqual([]);
    await createSession(store, 'scoped-session', 3, '新会话');
    expect((await store.listSessions(OWNER_SCOPE, 3)).sessions.map(item => item.id))
      .toEqual(['scoped-session']);
  });

  it('isolates matching library ids by backend and account scope', async () => {
    const store = await createStore();
    await createSession(store, 'session-owner-a', 3, '账号 A', OWNER_SCOPE);
    await createSession(store, 'session-owner-b', 3, '账号 B', OTHER_OWNER_SCOPE);

    expect((await store.listSessions(OWNER_SCOPE, 3)).sessions.map(item => item.id))
      .toEqual(['session-owner-a']);
    expect((await store.listSessions(OTHER_OWNER_SCOPE, 3)).sessions.map(item => item.id))
      .toEqual(['session-owner-b']);
    expect(await store.getSession('session-owner-b', OWNER_SCOPE, 3)).toBeNull();
  });

  it('paginates sessions with a stable cursor and reports the full count', async () => {
    const store = await createStore();
    for (let index = 0; index < 52; index += 1) {
      await store.createSession({
        appContext: {
          libraryId: 3,
          platform: 'darwin',
          selectedNodeIds: [],
        },
        id: `session-${String(index).padStart(2, '0')}`,
        now: timestamp(index),
        ownerScope: OWNER_SCOPE,
        title: `会话 ${index}`,
      });
    }

    const firstPage = await store.listSessions(OWNER_SCOPE, 3);
    expect(firstPage.sessions).toHaveLength(50);
    expect(firstPage.total).toBe(52);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await store.listSessions(
      OWNER_SCOPE,
      3,
      '',
      firstPage.nextCursor,
    );
    expect(secondPage.sessions).toHaveLength(2);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(new Set([
      ...firstPage.sessions.map(item => item.id),
      ...secondPage.sessions.map(item => item.id),
    ]).size).toBe(52);
  });
});

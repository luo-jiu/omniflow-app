import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSQLiteAgentMemoryStore, type AgentMemoryStore } from './agent-memory-store';
import {
  bootstrapAgentPersistenceDatabase,
  createAgentPersistenceRuntimeManager,
} from './agent-persistence-runtime';
import { createSQLiteAgentSessionStore, type AgentSessionStore } from './agent-session-store';
import type { AgentShellStorageRuntime } from './shell/agent-shell-storage-runtime';
import { createSQLiteAgentShellWorkspacePersistence } from './shell/agent-shell-workspace-sqlite';
import { createSQLiteAgentLocalStorageQuotaPersistence } from './storage/agent-local-storage-quota-sqlite';

const SESSION_STORE = {} as AgentSessionStore;
const MEMORY_STORE = {} as AgentMemoryStore;
const SHELL_STORAGE = {} as AgentShellStorageRuntime;

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

function get<T>(database: sqlite3.Database, sql: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get<T>(sql, (error, row) => error ? reject(error) : resolve(row));
  });
}

describe('Agent persistence runtime manager', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  it('bootstraps the complete schema before opening business connections', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-bootstrap-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');

    await bootstrapAgentPersistenceDatabase(databasePath);
    const [sessionStore, memoryStore, quotaPersistence, workspacePersistence] = await Promise.all([
      createSQLiteAgentSessionStore(databasePath),
      createSQLiteAgentMemoryStore(databasePath),
      createSQLiteAgentLocalStorageQuotaPersistence(databasePath),
      createSQLiteAgentShellWorkspacePersistence(databasePath),
    ]);

    await expect(quotaPersistence.load()).resolves.toEqual([]);
    await expect(workspacePersistence.load()).resolves.toEqual([]);
    await Promise.all([
      sessionStore.close(),
      memoryStore.close(),
      quotaPersistence.close?.(),
      workspacePersistence.close?.(),
    ]);
  });

  it('reconciles a legacy prepared action inside the production bootstrap transaction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-bootstrap-legacy-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const sessionStore = await createSQLiteAgentSessionStore(databasePath);
    const snapshotHash = 'a'.repeat(64);
    try {
      await sessionStore.createSession({
        appContext: {
          currentDirectory: { id: 10, name: '视频' },
          libraryId: 3,
          platform: 'darwin',
          selectedNodeIds: [8],
        },
        id: 'session-legacy-prepared',
        now: '2026-08-27T00:00:00.000Z',
        ownerScope: {
          accountScope: 'user:7',
          backendScope: 'https://example.com/api',
        },
        title: '旧准备动作',
      });
      await sessionStore.createRun({
        id: 'run-legacy-prepared',
        model: 'model-a',
        now: '2026-08-27T00:00:01.000Z',
        profileId: 'profile-a',
        reasoningEffort: 'auto',
        sessionId: 'session-legacy-prepared',
        userPrompt: '提取音频',
      });
      await sessionStore.createToolRun({
        callId: 'call-legacy-prepared',
        id: 'tool-legacy-prepared',
        input: {},
        now: '2026-08-27T00:00:02.000Z',
        permissionBehavior: 'allow',
        runId: 'run-legacy-prepared',
        status: 'preparing',
        toolName: 'media.extractAudio',
      });
      await sessionStore.completeToolPreparation({
        action: {
          conflictPolicy: 'auto_rename',
          destination: 'library',
          fallbackPolicy: 'prompt_local',
          kind: 'media.extractAudio',
          libraryId: 3,
          outputFileName: 'movie-audio.m4a',
          outputFormat: 'm4a',
          parentId: 10,
          sourceNodeId: 8,
          targetLabel: '视频',
          version: 1,
        },
        approvalId: 'approval-legacy-prepared',
        approvalInputHash: snapshotHash,
        approvalPreview: {
          description: '提取并上传音频',
          risk: 'write',
          title: '提取音频',
        },
        id: 'tool-legacy-prepared',
        permissionBehavior: 'allow',
        preparedActionId: 'prepared-action-legacy',
        snapshotHash,
      });
    } finally {
      await sessionStore.close();
    }

    await withDatabase(databasePath, async (database) => {
      await exec(database, `
        DROP TRIGGER agent_tool_runs_validate_preparation_insert;
        DROP TRIGGER agent_tool_runs_validate_preparation_update;
        UPDATE agent_tool_runs
        SET prepared_action_json = json_remove(
          prepared_action_json,
          '$.kind',
          '$.version'
        )
        WHERE id = 'tool-legacy-prepared';
        CREATE TRIGGER agent_tool_runs_validate_preparation_update
        BEFORE UPDATE OF prepared_action_id, prepared_action_json, prepared_snapshot_hash
        ON agent_tool_runs
        WHEN NEW.prepared_action_json IS NOT NULL
          AND json_type(NEW.prepared_action_json, '$.kind') IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'legacy prepared action rejects discriminator');
        END;
      `);
    });

    await bootstrapAgentPersistenceDatabase(databasePath);
    await withDatabase(databasePath, async (database) => {
      const row = await get<{
        prepared_action_id: string;
        prepared_action_json: string;
        prepared_snapshot_hash: string;
      }>(database, `
        SELECT prepared_action_id, prepared_action_json, prepared_snapshot_hash
        FROM agent_tool_runs
        WHERE id = 'tool-legacy-prepared'
      `);
      expect(row).toMatchObject({
        prepared_action_id: 'prepared-action-legacy',
        prepared_snapshot_hash: snapshotHash,
      });
      expect(JSON.parse(row?.prepared_action_json || '{}')).toMatchObject({
        kind: 'media.extractAudio',
        version: 1,
      });
      await expect(get<{ user_version: number }>(database, 'PRAGMA user_version'))
        .resolves.toEqual({ user_version: 2 });
    });
  });

  it('initializes every Store once and shares one complete runtime', async () => {
    const events: string[] = [];
    const manager = createAgentPersistenceRuntimeManager({
      bootstrap: async () => { events.push('bootstrap'); },
      disposeMemoryStore: async () => { events.push('dispose:memory'); },
      disposeSessionStore: async () => { events.push('dispose:session'); },
      disposeShellStorage: async () => { events.push('dispose:shell'); },
      getMemoryStore: async () => { events.push('get:memory'); return MEMORY_STORE; },
      getSessionStore: async () => { events.push('get:session'); return SESSION_STORE; },
      getShellStorage: async () => { events.push('get:shell'); return SHELL_STORAGE; },
    });

    const [first, second] = await Promise.all([manager.get(), manager.get()]);
    expect(first).toBe(second);
    expect(first).toEqual({
      memoryStore: MEMORY_STORE,
      sessionStore: SESSION_STORE,
      shellStorage: SHELL_STORAGE,
    });
    expect(events).toEqual(['bootstrap', 'get:session', 'get:memory', 'get:shell']);

    await manager.dispose();
    expect(events.slice(-3)).toEqual(['dispose:shell', 'dispose:memory', 'dispose:session']);
  });

  it('closes partial state after a failed initialization and remains retryable', async () => {
    const disposeMemoryStore = vi.fn(async () => undefined);
    const disposeSessionStore = vi.fn(async () => undefined);
    const disposeShellStorage = vi.fn(async () => undefined);
    let attempts = 0;
    const manager = createAgentPersistenceRuntimeManager({
      bootstrap: async () => undefined,
      disposeMemoryStore,
      disposeSessionStore,
      disposeShellStorage,
      getMemoryStore: async () => MEMORY_STORE,
      getSessionStore: async () => SESSION_STORE,
      getShellStorage: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('shell schema unavailable');
        return SHELL_STORAGE;
      },
    });

    await expect(manager.get()).rejects.toThrow('shell schema unavailable');
    expect(disposeShellStorage).toHaveBeenCalledTimes(1);
    expect(disposeMemoryStore).toHaveBeenCalledTimes(1);
    expect(disposeSessionStore).toHaveBeenCalledTimes(1);

    await expect(manager.get()).resolves.toMatchObject({ shellStorage: SHELL_STORAGE });
    await manager.dispose();
  });
});

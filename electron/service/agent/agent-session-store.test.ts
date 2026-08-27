import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentMessage, AgentRunPlanSnapshot } from '@/shared/agent/agent.types';
import type { AgentConversationSummaryV1 } from './agent-conversation-summary';
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

function checkpointSummary(label: string): AgentConversationSummaryV1 {
  return {
    constraintsAndPreferences: [],
    decisionsAndRationale: [],
    goalsAndIntent: [label],
    taskContext: [],
    unresolvedAndNextSteps: [],
    version: 1,
  };
}

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

async function createPreApprovalV2Database(databasePath: string): Promise<void> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.exec(`
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
        id, backend_scope, account_scope, library_id, title, context_json,
        created_at, updated_at
      ) VALUES (
        'preexisting-session',
        '${OWNER_SCOPE.backendScope}',
        '${OWNER_SCOPE.accountScope}',
        3,
        '既有会话',
        '{}',
        '${timestamp(0)}',
        '${timestamp(0)}'
      );
      INSERT INTO agent_runs (
        id, session_id, status, user_prompt, profile_id, model, reasoning_effort,
        current_step, created_at, updated_at, finished_at
      ) VALUES (
        'preexisting-run',
        'preexisting-session',
        'completed',
        '读取既有数据',
        'profile-a',
        'model-a',
        'auto',
        '已完成',
        '${timestamp(1)}',
        '${timestamp(3)}',
        '${timestamp(3)}'
      );
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, result_json, status,
        created_at, finished_at
      ) VALUES
        (
          'preexisting-tool-first',
          'preexisting-run',
          'preexisting-call-first',
          'file.list',
          '{}',
          '{"ok":true}',
          'completed',
          '${timestamp(2)}',
          '${timestamp(3)}'
        ),
        (
          'preexisting-tool-second',
          'preexisting-run',
          'preexisting-call-second',
          'file.stat',
          '{}',
          '{"ok":true}',
          'completed',
          '${timestamp(2)}',
          '${timestamp(3)}'
        );
      PRAGMA user_version = 2;
    `, error => error ? reject(error) : resolve());
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

async function setDatabaseVersion(databasePath: string, version: number): Promise<void> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.exec(`PRAGMA user_version = ${version}`, error => (
      error ? reject(error) : resolve()
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

async function executeDatabaseSql(databasePath: string, sql: string): Promise<void> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      database.exec(sql, error => error ? reject(error) : resolve());
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });
  }
}

async function runDatabaseSql(
  databasePath: string,
  sql: string,
  parameters: unknown[] = [],
): Promise<void> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      database.run(sql, parameters, error => error ? reject(error) : resolve());
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });
  }
}

async function readDatabaseVersion(databasePath: string): Promise<number> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  const version = await new Promise<{ user_version: number }>((resolve, reject) => {
    database.get('PRAGMA user_version', (error, row) => (
      error ? reject(error) : resolve(row as { user_version: number })
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
  return version.user_version;
}

async function readDatabaseRow<T>(
  databasePath: string,
  sql: string,
  parameters: unknown[] = [],
): Promise<T | undefined> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  const row = await new Promise<T | undefined>((resolve, reject) => {
    database.get<T>(sql, parameters, (error, value) => (
      error ? reject(error) : resolve(value)
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
  return row;
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

function runPlan(
  createdAt = timestamp(2),
  steps: AgentRunPlanSnapshot['steps'] = [
    {
      expectedToolName: 'file.list',
      id: 'plan-step-list',
      ordinal: 1,
      title: '读取目录',
    },
    {
      expectedToolName: 'file.stat',
      id: 'plan-step-stat',
      ordinal: 2,
      title: '检查文件',
    },
  ],
): AgentRunPlanSnapshot {
  return {
    createdAt,
    steps,
    title: '检查目录内容',
    version: 1,
  };
}

function preparedAction(outputFileName = 'movie-audio.m4a') {
  return {
    conflictPolicy: 'auto_rename' as const,
    destination: 'library' as const,
    fallbackPolicy: 'prompt_local' as const,
    kind: 'media.extractAudio' as const,
    libraryId: 3,
    outputFileName,
    outputFormat: 'm4a' as const,
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: 1 as const,
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

  async function createStoredPreparedAction(
    databasePath: string,
    suffix: string,
    hashCharacter: string,
  ) {
    const store = await createStore(databasePath);
    const sessionId = `session-prepared-${suffix}`;
    const runId = `run-prepared-${suffix}`;
    const toolId = `tool-prepared-${suffix}`;
    const preparedActionId = `prepared-action-${suffix}`;
    const snapshotHash = hashCharacter.repeat(64);
    await createSession(store, sessionId, 3, `准备动作 ${suffix}`);
    await store.createRun({
      id: runId,
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId,
      userPrompt: '提取音频',
    });
    await store.createToolRun({
      callId: `call-prepared-${suffix}`,
      id: toolId,
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId,
      status: 'preparing',
      toolName: 'media.extractAudio',
    });
    await store.completeToolPreparation({
      action: preparedAction(`${suffix}.m4a`),
      approvalId: `approval-prepared-${suffix}`,
      approvalInputHash: snapshotHash,
      approvalPreview: {
        description: '提取并上传音频',
        risk: 'write',
        title: '提取音频',
      },
      id: toolId,
      permissionBehavior: 'allow',
      preparedActionId,
      snapshotHash,
    });
    await store.completeToolRun(
      toolId,
      { message: '音频提取完成', ok: true },
      timestamp(3),
    );
    await store.updateRun(runId, {
      currentStep: '已完成',
      finishedAt: timestamp(3),
      status: 'completed',
      updatedAt: timestamp(3),
    });
    await store.close();
    stores.splice(stores.indexOf(store), 1);
    return { preparedActionId, sessionId, snapshotHash, toolId };
  }

  async function restoreLegacyPreparedActionSchema(
    databasePath: string,
    toolIds: readonly string[],
  ): Promise<void> {
    await executeDatabaseSql(databasePath, `
      DROP TRIGGER IF EXISTS agent_tool_runs_validate_preparation_insert;
      DROP TRIGGER IF EXISTS agent_tool_runs_validate_preparation_update;
    `);
    for (const toolId of toolIds) {
      await runDatabaseSql(databasePath, `
        UPDATE agent_tool_runs
        SET prepared_action_json = json_remove(
          prepared_action_json,
          '$.kind',
          '$.version'
        )
        WHERE id = ?
      `, [toolId]);
    }
    await executeDatabaseSql(databasePath, `
      CREATE TRIGGER agent_tool_runs_validate_preparation_insert
      BEFORE INSERT ON agent_tool_runs
      WHEN NEW.prepared_action_json IS NOT NULL
        AND (
          json_type(NEW.prepared_action_json, '$.kind') IS NOT NULL
          OR json_type(NEW.prepared_action_json, '$.version') IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'Legacy Agent prepared action has unknown fields');
      END;
      CREATE TRIGGER agent_tool_runs_validate_preparation_update
      BEFORE UPDATE OF prepared_action_id, prepared_action_json, prepared_snapshot_hash
      ON agent_tool_runs
      WHEN NEW.prepared_action_json IS NOT NULL
        AND (
          json_type(NEW.prepared_action_json, '$.kind') IS NOT NULL
          OR json_type(NEW.prepared_action_json, '$.version') IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'Legacy Agent prepared action has unknown fields');
      END;
    `);
  }

  async function createCompletedTurn(
    store: AgentSessionStore,
    sessionId: string,
    runId: string,
    startSecond: number,
  ) {
    await store.createRun({
      id: runId,
      model: 'model-a',
      now: timestamp(startSecond),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId,
      userPrompt: `问题 ${runId}`,
    });
    const assistantMessage = message(
      sessionId,
      runId,
      startSecond + 1,
      'assistant',
      `回答 ${runId}`,
    );
    await store.appendMessage(assistantMessage);
    await store.updateRun(runId, {
      currentStep: '已完成',
      finishedAt: timestamp(startSecond + 2),
      status: 'completed',
      updatedAt: timestamp(startSecond + 2),
    });
    return {
      assistantMessageId: assistantMessage.id,
      userMessageId: `${runId}:user`,
    };
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
    const snapshot = await store.getSession('session-win', OWNER_SCOPE, 3);
    expect(snapshot?.messages.map(item => item.content)).toEqual([
      '列出文件',
      '共有三个文件',
    ]);
    expect(snapshot?.runs).toEqual([expect.objectContaining({
      currentStep: '已完成',
      id: 'run-1',
      model: 'model-a',
      profileId: 'profile-a',
      reasoningEffort: 'medium',
      status: 'completed',
      userPrompt: '列出文件',
    })]);
    expect(await store.getSession('session-win', OWNER_SCOPE, 4)).toBeNull();
  });

  it('persists one owner-scoped checkpoint without changing the Session projection', async () => {
    const store = await createStore();
    await createSession(store, 'session-checkpoint-owner', 3, '压缩会话');
    await createSession(
      store,
      'session-checkpoint-other-owner',
      3,
      '其他账号会话',
      OTHER_OWNER_SCOPE,
    );
    const turn = await createCompletedTurn(
      store,
      'session-checkpoint-owner',
      'run-checkpoint-owner',
      1,
    );
    const otherTurn = await createCompletedTurn(
      store,
      'session-checkpoint-other-owner',
      'run-checkpoint-other-owner',
      4,
    );
    const before = await store.getSession('session-checkpoint-owner', OWNER_SCOPE, 3);

    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-wrong-owner',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(7),
      ownerScope: OTHER_OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-owner',
      throughMessageId: turn.assistantMessageId,
    })).rejects.toThrow('会话或消息边界无效');
    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-cross-session-boundary',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(7),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-owner',
      throughMessageId: otherTurn.assistantMessageId,
    })).rejects.toThrow('会话或消息边界无效');
    expect(await store.readContextCheckpointState(
      'session-checkpoint-owner',
      OTHER_OWNER_SCOPE,
      3,
    )).toBeNull();

    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-owner',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(7),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-owner',
      throughMessageId: turn.assistantMessageId,
    })).resolves.toMatchObject({
      id: 'checkpoint-owner',
      status: 'started',
      throughMessageId: turn.assistantMessageId,
      throughSequence: 2,
    });
    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-owner-concurrent',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(8),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-owner',
      throughMessageId: turn.assistantMessageId,
    })).rejects.toThrow('已有压缩任务正在进行');
    const summary = checkpointSummary('检查当前目录');
    await expect(store.completeContextCheckpoint(
      'checkpoint-owner',
      summary,
      timestamp(9),
    )).resolves.toMatchObject({
      finishedAt: timestamp(9),
      status: 'completed',
      summary,
    });
    expect(await store.readContextCheckpointState(
      'session-checkpoint-owner',
      OWNER_SCOPE,
      3,
    )).toEqual({
      consecutiveFailureCount: 0,
      latestCompleted: expect.objectContaining({
        id: 'checkpoint-owner',
        summary,
        throughSequence: 2,
      }),
    });

    const after = await store.getSession('session-checkpoint-owner', OWNER_SCOPE, 3);
    expect(after).toMatchObject({
      lastMessagePreview: before?.lastMessagePreview,
      messageCount: before?.messageCount,
      updatedAt: before?.updatedAt,
    });
  });

  it('advances checkpoints only across complete terminal Runs from the latest base', async () => {
    const store = await createStore();
    await createSession(store, 'session-checkpoint-boundary', 3, '边界会话');
    await store.createRun({
      id: 'run-checkpoint-active',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-checkpoint-boundary',
      userPrompt: '仍在运行',
    });
    const activeAssistant = message(
      'session-checkpoint-boundary',
      'run-checkpoint-active',
      2,
      'assistant',
      '尚未收口',
    );
    await store.appendMessage(activeAssistant);
    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-active-run',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(3),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-boundary',
      throughMessageId: activeAssistant.id,
    })).rejects.toThrow('cannot include an active Run');

    await store.updateRun('run-checkpoint-active', {
      currentStep: '已完成',
      finishedAt: timestamp(3),
      status: 'completed',
      updatedAt: timestamp(3),
    });
    await expect(store.beginContextCheckpoint({
      id: 'checkpoint-split-run',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(4),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-boundary',
      throughMessageId: 'run-checkpoint-active:user',
    })).rejects.toThrow('cannot split a Run');
    await store.beginContextCheckpoint({
      id: 'checkpoint-boundary-first',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(4),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-boundary',
      throughMessageId: activeAssistant.id,
    });
    await store.completeContextCheckpoint(
      'checkpoint-boundary-first',
      checkpointSummary('第一轮'),
      timestamp(5),
    );

    await createSession(store, 'session-checkpoint-foreign-base', 3, '其他链路');
    const foreignTurn = await createCompletedTurn(
      store,
      'session-checkpoint-foreign-base',
      'run-checkpoint-foreign-base',
      6,
    );
    await store.beginContextCheckpoint({
      id: 'checkpoint-foreign-base',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(9),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-foreign-base',
      throughMessageId: foreignTurn.assistantMessageId,
    });
    await store.completeContextCheckpoint(
      'checkpoint-foreign-base',
      checkpointSummary('其他会话'),
      timestamp(10),
    );

    const secondTurn = await createCompletedTurn(
      store,
      'session-checkpoint-boundary',
      'run-checkpoint-second',
      11,
    );
    const nextInput = {
      libraryId: 3,
      model: 'model-a',
      now: timestamp(14),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-boundary',
      throughMessageId: secondTurn.assistantMessageId,
    };
    await expect(store.beginContextCheckpoint({
      ...nextInput,
      id: 'checkpoint-missing-base',
    })).rejects.toThrow('base is stale');
    await expect(store.beginContextCheckpoint({
      ...nextInput,
      baseCheckpointId: 'checkpoint-foreign-base',
      id: 'checkpoint-cross-session-base',
    })).rejects.toThrow('base is stale');
    await expect(store.beginContextCheckpoint({
      ...nextInput,
      baseCheckpointId: 'checkpoint-boundary-first',
      id: 'checkpoint-non-advancing',
      throughMessageId: activeAssistant.id,
    })).rejects.toThrow('boundary must advance');

    await store.beginContextCheckpoint({
      ...nextInput,
      baseCheckpointId: 'checkpoint-boundary-first',
      id: 'checkpoint-boundary-second',
    });
    await store.completeContextCheckpoint(
      'checkpoint-boundary-second',
      checkpointSummary('第二轮'),
      timestamp(15),
    );
    const thirdTurn = await createCompletedTurn(
      store,
      'session-checkpoint-boundary',
      'run-checkpoint-third',
      16,
    );
    await expect(store.beginContextCheckpoint({
      baseCheckpointId: 'checkpoint-boundary-first',
      id: 'checkpoint-stale-base',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(19),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-boundary',
      throughMessageId: thirdTurn.assistantMessageId,
    })).rejects.toThrow('base is stale');
  });

  it('counts only failed attempts since the latest completed checkpoint', async () => {
    const store = await createStore();
    await createSession(store, 'session-checkpoint-failures', 3, '失败计数');
    const firstTurn = await createCompletedTurn(
      store,
      'session-checkpoint-failures',
      'run-checkpoint-failures-first',
      1,
    );
    const checkpointInput = {
      libraryId: 3,
      model: 'model-a',
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-failures',
      throughMessageId: firstTurn.assistantMessageId,
    };

    await store.beginContextCheckpoint({
      ...checkpointInput,
      id: 'checkpoint-failed-first',
      now: timestamp(4),
    });
    await store.failContextCheckpoint('checkpoint-failed-first', timestamp(5));
    await store.beginContextCheckpoint({
      ...checkpointInput,
      id: 'checkpoint-interrupted',
      now: timestamp(6),
    });
    await store.failContextCheckpoint(
      'checkpoint-interrupted',
      timestamp(7),
      'interrupted',
    );
    await store.beginContextCheckpoint({
      ...checkpointInput,
      id: 'checkpoint-failed-second',
      now: timestamp(8),
    });
    await store.failContextCheckpoint('checkpoint-failed-second', timestamp(9));
    expect(await store.readContextCheckpointState(
      'session-checkpoint-failures',
      OWNER_SCOPE,
      3,
    )).toEqual({ consecutiveFailureCount: 2 });

    await store.beginContextCheckpoint({
      ...checkpointInput,
      id: 'checkpoint-completed-reset',
      now: timestamp(10),
    });
    await expect(store.completeContextCheckpoint(
      'checkpoint-completed-reset',
      '   ',
      timestamp(11),
    )).rejects.toThrow('摘要不能为空');
    await expect(store.completeContextCheckpoint(
      'checkpoint-completed-reset',
      'x'.repeat((64 * 1024) + 1),
      timestamp(11),
    )).rejects.toThrow('不符合 V1 契约');
    await expect(store.completeContextCheckpoint(
      'checkpoint-completed-reset',
      { goal: '旧版任意 JSON 不能落库', version: 1 },
      timestamp(11),
    )).rejects.toThrow('不符合 V1 契约');
    await store.completeContextCheckpoint(
      'checkpoint-completed-reset',
      checkpointSummary('已恢复'),
      timestamp(11),
    );
    await expect(store.completeContextCheckpoint(
      'checkpoint-completed-reset',
      checkpointSummary('重复发布'),
      timestamp(12),
    )).rejects.toThrow('不存在或已经结束');
    expect(await store.readContextCheckpointState(
      'session-checkpoint-failures',
      OWNER_SCOPE,
      3,
    )).toMatchObject({
      consecutiveFailureCount: 0,
      latestCompleted: { id: 'checkpoint-completed-reset', status: 'completed' },
    });

    const secondTurn = await createCompletedTurn(
      store,
      'session-checkpoint-failures',
      'run-checkpoint-failures-second',
      13,
    );
    await store.beginContextCheckpoint({
      ...checkpointInput,
      baseCheckpointId: 'checkpoint-completed-reset',
      id: 'checkpoint-failed-after-success',
      now: timestamp(16),
      throughMessageId: secondTurn.assistantMessageId,
    });
    await store.failContextCheckpoint('checkpoint-failed-after-success', timestamp(17));
    expect(await store.readContextCheckpointState(
      'session-checkpoint-failures',
      OWNER_SCOPE,
      3,
    )).toMatchObject({ consecutiveFailureCount: 1 });
  });

  it('interrupts an incomplete checkpoint on reopen without activating or counting it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-checkpoint-recovery-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-checkpoint-recovery', 3, '压缩恢复');
    const turn = await createCompletedTurn(
      firstStore,
      'session-checkpoint-recovery',
      'run-checkpoint-recovery',
      1,
    );
    await firstStore.beginContextCheckpoint({
      id: 'checkpoint-recovery-started',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(4),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-recovery',
      throughMessageId: turn.assistantMessageId,
    });
    expect(await firstStore.readContextCheckpointState(
      'session-checkpoint-recovery',
      OWNER_SCOPE,
      3,
    )).toEqual({ consecutiveFailureCount: 0 });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.readContextCheckpointState(
      'session-checkpoint-recovery',
      OWNER_SCOPE,
      3,
    )).toEqual({ consecutiveFailureCount: 0 });
    expect(await readDatabaseRow<{ finished_at: string | null; status: string }>(
      databasePath,
      `SELECT status, finished_at
       FROM agent_context_checkpoints
       WHERE id = ?`,
      ['checkpoint-recovery-started'],
    )).toMatchObject({ finished_at: expect.any(String), status: 'interrupted' });

    await reopenedStore.beginContextCheckpoint({
      id: 'checkpoint-recovery-retry',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(5),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-recovery',
      throughMessageId: turn.assistantMessageId,
    });
    await reopenedStore.completeContextCheckpoint(
      'checkpoint-recovery-retry',
      checkpointSummary('恢复后重试'),
      timestamp(6),
    );
    expect(await reopenedStore.readContextCheckpointState(
      'session-checkpoint-recovery',
      OWNER_SCOPE,
      3,
    )).toMatchObject({
      consecutiveFailureCount: 0,
      latestCompleted: { id: 'checkpoint-recovery-retry', status: 'completed' },
    });
  });

  it('quarantines a semantically invalid completed checkpoint without blocking the valid chain', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-checkpoint-quarantine-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-checkpoint-quarantine', 3, '损坏摘要隔离');
    const firstTurn = await createCompletedTurn(
      firstStore,
      'session-checkpoint-quarantine',
      'run-checkpoint-quarantine-first',
      1,
    );
    await firstStore.beginContextCheckpoint({
      id: 'checkpoint-quarantine-valid',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(4),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-quarantine',
      throughMessageId: firstTurn.assistantMessageId,
    });
    await firstStore.completeContextCheckpoint(
      'checkpoint-quarantine-valid',
      checkpointSummary('有效摘要'),
      timestamp(5),
    );
    const secondTurn = await createCompletedTurn(
      firstStore,
      'session-checkpoint-quarantine',
      'run-checkpoint-quarantine-second',
      6,
    );
    await firstStore.beginContextCheckpoint({
      baseCheckpointId: 'checkpoint-quarantine-valid',
      id: 'checkpoint-quarantine-invalid',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(9),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-quarantine',
      throughMessageId: secondTurn.assistantMessageId,
    });
    await firstStore.completeContextCheckpoint(
      'checkpoint-quarantine-invalid',
      checkpointSummary('即将被模拟损坏'),
      timestamp(10),
    );
    const thirdTurn = await createCompletedTurn(
      firstStore,
      'session-checkpoint-quarantine',
      'run-checkpoint-quarantine-third',
      11,
    );
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    await executeDatabaseSql(databasePath, `
      DROP TRIGGER agent_context_checkpoints_validate_transition;
      UPDATE agent_context_checkpoints
      SET summary_json = '{"goal":"损坏摘要","version":1}'
      WHERE id = 'checkpoint-quarantine-invalid';
    `);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.readContextCheckpointState(
      'session-checkpoint-quarantine',
      OWNER_SCOPE,
      3,
    )).toMatchObject({
      consecutiveFailureCount: 1,
      latestCompleted: { id: 'checkpoint-quarantine-valid' },
    });
    expect(await readDatabaseRow<{ status: string; summary_json: string | null }>(
      databasePath,
      `SELECT status, summary_json
       FROM agent_context_checkpoints
       WHERE id = 'checkpoint-quarantine-invalid'`,
    )).toEqual({ status: 'failed', summary_json: null });
    await expect(reopenedStore.beginContextCheckpoint({
      baseCheckpointId: 'checkpoint-quarantine-valid',
      id: 'checkpoint-quarantine-recovered',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(14),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-quarantine',
      throughMessageId: thirdTurn.assistantMessageId,
    })).resolves.toMatchObject({ status: 'started' });
  });

  it('deletes checkpoint history only through the owning Session cascade', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-checkpoint-cascade-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const store = await createStore(databasePath);
    await createSession(store, 'session-checkpoint-cascade', 3, '级联删除');
    const turn = await createCompletedTurn(
      store,
      'session-checkpoint-cascade',
      'run-checkpoint-cascade',
      1,
    );
    await store.beginContextCheckpoint({
      id: 'checkpoint-cascade',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(4),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-cascade',
      throughMessageId: turn.assistantMessageId,
    });
    await store.completeContextCheckpoint(
      'checkpoint-cascade',
      checkpointSummary('等待删除'),
      timestamp(5),
    );
    const nextTurn = await createCompletedTurn(
      store,
      'session-checkpoint-cascade',
      'run-checkpoint-cascade-next',
      6,
    );
    await store.beginContextCheckpoint({
      baseCheckpointId: 'checkpoint-cascade',
      id: 'checkpoint-cascade-child',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(9),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'session-checkpoint-cascade',
      throughMessageId: nextTurn.assistantMessageId,
    });
    await store.completeContextCheckpoint(
      'checkpoint-cascade-child',
      checkpointSummary('等待级联删除'),
      timestamp(10),
    );

    expect(await store.deleteSession(
      'session-checkpoint-cascade',
      OTHER_OWNER_SCOPE,
      3,
    )).toBe(false);
    expect(await store.deleteSession(
      'session-checkpoint-cascade',
      OWNER_SCOPE,
      3,
    )).toBe(true);
    expect(await readDatabaseRow<{ checkpoint_count: number }>(
      databasePath,
      'SELECT COUNT(*) AS checkpoint_count FROM agent_context_checkpoints',
    )).toEqual({ checkpoint_count: 0 });
  });

  it('orders Tools and versions Run updates independently from wall-clock time', async () => {
    const store = await createStore();
    await createSession(store, 'session-ordered-tools', 3, '顺序测试');
    await expect(store.createRun({
      id: 'run-ordered-tools',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'medium',
      sessionId: 'session-ordered-tools',
      userPrompt: '读取两项信息',
    })).resolves.toMatchObject({ revision: 1 });
    await expect(store.createToolRun({
      callId: 'call-first',
      id: 'tool-first',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-ordered-tools',
      status: 'running',
      toolName: 'file.list',
    })).resolves.toMatchObject({ ordinal: 1, revision: 1 });
    await expect(store.completeToolRun('tool-first', { ok: true }, timestamp(3)))
      .resolves.toMatchObject({ revision: 2 });
    await expect(store.createToolRun({
      callId: 'call-second',
      id: 'tool-second',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-ordered-tools',
      status: 'running',
      toolName: 'file.stat',
    })).resolves.toMatchObject({ ordinal: 2, revision: 1 });
    await expect(store.completeToolRun('tool-second', { ok: true }, timestamp(4)))
      .resolves.toMatchObject({ revision: 2 });
    await expect(store.updateRun('run-ordered-tools', {
      currentStep: '根据工具结果继续思考',
      status: 'running',
      updatedAt: timestamp(4),
    })).resolves.toMatchObject({ revision: 2, updatedAt: timestamp(4) });
    await expect(store.updateRun('run-ordered-tools', {
      currentStep: '相同时间的等待状态',
      status: 'awaiting_approval',
      updatedAt: timestamp(4),
    })).resolves.toMatchObject({ revision: 3, updatedAt: timestamp(4) });
    await expect(store.updateRun('run-ordered-tools', {
      currentStep: '时钟回拨后继续运行',
      status: 'running',
      updatedAt: timestamp(3),
    })).resolves.toMatchObject({ revision: 4, updatedAt: timestamp(3) });
    await expect(store.updateRun('run-ordered-tools', {
      currentStep: '已完成',
      finishedAt: timestamp(5),
      status: 'completed',
      updatedAt: timestamp(5),
    })).resolves.toMatchObject({ revision: 5 });

    const snapshot = await store.getSession('session-ordered-tools', OWNER_SCOPE, 3);
    expect(snapshot?.toolActivities.map(activity => [activity.id, activity.ordinal])).toEqual([
      ['tool-first', 1],
      ['tool-second', 2],
    ]);
    await expect(store.updateRun('run-ordered-tools', {
      currentStep: '迟到更新',
      status: 'running',
      updatedAt: timestamp(6),
    })).rejects.toThrow('已经结束');
    expect((await store.getSession('session-ordered-tools', OWNER_SCOPE, 3))?.runs[0])
      .toMatchObject({ revision: 5, status: 'completed' });
  });

  it('sets one immutable Run plan before the first Tool and versions the canonical Run', async () => {
    const store = await createStore();
    await createSession(store, 'session-plan-once', 3, '一次性计划');
    const createdRun = await store.createRun({
      capabilityIdentity: `v2:${'a'.repeat(64)}`,
      id: 'run-plan-once',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'medium',
      sessionId: 'session-plan-once',
      skillCatalogRevision: 2,
      toolCatalogRevision: 7,
      userPrompt: '检查目录和文件',
    });
    expect(createdRun).toMatchObject({
      capabilityIdentity: `v2:${'a'.repeat(64)}`,
      revision: 1,
      skillCatalogRevision: 2,
      toolCatalogRevision: 7,
    });
    expect(createdRun).not.toHaveProperty('plan');

    const plan = runPlan();
    await expect(store.setRunPlan('run-plan-once', plan)).resolves.toMatchObject({
      plan,
      revision: 2,
      updatedAt: plan.createdAt,
    });
    await expect(store.setRunPlan('run-plan-once', runPlan(timestamp(3))))
      .rejects.toThrow('首个 Tool 前设置一次');

    await createSession(store, 'session-plan-after-tool', 3, 'Tool 后计划');
    await store.createRun({
      id: 'run-plan-after-tool',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-after-tool',
      userPrompt: '先读取目录',
    });
    await store.createToolRun({
      callId: 'call-before-plan',
      id: 'tool-before-plan',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-plan-after-tool',
      status: 'running',
      toolName: 'file.list',
    });
    await expect(store.setRunPlan('run-plan-after-tool', runPlan(timestamp(3))))
      .rejects.toThrow('首个 Tool 前设置一次');

    await createSession(store, 'session-plan-terminal', 3, '终态计划');
    await store.createRun({
      id: 'run-plan-terminal',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-terminal',
      userPrompt: '结束任务',
    });
    await store.updateRun('run-plan-terminal', {
      currentStep: '已完成',
      finishedAt: timestamp(2),
      status: 'completed',
      updatedAt: timestamp(2),
    });
    await expect(store.setRunPlan('run-plan-terminal', runPlan(timestamp(3))))
      .rejects.toThrow('首个 Tool 前设置一次');
  });

  it('allows a plan after Skill activation without binding the control Tool to a plan step', async () => {
    const store = await createStore();
    await createSession(store, 'session-plan-after-skill', 3, 'Skill 后计划');
    await store.createRun({
      id: 'run-plan-after-skill',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-after-skill',
      userPrompt: '先加载流程，再执行计划',
    });
    const activation = await store.createToolRun({
      callId: 'call-activate-before-plan',
      id: 'tool-activate-before-plan',
      input: { skillId: 'media-extract-audio' },
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-plan-after-skill',
      status: 'running',
      toolKind: 'control',
      toolName: 'test.control',
    });
    expect(activation).not.toHaveProperty('planStepId');
    await store.completeToolRun(activation.id, { ok: true }, timestamp(3));

    const plan = runPlan(timestamp(4));
    await expect(store.setRunPlan('run-plan-after-skill', plan)).resolves.toMatchObject({
      plan,
    });
    const firstBusinessTool = await store.createToolRun({
      callId: 'call-list-after-skill-plan',
      id: 'tool-list-after-skill-plan',
      input: {},
      now: timestamp(5),
      permissionBehavior: 'allow',
      runId: 'run-plan-after-skill',
      status: 'running',
      toolName: 'file.list',
    });
    expect(firstBusinessTool.planStepId).toBe(plan.steps[0].id);
  });

  it('associates only the next matching planned Tool without consuming a step on deviation', async () => {
    const store = await createStore();
    await createSession(store, 'session-plan-order', 3, '计划顺序');
    await store.createRun({
      id: 'run-plan-order',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-order',
      userPrompt: '按顺序检查目录',
    });
    const plan = runPlan(timestamp(2), [
      {
        expectedToolName: 'file.list',
        id: 'plan-step-list-first',
        ordinal: 1,
        title: '首次读取目录',
      },
      {
        expectedToolName: 'file.stat',
        id: 'plan-step-stat',
        ordinal: 2,
        title: '检查文件',
      },
      {
        expectedToolName: 'file.list',
        id: 'plan-step-list-last',
        ordinal: 3,
        title: '再次确认目录',
      },
    ]);
    await store.setRunPlan('run-plan-order', plan);

    const createTool = (
      id: string,
      toolName: string,
      second: number,
    ) => store.createToolRun({
      callId: `call-${id}`,
      id,
      input: {},
      now: timestamp(second),
      permissionBehavior: 'allow',
      runId: 'run-plan-order',
      status: 'running',
      toolName,
    });

    const firstDeviation = await createTool('tool-deviation-first', 'file.stat', 3);
    expect(firstDeviation).toMatchObject({ ordinal: 1 });
    expect(firstDeviation).not.toHaveProperty('planStepId');
    await expect(createTool('tool-plan-first', 'file.list', 4))
      .resolves.toMatchObject({ ordinal: 2, planStepId: 'plan-step-list-first' });
    const secondDeviation = await createTool('tool-deviation-second', 'file.list', 5);
    expect(secondDeviation).toMatchObject({ ordinal: 3 });
    expect(secondDeviation).not.toHaveProperty('planStepId');
    await expect(createTool('tool-plan-second', 'file.stat', 6))
      .resolves.toMatchObject({ ordinal: 4, planStepId: 'plan-step-stat' });
    await expect(createTool('tool-plan-third', 'file.list', 7))
      .resolves.toMatchObject({ ordinal: 5, planStepId: 'plan-step-list-last' });
    const afterPlan = await createTool('tool-after-plan', 'file.list', 8);
    expect(afterPlan).toMatchObject({ ordinal: 6 });
    expect(afterPlan).not.toHaveProperty('planStepId');

    const snapshot = await store.getSession('session-plan-order', OWNER_SCOPE, 3);
    expect(snapshot?.runs[0].plan).toEqual(plan);
    expect(snapshot?.toolActivities.map(activity => activity.planStepId)).toEqual([
      undefined,
      'plan-step-list-first',
      undefined,
      'plan-step-stat',
      'plan-step-list-last',
      undefined,
    ]);
  });

  it('refuses a completed Run with an open Tool and closes open Tools on failure', async () => {
    const store = await createStore();
    await createSession(store, 'session-run-failure', 3, '失败收口');
    await store.createRun({
      id: 'run-failure',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'medium',
      sessionId: 'session-run-failure',
      userPrompt: '执行任务',
    });
    await store.createToolRun({
      callId: 'call-open',
      id: 'tool-open',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-failure',
      status: 'running',
      toolName: 'file.list',
    });
    await store.createToolRun({
      approvalId: 'approval-open',
      approvalInputHash: 'approval-open-hash',
      approvalPreview: {
        description: '等待确认',
        risk: 'write',
        title: '确认操作',
      },
      callId: 'call-approval-open',
      id: 'tool-approval-open',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'ask',
      runId: 'run-failure',
      status: 'awaiting_approval',
      toolName: 'directory.create',
    });
    await store.createToolRun({
      callId: 'call-interaction-open',
      id: 'tool-interaction-open',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-failure',
      status: 'running',
      toolName: 'interaction.request',
    });
    await expect(store.createToolInteraction(
      'tool-interaction-open',
      'interaction-open',
      {
        kind: 'choice',
        options: [
          { id: 'continue', label: '继续' },
          { id: 'stop', label: '停止' },
        ],
        prompt: '是否继续？',
      },
    )).resolves.toMatchObject({ revision: 2, status: 'awaiting_interaction' });

    await expect(store.updateRun('run-failure', {
      currentStep: '已完成',
      finishedAt: timestamp(3),
      status: 'completed',
      updatedAt: timestamp(3),
    })).rejects.toThrow('仍有未完成 Tool');
    await store.updateRun('run-failure', {
      currentStep: '执行失败',
      error: '测试失败',
      finishedAt: timestamp(4),
      status: 'failed',
      updatedAt: timestamp(4),
    });

    const snapshot = await store.getSession('session-run-failure', OWNER_SCOPE, 3);
    expect(snapshot?.runs).toEqual([
      expect.objectContaining({ id: 'run-failure', revision: 2, status: 'failed' }),
    ]);
    expect(snapshot?.toolActivities).toEqual([
      expect.objectContaining({
        id: 'tool-open',
        result: { message: 'Agent Run 已结束，未完成 Tool 已中断', ok: false },
        revision: 2,
        status: 'interrupted',
      }),
      expect.objectContaining({
        approval: expect.objectContaining({
          decidedAt: timestamp(4),
          status: 'interrupted',
        }),
        id: 'tool-approval-open',
        revision: 2,
        status: 'interrupted',
      }),
      expect.objectContaining({
        id: 'tool-interaction-open',
        interaction: expect.objectContaining({
          decidedAt: timestamp(4),
          status: 'interrupted',
        }),
        revision: 3,
        status: 'interrupted',
      }),
    ]);
  });

  it('rejects Tool creation after every terminal Run status without leaving partial rows', async () => {
    const store = await createStore();
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'interrupted'] as const;

    for (const [index, status] of terminalStatuses.entries()) {
      const sessionId = `session-terminal-${status}`;
      const runId = `run-terminal-${status}`;
      await createSession(store, sessionId, 3, `终态 ${status}`);
      await store.createRun({
        id: runId,
        model: 'model-a',
        now: timestamp(index + 1),
        profileId: 'profile-a',
        reasoningEffort: 'auto',
        sessionId,
        userPrompt: '结束任务',
      });
      await store.updateRun(runId, {
        currentStep: '已结束',
        finishedAt: timestamp(index + 2),
        status,
        updatedAt: timestamp(index + 2),
      });

      await expect(store.createToolRun({
        callId: `call-after-${status}`,
        id: `tool-after-${status}`,
        input: {},
        now: timestamp(index + 3),
        permissionBehavior: 'allow',
        runId,
        status: 'running',
        toolName: 'file.list',
      })).rejects.toThrow('Agent Tool requires an active Run');
      expect((await store.getSession(sessionId, OWNER_SCOPE, 3))?.toolActivities).toEqual([]);
    }
  });

  it('enforces terminal Run Tool invariants against direct SQLite writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-run-invariant-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const store = await createStore(databasePath);
    await createSession(store, 'session-direct-invariant', 3, '数据库不变量');
    await store.createRun({
      id: 'run-direct-invariant',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-direct-invariant',
      userPrompt: '完成任务',
    });
    await store.createToolRun({
      callId: 'call-direct-existing',
      id: 'tool-direct-existing',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-direct-invariant',
      status: 'running',
      toolName: 'file.list',
    });
    await store.completeToolRun('tool-direct-existing', { ok: true }, timestamp(3));
    await store.updateRun('run-direct-invariant', {
      currentStep: '已完成',
      finishedAt: timestamp(4),
      status: 'completed',
      updatedAt: timestamp(4),
    });

    const database = await new Promise<sqlite3.Database>((resolve, reject) => {
      const opened = new sqlite3.Database(databasePath, error => (
        error ? reject(error) : resolve(opened)
      ));
    });
    const execute = (sql: string) => new Promise<void>((resolve, reject) => {
      database.run(sql, error => error ? reject(error) : resolve());
    });
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, created_at
      ) VALUES (
        'tool-direct-late', 'run-direct-invariant', 'call-direct-late',
        'file.stat', '{}', 'running', '${timestamp(5)}'
      )
    `)).rejects.toThrow('Agent Tool requires an active Run');
    await expect(execute(`
      UPDATE agent_tool_runs
      SET status = 'running'
      WHERE id = 'tool-direct-existing'
    `)).rejects.toThrow('Agent Tool requires an active Run');
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });

    expect(await store.getSession('session-direct-invariant', OWNER_SCOPE, 3)).toMatchObject({
      toolActivities: [expect.objectContaining({
        id: 'tool-direct-existing',
        revision: 2,
        status: 'completed',
      })],
    });
  });

  it('enforces immutable plan and Tool associations against direct SQLite writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-plan-invariant-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const store = await createStore(databasePath);
    await createSession(store, 'session-plan-direct', 3, '计划数据库不变量');
    await store.createRun({
      id: 'run-plan-direct',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-direct',
      userPrompt: '检查目录',
    });

    const database = await new Promise<sqlite3.Database>((resolve, reject) => {
      const opened = new sqlite3.Database(databasePath, error => (
        error ? reject(error) : resolve(opened)
      ));
    });
    const execute = (sql: string, parameters: unknown[] = []) => new Promise<void>((resolve, reject) => {
      database.run(sql, parameters, error => error ? reject(error) : resolve());
    });

    await expect(execute(`
      UPDATE agent_runs
      SET plan_json = 'not-json', revision = revision + 1, updated_at = '${timestamp(2)}'
      WHERE id = 'run-plan-direct'
    `)).rejects.toThrow();

    const plan = runPlan();
    const canonicalPlanJson = JSON.stringify(plan);
    const invalidPlanJsonValues = [
      canonicalPlanJson.replace('"version":1}', '"version":1,"status":"completed"}'),
      canonicalPlanJson.replace(
        '"title":"读取目录"}',
        '"title":"读取目录","status":"completed"}',
      ),
      canonicalPlanJson.replace('"version":1}', '"version":1,"version":1}'),
      canonicalPlanJson.replace('"ordinal":1', '"ordinal":1,"ordinal":1'),
    ];
    for (const invalidPlanJson of invalidPlanJsonValues) {
      await expect(execute(`
        UPDATE agent_runs
        SET plan_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = 'run-plan-direct'
      `, [invalidPlanJson, timestamp(2)])).rejects.toThrow();
    }

    await store.setRunPlan('run-plan-direct', plan);
    await expect(execute(`
      UPDATE agent_runs
      SET plan_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = 'run-plan-direct'
    `, [JSON.stringify(runPlan(timestamp(3))), timestamp(3)])).rejects.toThrow(
      'Agent Run plan can only be set once before its first Tool',
    );

    await store.createToolRun({
      callId: 'call-plan-direct-first',
      id: 'tool-plan-direct-first',
      input: {},
      now: timestamp(3),
      permissionBehavior: 'allow',
      runId: 'run-plan-direct',
      status: 'running',
      toolName: 'file.list',
    });
    await expect(execute(`
      UPDATE agent_tool_runs
      SET plan_step_id = 'plan-step-stat'
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool plan association identity is immutable');
    await expect(execute(`
      UPDATE agent_tool_runs
      SET tool_name = 'file.stat'
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool plan association identity is immutable');
    await expect(execute(`
      UPDATE agent_tool_runs
      SET tool_kind = 'control'
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool plan association identity is immutable');
    await expect(execute(`
      UPDATE agent_tool_runs
      SET ordinal = 99
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool plan association identity is immutable');
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, tool_kind, input_json,
        status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-direct-control', 'run-plan-direct', 'call-plan-direct-control',
        'file.stat', 'control', '{}', 'running', 2, 'plan-step-stat', '${timestamp(4)}'
      )
    `)).rejects.toThrow('Agent Tool plan step association is invalid');
    await expect(execute(`
      INSERT OR REPLACE INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-direct-first', 'run-plan-direct', 'call-plan-direct-first',
        'file.list', '{}', 'running', 1, NULL, '${timestamp(4)}'
      )
    `)).rejects.toThrow('Agent Tool run identity cannot be replaced');
    await expect(execute(`
      INSERT OR REPLACE INTO agent_runs (
        id, session_id, status, user_prompt, profile_id, model, reasoning_effort,
        revision, created_at, updated_at
      ) VALUES (
        'run-plan-direct', 'session-plan-direct', 'running', '替换运行',
        'profile-a', 'model-a', 'auto', 1, '${timestamp(4)}', '${timestamp(4)}'
      )
    `)).rejects.toThrow('Agent Run identity cannot be replaced');
    await expect(execute(`
      DELETE FROM agent_tool_runs
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool run can only be deleted with its Run');
    await expect(execute(`
      DELETE FROM agent_runs
      WHERE id = 'run-plan-direct'
    `)).rejects.toThrow('Agent Run can only be deleted with its Session');
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-direct-order', 'run-plan-direct', 'call-plan-direct-order',
        'file.stat', '{}', 'running', 99, 'plan-step-stat', '${timestamp(4)}'
      )
    `)).rejects.toThrow('Agent Tool ordinal must be the next value in its Run');
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-direct-wrong', 'run-plan-direct', 'call-plan-direct-wrong',
        'file.list', '{}', 'running', 2, 'plan-step-stat', '${timestamp(4)}'
      )
    `)).rejects.toThrow('Agent Tool plan step association is invalid');
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-direct-duplicate', 'run-plan-direct', 'call-plan-direct-duplicate',
        'file.list', '{}', 'running', 2, 'plan-step-list', '${timestamp(4)}'
      )
    `)).rejects.toThrow();

    await createSession(store, 'session-plan-cross-run', 3, '跨 Run 关联');
    await store.createRun({
      id: 'run-plan-cross-run',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-cross-run',
      userPrompt: '检查其他目录',
    });
    await store.setRunPlan('run-plan-cross-run', runPlan(timestamp(2), [
      {
        expectedToolName: 'file.list',
        id: 'other-plan-step-list',
        ordinal: 1,
        title: '读取其他目录',
      },
      {
        expectedToolName: 'file.stat',
        id: 'other-plan-step-stat',
        ordinal: 2,
        title: '检查其他文件',
      },
    ]));
    await expect(execute(`
      UPDATE agent_tool_runs
      SET run_id = 'run-plan-cross-run'
      WHERE id = 'tool-plan-direct-first'
    `)).rejects.toThrow('Agent Tool plan association identity is immutable');
    await expect(execute(`
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, status, ordinal, plan_step_id, created_at
      ) VALUES (
        'tool-plan-cross-run', 'run-plan-cross-run', 'call-plan-cross-run',
        'file.list', '{}', 'running', 1, 'plan-step-list', '${timestamp(3)}'
      )
    `)).rejects.toThrow('Agent Tool plan step association is invalid');

    await createSession(store, 'session-plan-after-direct-tool', 3, '直写 Tool 后计划');
    await store.createRun({
      id: 'run-plan-after-direct-tool',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-after-direct-tool',
      userPrompt: '先执行 Tool',
    });
    await store.createToolRun({
      callId: 'call-before-direct-plan',
      id: 'tool-before-direct-plan',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-plan-after-direct-tool',
      status: 'running',
      toolName: 'file.list',
    });
    await expect(execute(`
      UPDATE agent_runs
      SET plan_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = 'run-plan-after-direct-tool'
    `, [JSON.stringify(runPlan(timestamp(3))), timestamp(3)])).rejects.toThrow(
      'Agent Run plan can only be set once before its first Tool',
    );

    await createSession(store, 'session-plan-direct-terminal', 3, '终态直写计划');
    await store.createRun({
      id: 'run-plan-direct-terminal',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-direct-terminal',
      userPrompt: '结束任务',
    });
    await store.updateRun('run-plan-direct-terminal', {
      currentStep: '已完成',
      finishedAt: timestamp(2),
      status: 'completed',
      updatedAt: timestamp(2),
    });
    await expect(execute(`
      UPDATE agent_runs
      SET plan_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = 'run-plan-direct-terminal'
    `, [JSON.stringify(runPlan(timestamp(3))), timestamp(3)])).rejects.toThrow(
      'Agent Run plan can only be set once before its first Tool',
    );

    const index = await new Promise<{ name: string } | undefined>((resolve, reject) => {
      database.get(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = 'agent_tool_runs_run_plan_step_idx'
      `, (error, row) => error ? reject(error) : resolve(row as { name: string } | undefined));
    });
    expect(index?.name).toBe('agent_tool_runs_run_plan_step_idx');
    expect((await store.getSession('session-plan-direct', OWNER_SCOPE, 3))?.toolActivities)
      .toEqual([expect.objectContaining({
        id: 'tool-plan-direct-first',
        ordinal: 1,
        planStepId: 'plan-step-list',
      })]);
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });
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
      permissionBehavior: 'allow',
      runId: 'run-running',
      status: 'running',
      toolName: 'file.list',
    });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.getSession('session-running', OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'interrupted',
      runs: [expect.objectContaining({
        currentStep: '上次运行已中断',
        id: 'run-running',
        revision: 2,
        status: 'interrupted',
      })],
      toolActivities: [expect.objectContaining({
        id: 'tool-running',
        revision: 2,
        status: 'interrupted',
      })],
    });
    await reopenedStore.close();
    stores.splice(stores.indexOf(reopenedStore), 1);

    const reopenedAgainStore = await createStore(databasePath);
    expect(await reopenedAgainStore.getSession('session-running', OWNER_SCOPE, 3)).toMatchObject({
      runs: [expect.objectContaining({ revision: 2, status: 'interrupted' })],
      toolActivities: [expect.objectContaining({ revision: 2, status: 'interrupted' })],
    });
  });

  it('interrupts a preparing Run and Tool without restoring an executable action', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepare-recovery-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-preparing', 3, '准备中的会话');
    await firstStore.createRun({
      id: 'run-preparing',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-preparing',
      userPrompt: '提取音频',
    });
    await firstStore.createToolRun({
      callId: 'call-preparing',
      id: 'tool-preparing',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'ask',
      runId: 'run-preparing',
      status: 'preparing',
      toolName: 'media.extractAudio',
    });
    await firstStore.updateRun('run-preparing', {
      currentStep: '准备 media.extractAudio',
      status: 'preparing',
      updatedAt: timestamp(2),
    });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    const snapshot = await reopenedStore.getSession('session-preparing', OWNER_SCOPE, 3);
    expect(snapshot).toMatchObject({
      lastRunStatus: 'interrupted',
      runs: [expect.objectContaining({ revision: 3, status: 'interrupted' })],
      toolActivities: [expect.objectContaining({
        id: 'tool-preparing',
        revision: 2,
        status: 'interrupted',
      })],
    });
    expect(snapshot?.toolActivities[0]).not.toHaveProperty('preparation');
  });

  it('persists prepared actions atomically and freezes edits through approval', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepared-action-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const store = await createStore(databasePath);
    await createSession(store, 'session-prepared-action', 3, '目标确认');
    await store.createRun({
      id: 'run-prepared-action',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-prepared-action',
      userPrompt: '提取音频',
    });
    await store.createToolRun({
      callId: 'call-prepared-action',
      id: 'tool-prepared-action',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'ask',
      runId: 'run-prepared-action',
      status: 'preparing',
      toolName: 'media.extractAudio',
    });

    await expect(executeDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET prepared_action_id = 'partial-action'
      WHERE id = 'tool-prepared-action';
    `)).rejects.toThrow('must be set atomically');

    const initialAction = preparedAction();
    await expect(store.completeToolPreparation({
      action: initialAction,
      approvalId: 'approval-prepared-action',
      approvalInputHash: 'b'.repeat(64),
      approvalPreview: {
        description: '提取并上传音频',
        risk: 'write',
        title: '提取音频',
      },
      id: 'tool-prepared-action',
      permissionBehavior: 'ask',
      preparedActionId: 'prepared-action-1',
      snapshotHash: 'a'.repeat(64),
    })).rejects.toThrow('preparation identity is invalid');
    await expect(store.completeToolPreparation({
      action: initialAction,
      approvalId: 'approval-prepared-action',
      approvalInputHash: 'a'.repeat(64),
      approvalPreview: {
        description: '提取并上传音频',
        risk: 'write',
        title: '提取音频',
      },
      id: 'tool-prepared-action',
      permissionBehavior: 'ask',
      preparedActionId: 'prepared-action-1',
      snapshotHash: 'a'.repeat(64),
    })).resolves.toMatchObject({
      preparation: {
        action: initialAction,
        preparedActionId: 'prepared-action-1',
        snapshotHash: 'a'.repeat(64),
      },
      revision: 2,
      status: 'awaiting_approval',
    });
    await expect(runDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET approval_input_hash = ?
      WHERE id = 'tool-prepared-action'
    `, ['b'.repeat(64)])).rejects.toThrow('preparation identity is invalid');
    for (const column of [
      'prepared_action_id',
      'prepared_action_json',
      'prepared_snapshot_hash',
    ]) {
      await expect(executeDatabaseSql(databasePath, `
        UPDATE agent_tool_runs
        SET ${column} = CAST(${column} AS BLOB)
        WHERE id = 'tool-prepared-action';
      `)).rejects.toThrow('preparation identity is invalid');
    }
    expect(await readDatabaseRow(databasePath, `
      SELECT
        typeof(prepared_action_id) AS prepared_action_id_type,
        typeof(prepared_action_json) AS prepared_action_json_type,
        typeof(prepared_snapshot_hash) AS prepared_snapshot_hash_type,
        typeof(approval_input_hash) AS approval_input_hash_type
      FROM agent_tool_runs
      WHERE id = 'tool-prepared-action'
    `)).toEqual({
      approval_input_hash_type: 'text',
      prepared_action_id_type: 'text',
      prepared_action_json_type: 'text',
      prepared_snapshot_hash_type: 'text',
    });
    await expect(store.completeToolPreparation({
      action: initialAction,
      approvalId: 'approval-replay',
      approvalInputHash: 'b'.repeat(64),
      approvalPreview: {
        description: '重复准备',
        risk: 'write',
        title: '提取音频',
      },
      id: 'tool-prepared-action',
      permissionBehavior: 'ask',
      preparedActionId: 'prepared-action-replay',
      snapshotHash: 'b'.repeat(64),
    })).rejects.toThrow('无法提交');

    const editedAction = preparedAction('renamed.m4a');
    const editedPreparation = {
      action: editedAction,
      approvalInputHash: 'c'.repeat(64),
      approvalPreview: {
        description: '提取并上传重命名后的音频',
        risk: 'write' as const,
        title: '提取音频',
      },
      expectedPreparedActionId: 'prepared-action-1',
      preparedActionId: 'prepared-action-2',
      snapshotHash: 'c'.repeat(64),
    };
    await expect(store.resolveToolApproval(
      'approval-prepared-action',
      'approved',
      timestamp(3),
      { ...editedPreparation, expectedPreparedActionId: 'stale-action' },
    )).rejects.toThrow('不存在或已经处理');
    await expect(store.resolveToolApproval(
      'approval-prepared-action',
      'approved',
      timestamp(3),
      { ...editedPreparation, approvalInputHash: 'd'.repeat(64) },
    )).rejects.toThrow('preparation identity is invalid');
    await expect(store.resolveToolApproval(
      'approval-prepared-action',
      'approved',
      timestamp(3),
      editedPreparation,
    )).resolves.toMatchObject({
      approval: { status: 'approved' },
      preparation: {
        action: editedAction,
        preparedActionId: 'prepared-action-2',
        snapshotHash: 'c'.repeat(64),
      },
      revision: 3,
      status: 'running',
    });
  });

  it('rejects unsupported, malformed, and non-canonical prepared action writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepared-validation-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const store = await createStore(databasePath);
    await createSession(store, 'session-prepared-validation', 3, '准备动作校验');
    await store.createRun({
      id: 'run-prepared-validation',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-prepared-validation',
      userPrompt: '提取音频',
    });
    await store.createToolRun({
      callId: 'call-prepared-validation',
      id: 'tool-prepared-validation',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-prepared-validation',
      status: 'preparing',
      toolName: 'media.extractAudio',
    });

    const validAction = preparedAction();
    const legacyAction: Record<string, unknown> = { ...validAction };
    delete legacyAction.kind;
    delete legacyAction.version;
    const partialIdentity: Record<string, unknown> = { ...validAction };
    delete partialIdentity.version;
    const invalidActions: unknown[] = [
      legacyAction,
      partialIdentity,
      { ...validAction, kind: 'shell.run' },
      { ...validAction, version: 2 },
      { ...validAction, version: '1' },
      { ...validAction, unexpected: true },
      { ...validAction, libraryId: '3' },
      { ...validAction, destination: 'local', fallbackPolicy: 'none' },
      { ...validAction, outputFileName: ' . ' },
      { ...validAction, targetLabel: '\u00a0' },
      { ...validAction, targetLabel: '视频\n目录' },
    ];
    for (const action of invalidActions) {
      await expect(store.completeToolPreparation({
        action: action as never,
        approvalId: 'approval-prepared-validation',
        approvalInputHash: 'a'.repeat(64),
        approvalPreview: {
          description: '提取并上传音频',
          risk: 'write',
          title: '提取音频',
        },
        id: 'tool-prepared-validation',
        permissionBehavior: 'allow',
        preparedActionId: 'prepared-action-validation',
        snapshotHash: 'a'.repeat(64),
      })).rejects.toThrow();
    }

    for (const snapshotHash of [
      'A'.repeat(64),
      `${'a'.repeat(64)}\0suffix`,
      `${'a'.repeat(63)}\0`,
    ]) {
      await expect(store.completeToolPreparation({
        action: validAction,
        approvalId: 'approval-prepared-validation',
        approvalInputHash: 'a'.repeat(64),
        approvalPreview: {
          description: '提取并上传音频',
          risk: 'write',
          title: '提取音频',
        },
        id: 'tool-prepared-validation',
        permissionBehavior: 'allow',
        preparedActionId: 'prepared-action-validation',
        snapshotHash,
      })).rejects.toThrow('preparation identity is invalid');
    }

    const nonCanonicalAction = {
      ...validAction,
      outputFileName: ' movie-audio.m4a ',
      outputFormat: ' M4A ',
      targetLabel: ' 视频 ',
    };
    await expect(store.completeToolPreparation({
      action: nonCanonicalAction as never,
      approvalId: 'approval-prepared-validation',
      approvalInputHash: '441d16fa52fa337561eb2ae2ef848b6739c27d69c26f9e3444bda3f320ba0920',
      approvalPreview: {
        description: '提取并上传音频',
        risk: 'write',
        title: '提取音频',
      },
      id: 'tool-prepared-validation',
      permissionBehavior: 'allow',
      preparedActionId: 'prepared-action-validation',
      snapshotHash: '441d16fa52fa337561eb2ae2ef848b6739c27d69c26f9e3444bda3f320ba0920',
    })).resolves.toMatchObject({
      preparation: { action: validAction },
      status: 'running',
    });

    await store.createToolRun({
      callId: 'call-prepared-mismatch',
      id: 'tool-prepared-mismatch',
      input: {},
      now: timestamp(3),
      permissionBehavior: 'allow',
      runId: 'run-prepared-validation',
      status: 'preparing',
      toolName: 'directory.create',
    });
    await expect(store.completeToolPreparation({
      action: validAction,
      approvalId: 'approval-prepared-mismatch',
      approvalInputHash: 'b'.repeat(64),
      approvalPreview: {
        description: '不匹配的准备动作',
        risk: 'write',
        title: '错误动作',
      },
      id: 'tool-prepared-mismatch',
      permissionBehavior: 'allow',
      preparedActionId: 'prepared-action-mismatch',
      snapshotHash: 'b'.repeat(64),
    })).rejects.toThrow('prepared action is invalid');

    const duplicateDiscriminator = JSON.stringify(validAction).replace(
      '"kind":"media.extractAudio"',
      '"kind":"media.extractAudio","kind":"media.extractAudio"',
    );
    await expect(runDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET prepared_action_json = ?
      WHERE id = 'tool-prepared-validation'
    `, [duplicateDiscriminator])).rejects.toThrow('prepared action is invalid');
    for (const [label, invalidPersistedAction] of [
      ['backslash file name', { ...validAction, outputFileName: 'folder\\movie.m4a' }],
      ['NUL file name', { ...validAction, outputFileName: 'bad\0name.m4a' }],
      ['whitespace target', { ...validAction, targetLabel: '\u00a0' }],
      ['control target', { ...validAction, targetLabel: '视频\n目录' }],
    ] as const) {
      try {
        await runDatabaseSql(databasePath, `
          UPDATE agent_tool_runs
          SET prepared_action_json = ?
          WHERE id = 'tool-prepared-validation'
        `, [JSON.stringify(invalidPersistedAction)]);
      } catch (error) {
        expect(error).toMatchObject({ message: expect.stringContaining('prepared action is invalid') });
        continue;
      }
      throw new Error(`SQLite accepted ${label}`);
    }
    expect(await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = 'tool-prepared-validation'
    `)).toEqual({ prepared_action_json: JSON.stringify(validAction) });
  });

  it('reconciles legacy schema 2 prepared actions once and remains idempotent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepared-reconcile-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const seeded = await createStoredPreparedAction(databasePath, 'legacy', 'a');
    await restoreLegacyPreparedActionSchema(databasePath, [seeded.toolId]);

    const legacyRow = await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = '${seeded.toolId}'
    `);
    expect(JSON.parse(legacyRow?.prepared_action_json || '{}')).not.toHaveProperty('kind');
    expect(JSON.parse(legacyRow?.prepared_action_json || '{}')).not.toHaveProperty('version');

    const migratedStore = await createStore(databasePath);
    expect(await migratedStore.getSession(seeded.sessionId, OWNER_SCOPE, 3)).toMatchObject({
      toolActivities: [expect.objectContaining({
        id: seeded.toolId,
        preparation: {
          action: preparedAction('legacy.m4a'),
          preparedActionId: seeded.preparedActionId,
          snapshotHash: seeded.snapshotHash,
        },
      })],
    });
    await migratedStore.close();
    stores.splice(stores.indexOf(migratedStore), 1);

    const firstMigration = await readDatabaseRow<{
      prepared_action_id: string;
      prepared_action_json: string;
      prepared_snapshot_hash: string;
      revision: number;
    }>(databasePath, `
      SELECT prepared_action_id, prepared_action_json, prepared_snapshot_hash, revision
      FROM agent_tool_runs
      WHERE id = '${seeded.toolId}'
    `);
    expect(firstMigration).toEqual({
      prepared_action_id: seeded.preparedActionId,
      prepared_action_json: JSON.stringify(preparedAction('legacy.m4a')),
      prepared_snapshot_hash: seeded.snapshotHash,
      revision: 3,
    });
    expect(await readDatabaseVersion(databasePath)).toBe(2);

    const reopenedStore = await createStore(databasePath);
    await reopenedStore.close();
    stores.splice(stores.indexOf(reopenedStore), 1);
    expect(await readDatabaseRow(databasePath, `
      SELECT prepared_action_id, prepared_action_json, prepared_snapshot_hash, revision
      FROM agent_tool_runs
      WHERE id = '${seeded.toolId}'
    `)).toEqual(firstMigration);
    expect(await readDatabaseVersion(databasePath)).toBe(2);
  });

  it('rolls back legacy prepared action reconciliation atomically for damaged rows', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepared-rollback-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const valid = await createStoredPreparedAction(databasePath, 'valid', 'a');
    const damaged = await createStoredPreparedAction(databasePath, 'damaged', 'b');
    await restoreLegacyPreparedActionSchema(databasePath, [valid.toolId, damaged.toolId]);
    await runDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET approval_input_hash = ?
      WHERE id = ?
    `, ['c'.repeat(64), damaged.toolId]);
    const legacyValidRow = await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = '${valid.toolId}'
    `);

    await expect(createStore(databasePath)).rejects.toThrow('preparation identity is invalid');
    expect(await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = '${valid.toolId}'
    `)).toEqual(legacyValidRow);
    expect(JSON.parse(legacyValidRow?.prepared_action_json || '{}')).not.toHaveProperty('kind');
    expect(await readDatabaseRow<{ sql: string }>(databasePath, `
      SELECT sql
      FROM sqlite_master
      WHERE type = 'trigger'
        AND name = 'agent_tool_runs_validate_preparation_update'
    `)).toEqual({
      sql: expect.stringContaining('Legacy Agent prepared action has unknown fields'),
    });

    await runDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET approval_input_hash = ?
      WHERE id = ?
    `, [damaged.snapshotHash, damaged.toolId]);
    const retriedStore = await createStore(databasePath);
    await retriedStore.close();
    stores.splice(stores.indexOf(retriedStore), 1);
    for (const seeded of [valid, damaged]) {
      const row = await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
        SELECT prepared_action_json
        FROM agent_tool_runs
        WHERE id = '${seeded.toolId}'
      `);
      expect(JSON.parse(row?.prepared_action_json || '{}')).toMatchObject({
        kind: 'media.extractAudio',
        version: 1,
      });
    }
    expect(await readDatabaseVersion(databasePath)).toBe(2);
  });

  it('rejects duplicate fields before legacy prepared actions are normalized', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-prepared-duplicates-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const seeded = await createStoredPreparedAction(databasePath, 'duplicate', 'c');
    await restoreLegacyPreparedActionSchema(databasePath, [seeded.toolId]);
    const legacyRow = await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = '${seeded.toolId}'
    `);
    const duplicateAction = String(legacyRow?.prepared_action_json || '').replace(
      '"outputFormat":"m4a"',
      '"outputFormat":"m4a","outputFormat":"m4a"',
    );
    await runDatabaseSql(databasePath, `
      UPDATE agent_tool_runs
      SET prepared_action_json = ?
      WHERE id = ?
    `, [duplicateAction, seeded.toolId]);

    await expect(createStore(databasePath)).rejects.toThrow(
      `Agent Tool prepared action 无法升级：${seeded.toolId}`,
    );
    expect(await readDatabaseRow<{ prepared_action_json: string }>(databasePath, `
      SELECT prepared_action_json
      FROM agent_tool_runs
      WHERE id = '${seeded.toolId}'
    `)).toEqual({ prepared_action_json: duplicateAction });
  });

  it('preserves the immutable plan and Tool step association when recovery interrupts a Run', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-plan-recovery-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-plan-recovery', 3, '计划恢复');
    await firstStore.createRun({
      id: 'run-plan-recovery',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-plan-recovery',
      userPrompt: '检查目录后继续',
    });
    const plan = runPlan();
    await firstStore.setRunPlan('run-plan-recovery', plan);
    await expect(firstStore.createToolRun({
      callId: 'call-plan-recovery',
      id: 'tool-plan-recovery',
      input: {},
      now: timestamp(3),
      permissionBehavior: 'allow',
      runId: 'run-plan-recovery',
      status: 'running',
      toolName: 'file.list',
    })).resolves.toMatchObject({ planStepId: 'plan-step-list' });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.getSession('session-plan-recovery', OWNER_SCOPE, 3)).toMatchObject({
      runs: [expect.objectContaining({
        plan,
        revision: 3,
        status: 'interrupted',
      })],
      toolActivities: [expect.objectContaining({
        planStepId: 'plan-step-list',
        revision: 2,
        status: 'interrupted',
      })],
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

  it('backfills runtime columns and stable Tool ordinals in an existing v2 database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-session-v2-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    await createPreApprovalV2Database(databasePath);
    await executeDatabaseSql(databasePath, `
      INSERT INTO agent_tool_runs (
        id, run_id, call_id, tool_name, input_json, result_json, status,
        created_at, finished_at
      ) VALUES (
        'preexisting-tool-activation',
        'preexisting-run',
        'preexisting-call-activation',
        'skill.activate',
        '{"skillId":"media-extract-audio"}',
        '{"ok":true}',
        'completed',
        '${timestamp(2)}',
        '${timestamp(3)}'
      );
    `);

    const store = await createStore(databasePath);
    expect(await readDatabaseRow<{ count: number }>(databasePath, `
      SELECT COUNT(*) AS count
      FROM pragma_table_info('agent_tool_runs')
      WHERE name IN ('prepared_action_id', 'prepared_action_json', 'prepared_snapshot_hash')
    `)).toEqual({ count: 3 });
    expect(await store.getSession('preexisting-session', OWNER_SCOPE, 3)).toMatchObject({
      runs: [expect.objectContaining({ id: 'preexisting-run', revision: 1 })],
      toolActivities: [
        expect.objectContaining({ id: 'preexisting-tool-first', ordinal: 1, revision: 1 }),
        expect.objectContaining({ id: 'preexisting-tool-second', ordinal: 2, revision: 1 }),
        expect.objectContaining({ id: 'preexisting-tool-activation', ordinal: 3, revision: 1 }),
      ],
    });
    expect(await readDatabaseRow<{ tool_kind: string }>(
      databasePath,
      'SELECT tool_kind FROM agent_tool_runs WHERE id = ?',
      ['preexisting-tool-activation'],
    )).toEqual({ tool_kind: 'control' });
    const legacyAssistant = message(
      'preexisting-session',
      'preexisting-run',
      4,
      'assistant',
      '既有会话数据仍然可读',
    );
    await store.appendMessage(legacyAssistant);
    await store.beginContextCheckpoint({
      id: 'checkpoint-preexisting-v2',
      libraryId: 3,
      model: 'model-a',
      now: timestamp(5),
      ownerScope: OWNER_SCOPE,
      profileId: 'profile-a',
      sessionId: 'preexisting-session',
      throughMessageId: legacyAssistant.id,
    });
    await store.completeContextCheckpoint(
      'checkpoint-preexisting-v2',
      checkpointSummary('保留旧数据'),
      timestamp(6),
    );
    await createSession(store, 'session-approval', 3, '等待确认');
    await store.createRun({
      id: 'run-approval',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-approval',
      userPrompt: '创建测试目录',
    });
    await expect(store.createToolRun({
      approvalId: 'approval-1',
      approvalInputHash: 'hash-1',
      approvalPreview: {
        description: '将在当前目录创建文件夹“测试”。',
        risk: 'write',
        title: '创建文件夹',
      },
      callId: 'call-approval',
      id: 'tool-approval',
      input: { name: '测试' },
      now: timestamp(2),
      permissionBehavior: 'ask',
      runId: 'run-approval',
      status: 'awaiting_approval',
      toolName: 'directory.create',
    })).resolves.toMatchObject({ revision: 1 });
    await store.updateRun('run-approval', {
      currentStep: '等待确认 directory.create',
      status: 'awaiting_approval',
      updatedAt: timestamp(2),
    });

    expect(await store.getSession('session-approval', OWNER_SCOPE, 3)).toMatchObject({
      lastRunStatus: 'awaiting_approval',
      toolActivities: [expect.objectContaining({
        approval: expect.objectContaining({ approvalId: 'approval-1', status: 'pending' }),
        status: 'awaiting_approval',
      })],
    });
    await expect(store.resolveToolApproval('approval-1', 'denied', timestamp(3)))
      .resolves.toMatchObject({ revision: 2 });
    expect((await store.getSession('session-approval', OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({
        approval: { approvalId: 'approval-1', status: 'denied' },
        revision: 2,
        status: 'failed',
      });
    await expect(store.completeToolRun(
      'tool-approval',
      { message: '用户拒绝了操作', ok: false },
      timestamp(4),
    )).resolves.toMatchObject({
      result: { message: '用户拒绝了操作', ok: false },
      revision: 3,
      status: 'failed',
    });

    await store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.getSession('preexisting-session', OWNER_SCOPE, 3)).toMatchObject({
      messages: [expect.objectContaining({ content: '既有会话数据仍然可读' })],
      runs: [expect.objectContaining({ id: 'preexisting-run', revision: 1 })],
      toolActivities: [
        expect.objectContaining({ id: 'preexisting-tool-first', ordinal: 1, revision: 1 }),
        expect.objectContaining({ id: 'preexisting-tool-second', ordinal: 2, revision: 1 }),
        expect.objectContaining({ id: 'preexisting-tool-activation', ordinal: 3, revision: 1 }),
      ],
    });
    expect(await reopenedStore.readContextCheckpointState(
      'preexisting-session',
      OWNER_SCOPE,
      3,
    )).toMatchObject({
      consecutiveFailureCount: 0,
      latestCompleted: { id: 'checkpoint-preexisting-v2', status: 'completed' },
    });
    await reopenedStore.close();
    stores.splice(stores.indexOf(reopenedStore), 1);

    const database = await new Promise<sqlite3.Database>((resolve, reject) => {
      const opened = new sqlite3.Database(databasePath, error => (
        error ? reject(error) : resolve(opened)
      ));
    });
    const version = await new Promise<{ user_version: number }>((resolve, reject) => {
      database.get('PRAGMA user_version', (error, row) => (
        error ? reject(error) : resolve(row as { user_version: number })
      ));
    });
    const toolColumns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
      database.all('PRAGMA table_info(agent_tool_runs)', (error, rows) => (
        error ? reject(error) : resolve(rows as Array<{ name: string }>)
      ));
    });
    const runColumns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
      database.all('PRAGMA table_info(agent_runs)', (error, rows) => (
        error ? reject(error) : resolve(rows as Array<{ name: string }>)
      ));
    });
    const checkpointColumns = await new Promise<Array<{ name: string }>>((resolve, reject) => {
      database.all('PRAGMA table_info(agent_context_checkpoints)', (error, rows) => (
        error ? reject(error) : resolve(rows as Array<{ name: string }>)
      ));
    });
    await new Promise<void>((resolve, reject) => {
      database.close(error => error ? reject(error) : resolve());
    });
    expect(version.user_version).toBe(2);
    expect(runColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'capability_identity',
      'plan_json',
      'revision',
      'skill_catalog_revision',
      'tool_catalog_revision',
    ]));
    expect(toolColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'tool_kind',
      'permission_behavior',
      'approval_id',
      'approval_input_hash',
      'approval_preview_json',
      'approval_status',
      'approval_decided_at',
      'progress_json',
      'progress_updated_at',
      'interaction_id',
      'interaction_request_json',
      'interaction_status',
      'interaction_response_json',
      'interaction_decided_at',
      'ordinal',
      'plan_step_id',
      'revision',
    ]));
    expect(checkpointColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'id',
      'session_id',
      'base_checkpoint_id',
      'through_message_id',
      'through_sequence',
      'status',
      'summary_json',
      'profile_id',
      'model',
      'created_at',
      'finished_at',
    ]));
  });

  it('persists one interaction response and rejects a duplicate submission', async () => {
    const store = await createStore();
    await createSession(store, 'session-interaction', 3, '交互会话');
    await store.createRun({
      id: 'run-interaction',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-interaction',
      userPrompt: '导出音频',
    });
    await expect(store.createToolRun({
      callId: 'call-interaction',
      id: 'tool-interaction',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-interaction',
      status: 'running',
      toolName: 'interaction.request',
    })).resolves.toMatchObject({ revision: 1 });
    const request = {
      kind: 'choice' as const,
      options: [{ id: 'mp3', label: 'MP3' }, { id: 'wav', label: 'WAV' }],
      prompt: '请选择格式',
    };

    await expect(store.createToolInteraction(
      'tool-interaction',
      'interaction-1',
      request,
    )).resolves.toMatchObject({
      interaction: { interactionId: 'interaction-1', request, status: 'pending' },
      revision: 2,
      status: 'awaiting_interaction',
    });
    await expect(store.resolveToolInteraction(
      'interaction-1',
      'submitted',
      { kind: 'choice', selectedOptionIds: ['mp3'] },
      timestamp(3),
    )).resolves.toMatchObject({
      interaction: {
        decidedAt: timestamp(3),
        response: { kind: 'choice', selectedOptionIds: ['mp3'] },
        status: 'submitted',
      },
      revision: 3,
      status: 'running',
    });
    await expect(store.resolveToolInteraction(
      'interaction-1',
      'submitted',
      { kind: 'choice', selectedOptionIds: ['wav'] },
      timestamp(4),
    )).rejects.toThrow('不存在或已经处理');
    expect((await store.getSession('session-interaction', OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({
        interaction: {
          response: { kind: 'choice', selectedOptionIds: ['mp3'] },
          status: 'submitted',
        },
        revision: 3,
      });
  });

  it('marks a pending interaction as interrupted when reopening the database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-interaction-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const firstStore = await createStore(databasePath);
    await createSession(firstStore, 'session-interaction-restart', 3, '等待输入');
    await firstStore.createRun({
      id: 'run-interaction-restart',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-interaction-restart',
      userPrompt: '请选择格式',
    });
    await firstStore.createToolRun({
      callId: 'call-interaction-restart',
      id: 'tool-interaction-restart',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-interaction-restart',
      status: 'running',
      toolName: 'interaction.request',
    });
    await firstStore.createToolInteraction('tool-interaction-restart', 'interaction-restart', {
      kind: 'choice',
      options: [{ id: 'mp3', label: 'MP3' }, { id: 'wav', label: 'WAV' }],
      prompt: '请选择格式',
    });
    await firstStore.updateRun('run-interaction-restart', {
      currentStep: '等待用户输入 interaction.request',
      status: 'awaiting_interaction',
      updatedAt: timestamp(2),
    });
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const reopenedStore = await createStore(databasePath);
    expect(await reopenedStore.getSession('session-interaction-restart', OWNER_SCOPE, 3))
      .toMatchObject({
        lastRunStatus: 'interrupted',
        runs: [expect.objectContaining({ revision: 3, status: 'interrupted' })],
        toolActivities: [expect.objectContaining({
          interaction: expect.objectContaining({ status: 'interrupted' }),
          revision: 3,
          status: 'interrupted',
        })],
      });
  });

  it('persists Tool progress and exposes the completed canonical activity', async () => {
    const store = await createStore();
    await createSession(store, 'session-progress', 3, '进度会话');
    await store.createRun({
      id: 'run-progress',
      model: 'model-a',
      now: timestamp(1),
      profileId: 'profile-a',
      reasoningEffort: 'auto',
      sessionId: 'session-progress',
      userPrompt: '读取目录',
    });
    await expect(store.createToolRun({
      callId: 'call-progress',
      id: 'tool-progress',
      input: {},
      now: timestamp(2),
      permissionBehavior: 'allow',
      runId: 'run-progress',
      status: 'running',
      toolName: 'file.list',
    })).resolves.toMatchObject({ revision: 1 });

    await expect(store.updateToolRunProgress(
      'tool-progress',
      { message: '正在读取目录', percent: 40 },
      timestamp(3),
    )).resolves.toMatchObject({
      progress: { message: '正在读取目录', percent: 40 },
      progressUpdatedAt: timestamp(3),
      revision: 2,
      status: 'running',
    });
    await expect(store.updateToolRunProgress(
      'tool-progress',
      { message: '相同时间继续读取', percent: 60 },
      timestamp(3),
    )).resolves.toMatchObject({
      progress: { message: '相同时间继续读取', percent: 60 },
      progressUpdatedAt: timestamp(3),
      revision: 3,
    });
    await expect(store.updateToolRunProgress(
      'tool-progress',
      { message: '时钟回拨后继续读取', percent: 70 },
      timestamp(2),
    )).resolves.toMatchObject({
      progress: { message: '时钟回拨后继续读取', percent: 70 },
      progressUpdatedAt: timestamp(2),
      revision: 4,
    });
    await expect(store.completeToolRun(
      'tool-progress',
      { data: { entryCount: 3 }, message: '读取完成', ok: true },
      timestamp(4),
    )).resolves.toMatchObject({ revision: 5 });
    await expect(store.completeToolRun(
      'tool-progress',
      { message: '迟到的失败结果', ok: false },
      timestamp(5),
    )).rejects.toThrow('已经结束');

    expect((await store.getSession('session-progress', OWNER_SCOPE, 3))?.toolActivities[0])
      .toMatchObject({
        finishedAt: timestamp(4),
        progress: { message: '时钟回拨后继续读取', percent: 70 },
        result: { data: { entryCount: 3 }, message: '读取完成', ok: true },
        revision: 5,
        status: 'completed',
      });
  });

  it('normalizes the known intermediate approval schema marker without losing sessions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-session-v3-marker-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    const initialStore = await createStore(databasePath);
    await createSession(initialStore, 'preserved-session', 3, '保留的会话');
    await initialStore.close();
    stores.splice(stores.indexOf(initialStore), 1);
    await setDatabaseVersion(databasePath, 3);

    const reopenedStore = await createStore(databasePath);
    expect((await reopenedStore.listSessions(OWNER_SCOPE, 3)).sessions).toEqual([
      expect.objectContaining({ id: 'preserved-session', title: '保留的会话' }),
    ]);
    await reopenedStore.close();
    stores.splice(stores.indexOf(reopenedStore), 1);
    expect(await readDatabaseVersion(databasePath)).toBe(2);
  });

  it('rejects an unknown version 3 table shape instead of rewriting it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-session-unknown-v3-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent-sessions.sqlite3');
    await createPreApprovalV2Database(databasePath);
    await setDatabaseVersion(databasePath, 3);

    await expect(createStore(databasePath)).rejects.toThrow('版本过新且结构无法识别：3');
    expect(await readDatabaseVersion(databasePath)).toBe(3);
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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSQLiteAgentMemoryStore,
  type AgentMemoryStore,
} from './agent-memory-store';

const OWNER_SCOPE = {
  accountScope: 'user:7',
  backendScope: 'https://example.com/api',
};
const OTHER_OWNER_SCOPE = {
  accountScope: 'user:8',
  backendScope: 'https://example.com/api',
};

function proposal(
  title: string,
  scope: 'global' | 'library' = 'library',
  kind: 'preference' | 'project' | 'reference' = 'project',
) {
  return {
    application: `适用于 ${title}`,
    content: `${title} 的完整规则`,
    kind,
    reason: `保存 ${title} 的原因`,
    scope,
    title,
  } as const;
}

async function readUserVersion(databasePath: string): Promise<number> {
  const database = await new Promise<sqlite3.Database>((resolve, reject) => {
    const opened = new sqlite3.Database(databasePath, error => (
      error ? reject(error) : resolve(opened)
    ));
  });
  const row = await new Promise<{ user_version: number }>((resolve, reject) => {
    database.get('PRAGMA user_version', (error, value) => (
      error ? reject(error) : resolve(value as { user_version: number })
    ));
  });
  await new Promise<void>((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
  return row.user_version;
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

describe('SQLite Agent memory store', () => {
  const stores: AgentMemoryStore[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map(store => store.close()));
    await Promise.all(directories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  async function createStore(databasePath = ':memory:') {
    const store = await createSQLiteAgentMemoryStore(databasePath);
    stores.push(store);
    return store;
  }

  it('isolates rows by owner while combining global and current-library scopes', async () => {
    const store = await createStore();
    await store.create({
      id: 'global-preference',
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('简洁回答', 'global', 'preference'),
      sourceRunId: 'run-1',
      sourceSessionId: 'session-1',
    });
    await store.create({
      id: 'library-project',
      libraryId: 3,
      now: '2026-08-23T10:01:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('Win 资料库输出约定'),
    });
    await store.create({
      id: 'other-owner',
      libraryId: 3,
      now: '2026-08-23T10:02:00.000Z',
      ownerScope: OTHER_OWNER_SCOPE,
      proposal: proposal('其他用户约定'),
    });

    expect((await store.list(OWNER_SCOPE, 3)).memories.map(item => item.id)).toEqual([
      'library-project',
      'global-preference',
    ]);
    expect((await store.list(OWNER_SCOPE, 9)).memories.map(item => item.id)).toEqual([
      'global-preference',
    ]);
    expect((await store.list(OTHER_OWNER_SCOPE, 3)).memories.map(item => item.id)).toEqual([
      'other-owner',
    ]);
  });

  it('uses revision checks for edits and deletion', async () => {
    const store = await createStore();
    const created = await store.create({
      id: 'editable',
      libraryId: 3,
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('原始标题'),
    });
    const updated = await store.update({
      application: '更新后的场景',
      content: '更新后的内容',
      id: created.id,
      libraryId: 3,
      now: '2026-08-23T10:01:00.000Z',
      ownerScope: OWNER_SCOPE,
      reason: '更新后的原因',
      revision: created.revision,
      title: '更新后的标题',
    });

    expect(updated).toMatchObject({ revision: 2, title: '更新后的标题' });
    await expect(store.update({
      application: '旧修改',
      content: '旧修改',
      id: created.id,
      libraryId: 3,
      now: '2026-08-23T10:02:00.000Z',
      ownerScope: OWNER_SCOPE,
      reason: '旧修改',
      revision: created.revision,
      title: '旧修改',
    })).rejects.toThrow('已被修改、删除');
    expect(await store.delete({
      id: created.id,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      revision: created.revision,
    })).toBe(false);
    expect(await store.delete({
      id: created.id,
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      revision: updated.revision,
    })).toBe(true);
    expect(await store.list(OWNER_SCOPE, 3)).toMatchObject({ memories: [], total: 0 });
  });

  it('persists without changing the existing database user_version', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-memory-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const first = await createStore(databasePath);
    await first.create({
      id: 'persisted',
      libraryId: 3,
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('持久化记忆'),
    });
    await first.close();
    stores.splice(stores.indexOf(first), 1);

    expect(await readUserVersion(databasePath)).toBe(0);
    const reopened = await createStore(databasePath);
    expect(await reopened.list(OWNER_SCOPE, 3, '持久化')).toMatchObject({
      memories: [{ id: 'persisted', revision: 1 }],
      total: 1,
    });
  });

  it('replaces a stale same-name quota trigger when reopening the store', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-memory-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const first = await createStore(databasePath);
    await first.close();
    stores.splice(stores.indexOf(first), 1);
    await executeDatabaseSql(databasePath, `
      DROP TRIGGER agent_memories_accessible_limit_before_insert;
      CREATE TRIGGER agent_memories_accessible_limit_before_insert
      BEFORE INSERT ON agent_memories
      BEGIN
        SELECT RAISE(ABORT, 'stale trigger');
      END;
    `);

    const reopened = await createStore(databasePath);
    await expect(reopened.create({
      id: 'after-trigger-upgrade',
      libraryId: 3,
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('触发器升级后的记忆'),
    })).resolves.toMatchObject({ id: 'after-trigger-upgrade' });
  });

  it('keeps legacy over-limit rows manageable without silently truncating recall', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omniflow-agent-memory-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const first = await createStore(databasePath);
    await first.close();
    stores.splice(stores.indexOf(first), 1);
    const legacyRows = Array.from({ length: 201 }, (_, index) => `
      INSERT INTO agent_memories (
        id, backend_scope, account_scope, library_id, kind, title, content,
        reason, application, revision, created_at, updated_at
      ) VALUES (
        'legacy-${String(index).padStart(3, '0')}',
        '${OWNER_SCOPE.backendScope}',
        '${OWNER_SCOPE.accountScope}',
        3,
        'project',
        '旧记忆 ${index}',
        '旧规则 ${index}',
        '旧原因 ${index}',
        '旧场景 ${index}',
        1,
        '2026-08-23T10:00:00.000Z',
        '2026-08-23T10:00:00.000Z'
      );
    `).join('\n');
    await executeDatabaseSql(databasePath, `
      DROP TRIGGER agent_memories_accessible_limit_before_insert;
      BEGIN;
      ${legacyRows}
      COMMIT;
    `);

    const reopened = await createStore(databasePath);
    expect((await reopened.list(OWNER_SCOPE, 3)).total).toBe(201);
    await expect(reopened.listCandidates(OWNER_SCOPE, 3)).rejects.toThrow(
      '当前资料库可见长期记忆超过 200 条',
    );
    await expect(reopened.create({
      id: 'legacy-overflow',
      libraryId: 3,
      now: '2026-08-23T11:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('仍然超限'),
    })).rejects.toThrow('长期记忆数量已达到上限');

    expect(await reopened.delete({
      id: 'legacy-200',
      libraryId: 3,
      ownerScope: OWNER_SCOPE,
      revision: 1,
    })).toBe(true);
    await expect(reopened.listCandidates(OWNER_SCOPE, 3)).resolves.toHaveLength(200);
  });

  it('paginates management results with a stable cursor and full query count', async () => {
    const store = await createStore();
    for (let index = 0; index < 52; index += 1) {
      await store.create({
        id: `memory-${String(index).padStart(2, '0')}`,
        libraryId: 3,
        now: '2026-08-23T10:00:00.000Z',
        ownerScope: OWNER_SCOPE,
        proposal: proposal(`分页记忆 ${index}`),
      });
    }

    const firstPage = await store.list(OWNER_SCOPE, 3, '分页记忆');
    expect(firstPage.memories).toHaveLength(50);
    expect(firstPage.total).toBe(52);
    expect(firstPage.memories.at(0)?.id).toBe('memory-00');
    expect(firstPage.memories.at(-1)?.id).toBe('memory-49');
    expect(firstPage.nextCursor).toEqual({
      id: 'memory-49',
      updatedAt: '2026-08-23T10:00:00.000Z',
    });

    const secondPage = await store.list(
      OWNER_SCOPE,
      3,
      '分页记忆',
      firstPage.nextCursor,
    );
    expect(secondPage.memories.map(item => item.id)).toEqual(['memory-50', 'memory-51']);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(secondPage.total).toBe(52);
  });

  it('uses the shared query length and SQLite ASCII case contract', async () => {
    const store = await createStore();
    await store.create({
      id: 'ascii-search',
      libraryId: 3,
      now: '2026-08-23T10:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('OpenAI Profile'),
    });
    await store.create({
      id: 'unicode-search',
      libraryId: 3,
      now: '2026-08-23T10:01:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('ÄBC'),
    });
    await store.create({
      id: 'bounded-query',
      libraryId: 3,
      now: '2026-08-23T10:02:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: {
        ...proposal('查询长度'),
        content: 'x'.repeat(120),
      },
    });

    expect((await store.list(OWNER_SCOPE, 3, 'openai')).memories.map(item => item.id)).toEqual([
      'ascii-search',
    ]);
    expect((await store.list(OWNER_SCOPE, 3, 'äbc')).total).toBe(0);
    expect((await store.list(OWNER_SCOPE, 3, `${'x'.repeat(120)}ignored`)).memories.map(
      item => item.id,
    )).toEqual(['bounded-query']);
  });

  it('caps each accessible global-plus-library set without blocking another library', async () => {
    const store = await createStore();
    for (let index = 0; index < 2; index += 1) {
      await store.create({
        id: `global-bounded-${index}`,
        now: `2026-08-23T09:00:0${index}.000Z`,
        ownerScope: OWNER_SCOPE,
        proposal: proposal(`全局有界记忆 ${index}`, 'global', 'preference'),
      });
    }
    for (let index = 0; index < 198; index += 1) {
      await store.create({
        id: `bounded-${String(index).padStart(3, '0')}`,
        libraryId: 3,
        now: `2026-08-23T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        ownerScope: OWNER_SCOPE,
        proposal: proposal(`有界记忆 ${index}`),
      });
    }

    expect(await store.listCandidates(OWNER_SCOPE, 3)).toHaveLength(200);
    await expect(store.create({
      id: 'bounded-200',
      libraryId: 3,
      now: '2026-08-23T14:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('第 201 条记忆'),
    })).rejects.toThrow('长期记忆数量已达到上限');

    await expect(store.create({
      id: 'global-overflow',
      now: '2026-08-23T14:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('会进入所有资料库的第 201 条记忆', 'global', 'preference'),
    })).rejects.toThrow('长期记忆数量已达到上限');

    await expect(store.create({
      id: 'other-owner-first',
      libraryId: 3,
      now: '2026-08-23T14:00:00.000Z',
      ownerScope: OTHER_OWNER_SCOPE,
      proposal: proposal('其他用户第一条记忆'),
    })).resolves.toMatchObject({ id: 'other-owner-first' });

    await expect(store.create({
      id: 'same-owner-other-library',
      libraryId: 4,
      now: '2026-08-23T14:00:00.000Z',
      ownerScope: OWNER_SCOPE,
      proposal: proposal('同一用户其他资料库'),
    })).resolves.toMatchObject({ id: 'same-owner-other-library' });
  });
});

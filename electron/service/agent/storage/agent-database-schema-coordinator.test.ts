import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type sqlite3 from 'sqlite3';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentDatabaseSchemaCoordinator } from './agent-database-schema-coordinator';

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => (error ? reject(error) : resolve()));
  });
}

describe('Agent database schema coordinator', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => (
      rm(directory, { force: true, recursive: true })
    )));
  });

  it('owns one bootstrap connection and releases component barriers afterward', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-schema-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const coordinator = createAgentDatabaseSchemaCoordinator();
    const initialize = vi.fn(async (database: sqlite3.Database) => {
      await exec(database, 'CREATE TABLE agent_test (id TEXT PRIMARY KEY); PRAGMA user_version = 2;');
    });
    const options = {
      initialize,
      requiredTables: ['agent_test'],
      userVersion: 2,
    };

    await Promise.all([
      coordinator.bootstrap(databasePath, options),
      coordinator.bootstrap(databasePath, options),
    ]);
    await coordinator.bootstrap(databasePath, options);
    expect(initialize).toHaveBeenCalledOnce();

    const legacyInitializer = vi.fn(async () => undefined);
    await coordinator.ensureReady(databasePath, 'session', legacyInitializer, {});
    expect(legacyInitializer).not.toHaveBeenCalled();
  });

  it('rolls back an incomplete schema atomically and remains retryable', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-schema-retry-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const coordinator = createAgentDatabaseSchemaCoordinator();

    await expect(coordinator.bootstrap(databasePath, {
      initialize: async database => {
        await exec(database, `
          CREATE TABLE agent_partial (id TEXT PRIMARY KEY);
          PRAGMA user_version = 2;
        `);
      },
      requiredTables: ['agent_complete', 'agent_partial'],
      userVersion: 2,
    })).rejects.toThrow('缺少表');

    await expect(coordinator.bootstrap(databasePath, {
      initialize: async database => {
        await exec(database, `
          CREATE TABLE agent_partial (id TEXT PRIMARY KEY);
          CREATE TABLE agent_complete (id TEXT PRIMARY KEY);
          PRAGMA user_version = 2;
        `);
      },
      requiredTables: ['agent_complete', 'agent_partial'],
      userVersion: 2,
    })).resolves.toBeUndefined();
  });

  it('fails closed when a required column is missing', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-schema-column-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const coordinator = createAgentDatabaseSchemaCoordinator();

    await expect(coordinator.bootstrap(databasePath, {
      initialize: async database => {
        await exec(database, 'CREATE TABLE agent_test (id TEXT PRIMARY KEY); PRAGMA user_version = 2;');
      },
      requiredColumns: { agent_test: ['id', 'status'] },
      requiredTables: ['agent_test'],
      userVersion: 2,
    })).rejects.toThrow('agent_test 缺少列：status');
  });

  it('fails closed when a required index is missing', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-schema-index-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const coordinator = createAgentDatabaseSchemaCoordinator();

    await expect(coordinator.bootstrap(databasePath, {
      initialize: async database => {
        await exec(database, 'CREATE TABLE agent_test (id TEXT PRIMARY KEY); PRAGMA user_version = 2;');
      },
      requiredIndexes: ['agent_test_status_idx'],
      requiredTables: ['agent_test'],
      userVersion: 2,
    })).rejects.toThrow('缺少索引：agent_test_status_idx');
  });

  it('fails closed when a required trigger is missing', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-agent-schema-trigger-'));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, 'agent.sqlite3');
    const coordinator = createAgentDatabaseSchemaCoordinator();

    await expect(coordinator.bootstrap(databasePath, {
      initialize: async database => {
        await exec(database, 'CREATE TABLE agent_test (id TEXT PRIMARY KEY); PRAGMA user_version = 2;');
      },
      requiredTables: ['agent_test'],
      requiredTriggers: ['agent_test_validate_insert'],
      userVersion: 2,
    })).rejects.toThrow('缺少触发器：agent_test_validate_insert');
  });

  it('serializes different components for the same database path', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    const events: string[] = [];
    let releaseSession!: () => void;
    const sessionReady = new Promise<void>(resolve => {
      releaseSession = resolve;
    });

    const session = coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      async () => {
        events.push('session:start');
        await sessionReady;
        events.push('session:end');
      },
    );
    const memory = coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'memory',
      async () => {
        events.push('memory');
      },
    );

    await Promise.resolve();
    expect(events).toEqual(['session:start']);
    releaseSession();
    await Promise.all([session, memory]);
    expect(events).toEqual(['session:start', 'session:end', 'memory']);
  });

  it('runs a component once when concurrent callers share no connection target', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    let calls = 0;
    const initializer = async () => {
      calls += 1;
    };

    await Promise.all([
      coordinator.ensureReady('/tmp/omniflow-agent.sqlite3', 'session', initializer),
      coordinator.ensureReady('/tmp/omniflow-agent.sqlite3', 'session', initializer),
    ]);

    expect(calls).toBe(1);
  });

  it('reruns idempotent initialization for each newly opened connection', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    const calls: object[] = [];
    const firstConnection = {};
    const secondConnection = {};
    const initialize = async (connection: object) => {
      calls.push(connection);
    };

    await coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      () => initialize(firstConnection),
      firstConnection,
    );
    await coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      () => initialize(firstConnection),
      firstConnection,
    );
    await coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      () => initialize(secondConnection),
      secondConnection,
    );

    expect(calls).toEqual([firstConnection, secondConnection]);
  });

  it('tracks initialization per component when a connection is shared', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    const connection = {};
    const calls: string[] = [];

    await Promise.all([
      coordinator.ensureReady(
        '/tmp/omniflow-agent.sqlite3',
        'session',
        async () => { calls.push('session'); },
        connection,
      ),
      coordinator.ensureReady(
        '/tmp/omniflow-agent.sqlite3',
        'memory',
        async () => { calls.push('memory'); },
        connection,
      ),
    ]);

    expect(calls).toEqual(['session', 'memory']);
  });

  it('allows a failed initializer to retry without blocking later calls', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    let calls = 0;

    await expect(coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      async () => {
        calls += 1;
        throw new Error('schema unavailable');
      },
    )).rejects.toThrow('schema unavailable');

    await expect(coordinator.ensureReady(
      '/tmp/omniflow-agent.sqlite3',
      'session',
      async () => {
        calls += 1;
      },
    )).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('normalizes equivalent relative and absolute database paths', async () => {
    const coordinator = createAgentDatabaseSchemaCoordinator();
    let calls = 0;
    const relativePath = './tmp/../tmp/agent.sqlite3';
    const initializer = async () => {
      calls += 1;
    };

    await coordinator.ensureReady(relativePath, 'session', initializer);
    await coordinator.ensureReady(path.resolve(relativePath), 'session', initializer);

    expect(calls).toBe(1);
  });
});

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';

type SchemaInitializer = () => Promise<void>;

interface DatabaseSchemaState {
  bootstrapGeneration: number;
  bootstrapPromise: Promise<void> | null;
  completedComponents: Set<string>;
  initializedConnections: WeakMap<object, Set<string>>;
  tail: Promise<void>;
}

interface AgentDatabaseBootstrapOptions {
  initialize: (database: sqlite3.Database) => Promise<void>;
  requiredColumns?: Readonly<Record<string, readonly string[]>>;
  requiredIndexes?: readonly string[];
  requiredTables: readonly string[];
  requiredTriggers?: readonly string[];
  userVersion: number;
}

function normalizeDatabaseKey(databasePath: string): string {
  if (databasePath === ':memory:') return databasePath;
  return path.resolve(databasePath);
}

function openDatabase(databasePath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(
      databasePath,
      sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
      error => (error ? reject(error) : resolve(database)),
    );
  });
}

function exec(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => (error ? reject(error) : resolve()));
  });
}

function all<T>(database: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all(sql, (error, rows) => (error ? reject(error) : resolve(rows as T[])));
  });
}

function get<T>(database: sqlite3.Database, sql: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => (error ? reject(error) : resolve(row as T | undefined)));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => (error ? reject(error) : resolve()));
  });
}

function normalizeRequiredTables(tables: readonly string[]): string[] {
  const normalized = Array.from(new Set(tables.map(table => String(table || '').trim())));
  if (
    normalized.length === 0
    || normalized.some(table => !/^[a-z][a-z0-9_]*$/u.test(table))
  ) {
    throw new Error('Agent 数据库必需表清单无效');
  }
  return normalized.sort();
}

function normalizeIdentifiers(values: readonly string[] | undefined, label: string): string[] {
  const normalized = Array.from(new Set((values || []).map(value => String(value || '').trim())));
  if (normalized.some(value => !/^[a-z][a-z0-9_]*$/u.test(value))) {
    throw new Error(`${label}清单无效`);
  }
  return normalized.sort();
}

function normalizeRequiredColumns(
  columns: Readonly<Record<string, readonly string[]>> | undefined,
): Map<string, string[]> {
  const normalized = new Map<string, string[]>();
  for (const [table, tableColumns] of Object.entries(columns || {})) {
    const normalizedTable = normalizeIdentifiers([table], 'Agent 数据库表')[0];
    const normalizedColumns = normalizeIdentifiers(tableColumns, 'Agent 数据库列');
    if (!normalizedTable || normalizedColumns.length === 0) {
      throw new Error('Agent 数据库必需列清单无效');
    }
    normalized.set(normalizedTable, normalizedColumns);
  }
  return normalized;
}

function normalizeUserVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new Error('Agent 数据库 schema 版本无效');
  }
  return version;
}

/**
 * Owns the production Agent database bootstrap and its readiness barrier.
 *
 * Production startup uses one exclusive connection and one transaction to run
 * every domain initializer, verify the complete schema, and only then release
 * business connections. `ensureReady` remains for isolated in-memory Store
 * tests and compatibility callers; after a production bootstrap it only waits
 * for the barrier and never runs Store DDL on a business connection.
 */
export function createAgentDatabaseSchemaCoordinator() {
  const states = new Map<string, DatabaseSchemaState>();

  function getState(key: string): DatabaseSchemaState {
    let state = states.get(key);
    if (!state) {
      state = {
        bootstrapGeneration: 0,
        bootstrapPromise: null,
        completedComponents: new Set(),
        initializedConnections: new WeakMap(),
        tail: Promise.resolve(),
      };
      states.set(key, state);
    }
    return state;
  }

  async function bootstrap(
    databasePath: string,
    options: AgentDatabaseBootstrapOptions,
  ): Promise<void> {
    if (databasePath === ':memory:') {
      throw new Error('Agent 数据库 bootstrap 不支持临时内存连接');
    }
    const key = normalizeDatabaseKey(databasePath);
    const requiredTables = normalizeRequiredTables(options.requiredTables);
    const requiredColumns = normalizeRequiredColumns(options.requiredColumns);
    const requiredIndexes = normalizeIdentifiers(options.requiredIndexes, 'Agent 数据库索引');
    const requiredTriggers = normalizeIdentifiers(options.requiredTriggers, 'Agent 数据库触发器');
    const userVersion = normalizeUserVersion(options.userVersion);
    if (typeof options.initialize !== 'function') {
      throw new Error('Agent 数据库 schema initializer 无效');
    }
    const state = getState(key);
    if (state.bootstrapGeneration > 0) return;
    if (state.bootstrapPromise) return state.bootstrapPromise;

    const previous = state.tail;
    const next = previous.then(async () => {
      await mkdir(path.dirname(key), { recursive: true });
      const database = await openDatabase(key);
      let closeError: unknown;
      try {
        await exec(database, `
          PRAGMA busy_timeout = 5000;
          PRAGMA foreign_keys = ON;
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA locking_mode = EXCLUSIVE;
        `);
        await exec(database, 'BEGIN EXCLUSIVE;');
        try {
          await options.initialize(database);

          const versionRow = await get<{ user_version: number }>(database, 'PRAGMA user_version');
          if (Number(versionRow?.user_version || 0) !== userVersion) {
            throw new Error(`Agent 数据库 schema 版本自检失败：${versionRow?.user_version || 0}`);
          }
          const tableRows = await all<{ name: string }>(database, `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
          `);
          const availableTables = new Set(tableRows.map(row => row.name));
          const missingTables = requiredTables.filter(table => !availableTables.has(table));
          if (missingTables.length > 0) {
            throw new Error(`Agent 数据库 schema 自检缺少表：${missingTables.join(', ')}`);
          }
          for (const [table, columns] of requiredColumns) {
            if (!availableTables.has(table)) {
              throw new Error(`Agent 数据库 schema 自检缺少表：${table}`);
            }
            const columnRows = await all<{ name: string }>(
              database,
              `PRAGMA table_info(${table})`,
            );
            const availableColumns = new Set(columnRows.map(row => row.name));
            const missingColumns = columns.filter(column => !availableColumns.has(column));
            if (missingColumns.length > 0) {
              throw new Error(
                `Agent 数据库 schema 自检 ${table} 缺少列：${missingColumns.join(', ')}`,
              );
            }
          }
          const schemaObjects = await all<{ name: string; type: string }>(database, `
            SELECT name, type
            FROM sqlite_master
            WHERE type IN ('index', 'trigger')
          `);
          const availableIndexes = new Set(
            schemaObjects.filter(row => row.type === 'index').map(row => row.name),
          );
          const availableTriggers = new Set(
            schemaObjects.filter(row => row.type === 'trigger').map(row => row.name),
          );
          const missingIndexes = requiredIndexes.filter(index => !availableIndexes.has(index));
          if (missingIndexes.length > 0) {
            throw new Error(`Agent 数据库 schema 自检缺少索引：${missingIndexes.join(', ')}`);
          }
          const missingTriggers = requiredTriggers.filter(trigger => !availableTriggers.has(trigger));
          if (missingTriggers.length > 0) {
            throw new Error(`Agent 数据库 schema 自检缺少触发器：${missingTriggers.join(', ')}`);
          }
          await exec(database, 'COMMIT;');
        } catch (error) {
          await exec(database, 'ROLLBACK;').catch(() => undefined);
          throw error;
        }
      } finally {
        try {
          await close(database);
        } catch (error) {
          closeError = error;
        }
      }
      if (closeError !== undefined) throw closeError;
      state.bootstrapGeneration += 1;
      state.completedComponents.clear();
      state.initializedConnections = new WeakMap();
    });
    state.bootstrapPromise = next;
    state.tail = next.catch(() => undefined);
    try {
      await next;
    } finally {
      if (state.bootstrapPromise === next) state.bootstrapPromise = null;
    }
  }

  async function ensureReady(
    databasePath: string,
    component: string,
    initializer: SchemaInitializer,
    connection?: object,
  ): Promise<void> {
    const key = normalizeDatabaseKey(databasePath);
    const normalizedComponent = String(component || '').trim();
    if (!normalizedComponent) throw new Error('Agent 数据库 schema component 无效');

    const state = getState(key);
    if (state.bootstrapPromise) await state.bootstrapPromise;
    if (state.bootstrapGeneration > 0) return;
    const isConnectionInitialized = (target: object): boolean => (
      state?.initializedConnections.get(target)?.has(normalizedComponent) || false
    );
    const hasCompleted = connection
      ? isConnectionInitialized(connection)
      : state.completedComponents.has(normalizedComponent);
    if (hasCompleted) {
      await state.tail;
      return;
    }

    const currentState = state;
    const previous = currentState.tail;
    const next = previous.then(async () => {
      const alreadyInitialized = connection
        ? currentState.initializedConnections.get(connection)?.has(normalizedComponent) || false
        : currentState.completedComponents.has(normalizedComponent);
      if (alreadyInitialized) return;
      await initializer();
      if (connection) {
        const initializedComponents = currentState.initializedConnections.get(connection) || new Set();
        initializedComponents.add(normalizedComponent);
        currentState.initializedConnections.set(connection, initializedComponents);
      } else currentState.completedComponents.add(normalizedComponent);
    });
    currentState.tail = next.catch(() => undefined);
    // A failed component remains retryable, but later components cannot
    // overtake the failed initializer in the same queue.
    await next;
  }

  function reset(databasePath?: string): void {
    if (databasePath === undefined) {
      states.clear();
      return;
    }
    states.delete(normalizeDatabaseKey(databasePath));
  }

  return { bootstrap, ensureReady, reset };
}

export const agentDatabaseSchemaCoordinator = createAgentDatabaseSchemaCoordinator();
export type AgentDatabaseSchemaCoordinator = ReturnType<
  typeof createAgentDatabaseSchemaCoordinator
>;

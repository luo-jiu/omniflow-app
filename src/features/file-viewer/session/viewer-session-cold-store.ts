import {
  isViewerAccountScope,
  isViewerResourceKey,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import { viewerPolicyUsesDeviceCold } from './viewer-session-policies';
import type { ViewerResourceKey, ViewerSessionSnapshot } from './viewer-session.types';

const COLD_DATABASE_NAME = 'omniflow-viewer-sessions';
const COLD_DATABASE_VERSION = 1;
const COLD_STORE_NAME = 'snapshots';
const COLD_STORAGE_SCHEMA_VERSION = 1;
const RECORD_OVERHEAD_BYTES = 512;

export const VIEWER_SESSION_COLD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const VIEWER_SESSION_COLD_MAX_ENTRY_BYTES = 64 * 1024;
export const VIEWER_SESSION_COLD_ACCOUNT_MAX_BYTES = 8 * 1024 * 1024;

export type ViewerSessionColdStoreErrorCode =
  | 'entry-too-large'
  | 'invalid-snapshot'
  | 'storage-unavailable';

export class ViewerSessionColdStoreError extends Error {
  constructor(
    public readonly code: ViewerSessionColdStoreErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ViewerSessionColdStoreError';
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface ViewerSessionColdPersistenceRecord {
  storageSchemaVersion: number;
  resourceKey: string;
  accountScope: string;
  libraryId: number;
  expiresAt: number;
  estimatedBytes: number;
  snapshot: ViewerSessionSnapshot;
}

export interface ViewerSessionColdPersistence {
  deleteMany(resourceKeys: string[]): Promise<void>;
  get(resourceKey: string): Promise<unknown>;
  getAllByAccount(accountScope: string): Promise<unknown[]>;
  getAllByLibrary(accountScope: string, libraryId: number): Promise<unknown[]>;
  put(record: ViewerSessionColdPersistenceRecord, evictedResourceKeys: string[]): Promise<void>;
}

interface ViewerSessionColdStoreOptions {
  accountMaxBytes?: number;
  maxEntryBytes?: number;
  now?: () => number;
  persistence?: ViewerSessionColdPersistence;
  retentionMs?: number;
}

interface ViewerSessionColdReadRequirements {
  contentRevision?: string | null;
  schemaVersion?: number;
}

function normalizePositiveBudget(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function isDeviceColdCapable(identity: ViewerResourceKey): boolean {
  return isViewerResourceKey(identity) && viewerPolicyUsesDeviceCold(identity.viewerKind);
}

function isPlainJson(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    const valid = value.every(item => isPlainJson(item, seen));
    seen.delete(value);
    return valid;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const valid = Object.values(value as Record<string, unknown>)
    .every(item => isPlainJson(item, seen));
  seen.delete(value);
  return valid;
}

function serializeSnapshot(snapshot: ViewerSessionSnapshot): string | null {
  try {
    if (
      !isViewerResourceKey(snapshot.identity)
      || !isDeviceColdCapable(snapshot.identity)
      || !Number.isSafeInteger(snapshot.schemaVersion)
      || snapshot.schemaVersion <= 0
      || !Number.isFinite(snapshot.savedAt)
      || snapshot.savedAt <= 0
      || (
        snapshot.contentRevision !== null
        && (typeof snapshot.contentRevision !== 'string' || !snapshot.contentRevision.trim())
      )
      || !isPlainJson(snapshot.payload)
    ) {
      return null;
    }
    return JSON.stringify(snapshot);
  } catch {
    return null;
  }
}

function estimateRecordBytes(serializedSnapshot: string): number {
  return new TextEncoder().encode(serializedSnapshot).byteLength + RECORD_OVERHEAD_BYTES;
}

function parsePersistedRecord(value: unknown): ViewerSessionColdPersistenceRecord | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ViewerSessionColdPersistenceRecord>;
  const snapshot = candidate.snapshot as ViewerSessionSnapshot | undefined;
  if (!snapshot) return null;
  const serializedSnapshot = serializeSnapshot(snapshot);
  if (
    candidate.storageSchemaVersion !== COLD_STORAGE_SCHEMA_VERSION
    || serializedSnapshot == null
    || !Number.isFinite(candidate.expiresAt)
    || Number(candidate.expiresAt) <= snapshot.savedAt
    || !Number.isSafeInteger(candidate.estimatedBytes)
    || candidate.estimatedBytes !== estimateRecordBytes(serializedSnapshot)
  ) {
    return null;
  }
  const resourceKey = serializeViewerResourceKey(snapshot.identity);
  if (
    candidate.resourceKey !== resourceKey
    || candidate.accountScope !== snapshot.identity.accountScope
    || candidate.libraryId !== snapshot.identity.libraryId
  ) {
    return null;
  }
  return candidate as ViewerSessionColdPersistenceRecord;
}

function cloneSnapshot<TPayload>(snapshot: ViewerSessionSnapshot): ViewerSessionSnapshot<TPayload> {
  return JSON.parse(JSON.stringify(snapshot)) as ViewerSessionSnapshot<TPayload>;
}

function createStorageError(message: string, cause: unknown): ViewerSessionColdStoreError {
  if (cause instanceof ViewerSessionColdStoreError) return cause;
  return new ViewerSessionColdStoreError('storage-unavailable', message, { cause });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

class IndexedDbViewerSessionColdPersistence implements ViewerSessionColdPersistence {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async deleteMany(resourceKeys: string[]): Promise<void> {
    if (resourceKeys.length === 0) return;
    const database = await this.openDatabase();
    const transaction = database.transaction(COLD_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    const store = transaction.objectStore(COLD_STORE_NAME);
    resourceKeys.forEach(resourceKey => store.delete(resourceKey));
    await completion;
  }

  async get(resourceKey: string): Promise<unknown> {
    const database = await this.openDatabase();
    const transaction = database.transaction(COLD_STORE_NAME, 'readonly');
    const completion = transactionToPromise(transaction);
    const result = await requestToPromise(
      transaction.objectStore(COLD_STORE_NAME).get(resourceKey),
    );
    await completion;
    return result;
  }

  async getAllByAccount(accountScope: string): Promise<unknown[]> {
    return this.getAllByIndex('accountScope', accountScope);
  }

  async getAllByLibrary(accountScope: string, libraryId: number): Promise<unknown[]> {
    return this.getAllByIndex('accountLibrary', [accountScope, libraryId]);
  }

  async put(
    record: ViewerSessionColdPersistenceRecord,
    evictedResourceKeys: string[],
  ): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(COLD_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    const store = transaction.objectStore(COLD_STORE_NAME);
    evictedResourceKeys.forEach(resourceKey => store.delete(resourceKey));
    store.put(record);
    await completion;
  }

  private async getAllByIndex(indexName: string, key: IDBValidKey): Promise<unknown[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(COLD_STORE_NAME, 'readonly');
    const completion = transactionToPromise(transaction);
    const result = await requestToPromise(
      transaction.objectStore(COLD_STORE_NAME).index(indexName).getAll(IDBKeyRange.only(key)),
    );
    await completion;
    return result;
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof globalThis.indexedDB === 'undefined') {
      return Promise.reject(new ViewerSessionColdStoreError(
        'storage-unavailable',
        'IndexedDB is unavailable',
      ));
    }
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(COLD_DATABASE_NAME, COLD_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(COLD_STORE_NAME)
          ? request.transaction!.objectStore(COLD_STORE_NAME)
          : database.createObjectStore(COLD_STORE_NAME, { keyPath: 'resourceKey' });
        if (!store.indexNames.contains('accountScope')) {
          store.createIndex('accountScope', 'accountScope', { unique: false });
        }
        if (!store.indexNames.contains('accountLibrary')) {
          store.createIndex('accountLibrary', ['accountScope', 'libraryId'], { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          this.databasePromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
    });
    this.databasePromise = opening.catch((error: unknown) => {
      this.databasePromise = null;
      if (error instanceof ViewerSessionColdStoreError) throw error;
      throw new ViewerSessionColdStoreError(
        'storage-unavailable',
        'Unable to open the viewer session database',
        { cause: error },
      );
    });
    return this.databasePromise;
  }
}

export class ViewerSessionColdStore {
  private readonly accountMaxBytes: number;
  private readonly maxEntryBytes: number;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly persistence: ViewerSessionColdPersistence;
  private readonly retentionMs: number;

  constructor(options: ViewerSessionColdStoreOptions = {}) {
    this.accountMaxBytes = normalizePositiveBudget(
      options.accountMaxBytes,
      VIEWER_SESSION_COLD_ACCOUNT_MAX_BYTES,
    );
    this.maxEntryBytes = normalizePositiveBudget(
      options.maxEntryBytes,
      VIEWER_SESSION_COLD_MAX_ENTRY_BYTES,
    );
    this.now = options.now ?? Date.now;
    this.persistence = options.persistence ?? new IndexedDbViewerSessionColdPersistence();
    this.retentionMs = normalizePositiveBudget(
      options.retentionMs,
      VIEWER_SESSION_COLD_RETENTION_MS,
    );
  }

  async readSnapshot<TPayload>(
    identity: ViewerResourceKey,
    requirements: ViewerSessionColdReadRequirements = {},
  ): Promise<ViewerSessionSnapshot<TPayload> | null> {
    if (!isDeviceColdCapable(identity)) return null;
    await this.mutationQueue;
    const resourceKey = serializeViewerResourceKey(identity);
    let rawRecord: unknown;
    try {
      rawRecord = await this.persistence.get(resourceKey);
    } catch (error) {
      throw createStorageError('Unable to read the viewer session snapshot', error);
    }
    if (rawRecord == null) return null;
    const record = parsePersistedRecord(rawRecord);
    if (
      !record
      || record.expiresAt <= this.now()
      || record.estimatedBytes > this.maxEntryBytes
      || requirements.schemaVersion !== undefined
        && record.snapshot.schemaVersion !== requirements.schemaVersion
      || requirements.contentRevision !== undefined
        && record.snapshot.contentRevision !== requirements.contentRevision
    ) {
      await this.deleteResource(identity);
      return null;
    }
    return cloneSnapshot<TPayload>(record.snapshot);
  }

  writeSnapshot<TPayload>(
    snapshot: ViewerSessionSnapshot<TPayload>,
  ): Promise<ViewerSessionSnapshot<TPayload>> {
    const serializedSnapshot = serializeSnapshot(snapshot);
    if (!serializedSnapshot) {
      return Promise.reject(new ViewerSessionColdStoreError(
        'invalid-snapshot',
        'Viewer session snapshot is not device-persistable',
      ));
    }
    const estimatedBytes = estimateRecordBytes(serializedSnapshot);
    if (estimatedBytes > this.maxEntryBytes || estimatedBytes > this.accountMaxBytes) {
      return Promise.reject(new ViewerSessionColdStoreError(
        'entry-too-large',
        'Viewer session snapshot exceeds the Cold Store entry limit',
      ));
    }
    return this.enqueueMutation(async () => {
      const identity = snapshot.identity;
      const resourceKey = serializeViewerResourceKey(identity);
      let rawRecords: unknown[];
      try {
        rawRecords = await this.persistence.getAllByAccount(identity.accountScope);
      } catch (error) {
        throw createStorageError('Unable to inspect viewer session quota', error);
      }
      const validRecords: ViewerSessionColdPersistenceRecord[] = [];
      const malformedResourceKeys: string[] = [];
      for (const rawRecord of rawRecords) {
        const rawResourceKey = typeof (rawRecord as { resourceKey?: unknown })?.resourceKey === 'string'
          ? String((rawRecord as { resourceKey: string }).resourceKey)
          : null;
        const record = parsePersistedRecord(rawRecord);
        if (!record || record.expiresAt <= this.now() || record.estimatedBytes > this.maxEntryBytes) {
          if (rawResourceKey) malformedResourceKeys.push(rawResourceKey);
          continue;
        }
        if (record.resourceKey !== resourceKey) validRecords.push(record);
      }
      let nextTotalBytes = validRecords.reduce(
        (total, record) => total + record.estimatedBytes,
        estimatedBytes,
      );
      const evictedResourceKeys = [...malformedResourceKeys];
      validRecords
        .sort((left, right) => left.snapshot.savedAt - right.snapshot.savedAt)
        .some((record) => {
          if (nextTotalBytes <= this.accountMaxBytes) return true;
          nextTotalBytes -= record.estimatedBytes;
          evictedResourceKeys.push(record.resourceKey);
          return false;
        });
      const savedAt = this.now();
      const storedSnapshot = JSON.parse(serializedSnapshot) as ViewerSessionSnapshot;
      const record: ViewerSessionColdPersistenceRecord = {
        storageSchemaVersion: COLD_STORAGE_SCHEMA_VERSION,
        resourceKey,
        accountScope: identity.accountScope,
        libraryId: identity.libraryId,
        expiresAt: Math.max(savedAt, storedSnapshot.savedAt) + this.retentionMs,
        estimatedBytes,
        snapshot: storedSnapshot,
      };
      try {
        await this.persistence.put(record, Array.from(new Set(evictedResourceKeys)));
      } catch (error) {
        throw createStorageError('Unable to persist the viewer session snapshot', error);
      }
      return cloneSnapshot<TPayload>(record.snapshot);
    });
  }

  deleteResource(identity: ViewerResourceKey): Promise<void> {
    return this.deleteResources([identity]);
  }

  deleteResources(identities: ViewerResourceKey[]): Promise<void> {
    const resourceKeys = Array.from(new Set(
      identities
        .filter(isViewerResourceKey)
        .map(serializeViewerResourceKey),
    ));
    if (resourceKeys.length === 0) return Promise.resolve();
    return this.enqueueMutation(async () => {
      try {
        await this.persistence.deleteMany(resourceKeys);
      } catch (error) {
        throw createStorageError('Unable to delete viewer session snapshots', error);
      }
    });
  }

  async deleteLibrary(accountScope: string, libraryId: number): Promise<void> {
    if (!isViewerAccountScope(accountScope) || !Number.isSafeInteger(libraryId) || libraryId <= 0) {
      return;
    }
    await this.enqueueMutation(async () => {
      try {
        const records = await this.persistence.getAllByLibrary(accountScope, libraryId);
        const resourceKeys = records.flatMap((record) => {
          const resourceKey = (record as { resourceKey?: unknown })?.resourceKey;
          return typeof resourceKey === 'string' ? [resourceKey] : [];
        });
        await this.persistence.deleteMany(resourceKeys);
      } catch (error) {
        throw createStorageError('Unable to delete viewer sessions for the library', error);
      }
    });
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(mutation, mutation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const viewerSessionColdStore = new ViewerSessionColdStore();

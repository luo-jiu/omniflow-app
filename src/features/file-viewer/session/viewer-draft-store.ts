import {
  isViewerDraftKey,
  isViewerResourceKey,
  serializeViewerResourceKey,
} from './viewer-session-identity';
import { viewerSessionPolicies } from './viewer-session-policies';
import type { ViewerDraftKey, ViewerResourceKey } from './viewer-session.types';

const DRAFT_DATABASE_NAME = 'omniflow-viewer-drafts';
const DRAFT_DATABASE_VERSION = 1;
const DRAFT_STORE_NAME = 'drafts';
const DRAFT_SCHEMA_VERSION = 1;

export const VIEWER_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const VIEWER_DRAFT_MAX_BYTES = 5 * 1024 * 1024;
export const VIEWER_DRAFT_ACCOUNT_MAX_BYTES = 50 * 1024 * 1024;

export type ViewerDraftStoreErrorCode =
  | 'account-quota-exceeded'
  | 'draft-invalidated'
  | 'draft-too-large'
  | 'invalid-draft-key'
  | 'storage-unavailable';

export class ViewerDraftStoreError extends Error {
  constructor(
    public readonly code: ViewerDraftStoreErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ViewerDraftStoreError';
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface ViewerDraftRecord {
  schemaVersion: number;
  key: ViewerDraftKey;
  savedAt: number;
  expiresAt: number;
  estimatedBytes: number;
  content: string;
}

export interface ViewerDraftPersistenceRecord extends ViewerDraftRecord {
  resourceKey: string;
  accountScope: string;
}

export interface ViewerDraftPersistence {
  delete(resourceKey: string): Promise<void>;
  deleteMany(resourceKeys: string[]): Promise<void>;
  get(resourceKey: string): Promise<unknown>;
  getAllByAccount(accountScope: string): Promise<unknown[]>;
  put(record: ViewerDraftPersistenceRecord): Promise<void>;
}

interface ViewerDraftStoreOptions {
  accountMaxBytes?: number;
  maxDraftBytes?: number;
  now?: () => number;
  persistence?: ViewerDraftPersistence;
  retentionMs?: number;
}

interface AccountUsage {
  entries: Map<string, number>;
  totalBytes: number;
}

function normalizePositiveBudget(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

function estimateDraftBytes(content: string): number {
  return new TextEncoder().encode(content).byteLength + 512;
}

function isDraftCapableIdentity(identity: ViewerResourceKey): boolean {
  return isViewerResourceKey(identity) && viewerSessionPolicies[identity.viewerKind].hasDraft;
}

function parsePersistedRecord(value: unknown): ViewerDraftPersistenceRecord | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ViewerDraftPersistenceRecord>;
  if (
    candidate.schemaVersion !== DRAFT_SCHEMA_VERSION
    || !isViewerDraftKey(candidate.key)
    || !isDraftCapableIdentity(candidate.key)
    || typeof candidate.content !== 'string'
    || !Number.isFinite(candidate.savedAt)
    || Number(candidate.savedAt) <= 0
    || !Number.isFinite(candidate.expiresAt)
    || Number(candidate.expiresAt) <= Number(candidate.savedAt)
    || !Number.isSafeInteger(candidate.estimatedBytes)
    || Number(candidate.estimatedBytes) <= 0
  ) {
    return null;
  }
  if (candidate.estimatedBytes !== estimateDraftBytes(candidate.content)) return null;
  const resourceKey = serializeViewerResourceKey(candidate.key);
  if (
    candidate.resourceKey !== resourceKey
    || candidate.accountScope !== candidate.key.accountScope
  ) {
    return null;
  }
  return candidate as ViewerDraftPersistenceRecord;
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

class IndexedDbViewerDraftPersistence implements ViewerDraftPersistence {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async delete(resourceKey: string): Promise<void> {
    await this.deleteMany([resourceKey]);
  }

  async deleteMany(resourceKeys: string[]): Promise<void> {
    if (resourceKeys.length === 0) return;
    const database = await this.openDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    const store = transaction.objectStore(DRAFT_STORE_NAME);
    resourceKeys.forEach((resourceKey) => store.delete(resourceKey));
    await completion;
  }

  async get(resourceKey: string): Promise<unknown> {
    const database = await this.openDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readonly');
    const completion = transactionToPromise(transaction);
    const request = transaction.objectStore(DRAFT_STORE_NAME).get(resourceKey);
    const result = await requestToPromise(request);
    await completion;
    return result;
  }

  async getAllByAccount(accountScope: string): Promise<unknown[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readonly');
    const completion = transactionToPromise(transaction);
    const request = transaction
      .objectStore(DRAFT_STORE_NAME)
      .index('accountScope')
      .getAll(IDBKeyRange.only(accountScope));
    const result = await requestToPromise(request);
    await completion;
    return result;
  }

  async put(record: ViewerDraftPersistenceRecord): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
    const completion = transactionToPromise(transaction);
    transaction.objectStore(DRAFT_STORE_NAME).put(record);
    await completion;
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (typeof globalThis.indexedDB === 'undefined') {
      return Promise.reject(new ViewerDraftStoreError(
        'storage-unavailable',
        'IndexedDB is unavailable',
      ));
    }
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(DRAFT_DATABASE_NAME, DRAFT_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(DRAFT_STORE_NAME)
          ? request.transaction!.objectStore(DRAFT_STORE_NAME)
          : database.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'resourceKey' });
        if (!store.indexNames.contains('accountScope')) {
          store.createIndex('accountScope', 'accountScope', { unique: false });
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
    const guarded: Promise<IDBDatabase> = opening.catch((error: unknown) => {
      this.databasePromise = null;
      if (error instanceof ViewerDraftStoreError) throw error;
      throw new ViewerDraftStoreError(
        'storage-unavailable',
        'Unable to open the viewer draft database',
        { cause: error },
      );
    });
    this.databasePromise = guarded;
    return guarded;
  }
}

export class ViewerDraftStore {
  private readonly accountMaxBytes: number;
  private readonly accountUsage = new Map<string, AccountUsage>();
  private readonly maxDraftBytes: number;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly persistence: ViewerDraftPersistence;
  private readonly retentionMs: number;
  private readonly writeGenerations = new Map<string, number>();

  constructor(options: ViewerDraftStoreOptions = {}) {
    this.accountMaxBytes = normalizePositiveBudget(
      options.accountMaxBytes,
      VIEWER_DRAFT_ACCOUNT_MAX_BYTES,
    );
    this.maxDraftBytes = normalizePositiveBudget(options.maxDraftBytes, VIEWER_DRAFT_MAX_BYTES);
    this.now = options.now ?? Date.now;
    this.persistence = options.persistence ?? new IndexedDbViewerDraftPersistence();
    this.retentionMs = normalizePositiveBudget(options.retentionMs, VIEWER_DRAFT_RETENTION_MS);
  }

  async readLatest(identity: ViewerResourceKey): Promise<ViewerDraftRecord | null> {
    if (!isDraftCapableIdentity(identity)) return null;
    await this.mutationQueue;
    const resourceKey = serializeViewerResourceKey(identity);
    const rawRecord = await this.persistence.get(resourceKey);
    if (rawRecord == null) return null;
    const record = parsePersistedRecord(rawRecord);
    if (
      !record
      || record.expiresAt <= this.now()
      || record.estimatedBytes > this.maxDraftBytes
    ) {
      await this.deleteDraft(identity);
      return null;
    }
    return {
      schemaVersion: record.schemaVersion,
      key: { ...record.key },
      savedAt: record.savedAt,
      expiresAt: record.expiresAt,
      estimatedBytes: record.estimatedBytes,
      content: record.content,
    };
  }

  deleteDraft(identity: ViewerResourceKey): Promise<void> {
    return this.deleteDrafts([identity]);
  }

  deleteDrafts(identities: ViewerResourceKey[]): Promise<void> {
    const validIdentities = identities.filter(isDraftCapableIdentity);
    if (validIdentities.length === 0) return Promise.resolve();
    return this.enqueueMutation(async () => {
      const entries = Array.from(new Map(validIdentities.map((identity) => (
        [serializeViewerResourceKey(identity), identity] as const
      ))).entries());
      await this.persistence.deleteMany(entries.map(([resourceKey]) => resourceKey));
      entries.forEach(([resourceKey, identity]) => {
        const usage = this.accountUsage.get(identity.accountScope);
        const estimatedBytes = usage?.entries.get(resourceKey) ?? 0;
        usage?.entries.delete(resourceKey);
        if (usage) usage.totalBytes = Math.max(0, usage.totalBytes - estimatedBytes);
      });
    });
  }

  discardDrafts(identities: ViewerResourceKey[]): Promise<void> {
    const validIdentities = identities.filter(isDraftCapableIdentity);
    if (validIdentities.length === 0) return Promise.resolve();
    const entries = Array.from(new Map(validIdentities.map((identity) => (
      [serializeViewerResourceKey(identity), identity] as const
    ))).entries());
    entries.forEach(([resourceKey]) => {
      this.writeGenerations.set(resourceKey, this.getGeneration(resourceKey) + 1);
    });
    return this.enqueueMutation(async () => {
      await this.persistence.deleteMany(entries.map(([resourceKey]) => resourceKey));
      entries.forEach(([resourceKey, identity]) => {
        const usage = this.accountUsage.get(identity.accountScope);
        const estimatedBytes = usage?.entries.get(resourceKey) ?? 0;
        usage?.entries.delete(resourceKey);
        if (usage) usage.totalBytes = Math.max(0, usage.totalBytes - estimatedBytes);
      });
    });
  }

  getWriteGeneration(identity: ViewerResourceKey): number | null {
    if (!isDraftCapableIdentity(identity)) return null;
    return this.getGeneration(serializeViewerResourceKey(identity));
  }

  writeDraft(
    key: ViewerDraftKey,
    content: string,
    options: { writeGeneration?: number | null } = {},
  ): Promise<ViewerDraftRecord> {
    if (!isViewerDraftKey(key) || !isDraftCapableIdentity(key)) {
      return Promise.reject(new ViewerDraftStoreError(
        'invalid-draft-key',
        'Viewer draft key is invalid',
      ));
    }
    const estimatedBytes = estimateDraftBytes(content);
    if (estimatedBytes > this.maxDraftBytes) {
      return Promise.reject(new ViewerDraftStoreError(
        'draft-too-large',
        'Viewer draft exceeds the per-draft size limit',
      ));
    }
    return this.enqueueMutation(async () => {
      const resourceKey = serializeViewerResourceKey(key);
      if (
        options.writeGeneration != null
        && options.writeGeneration !== this.getGeneration(resourceKey)
      ) {
        throw new ViewerDraftStoreError(
          'draft-invalidated',
          'Viewer draft writer belongs to an invalidated resource generation',
        );
      }
      const usage = await this.ensureAccountUsage(key.accountScope);
      const previousBytes = usage.entries.get(resourceKey) ?? 0;
      const nextTotalBytes = usage.totalBytes - previousBytes + estimatedBytes;
      if (nextTotalBytes > this.accountMaxBytes) {
        throw new ViewerDraftStoreError(
          'account-quota-exceeded',
          'Viewer drafts exceed the account size limit',
        );
      }
      const savedAt = this.now();
      const record: ViewerDraftPersistenceRecord = {
        schemaVersion: DRAFT_SCHEMA_VERSION,
        key: { ...key },
        savedAt,
        expiresAt: savedAt + this.retentionMs,
        estimatedBytes,
        content,
        resourceKey,
        accountScope: key.accountScope,
      };
      try {
        await this.persistence.put(record);
      } catch (error) {
        throw new ViewerDraftStoreError(
          'storage-unavailable',
          'Unable to persist the viewer draft',
          { cause: error },
        );
      }
      usage.entries.set(resourceKey, estimatedBytes);
      usage.totalBytes = nextTotalBytes;
      return {
        schemaVersion: record.schemaVersion,
        key: { ...record.key },
        savedAt: record.savedAt,
        expiresAt: record.expiresAt,
        estimatedBytes: record.estimatedBytes,
        content: record.content,
      };
    });
  }

  private async ensureAccountUsage(accountScope: string): Promise<AccountUsage> {
    const existing = this.accountUsage.get(accountScope);
    if (existing) return existing;
    const entries = new Map<string, number>();
    let totalBytes = 0;
    const now = this.now();
    const rawRecords = await this.persistence.getAllByAccount(accountScope);
    for (const rawRecord of rawRecords) {
      const candidate = rawRecord as Partial<ViewerDraftPersistenceRecord> | null;
      const resourceKey = typeof candidate?.resourceKey === 'string'
        ? candidate.resourceKey
        : null;
      const record = parsePersistedRecord(rawRecord);
      if (!record || record.expiresAt <= now || record.estimatedBytes > this.maxDraftBytes) {
        if (resourceKey) await this.persistence.delete(resourceKey);
        continue;
      }
      entries.set(record.resourceKey, record.estimatedBytes);
      totalBytes += record.estimatedBytes;
    }
    const usage = { entries, totalBytes };
    this.accountUsage.set(accountScope, usage);
    return usage;
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(mutation, mutation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private getGeneration(resourceKey: string): number {
    return this.writeGenerations.get(resourceKey) ?? 0;
  }
}

export const viewerDraftStore = new ViewerDraftStore();

import { describe, expect, it } from 'vitest';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import { createViewerResourceKey } from './viewer-session-identity';
import {
  ViewerSessionColdStore,
  ViewerSessionColdStoreError,
  type ViewerSessionColdPersistence,
  type ViewerSessionColdPersistenceRecord,
} from './viewer-session-cold-store';
import type { ViewerSessionSnapshot } from './viewer-session.types';

class MemoryColdPersistence implements ViewerSessionColdPersistence {
  readonly records = new Map<string, ViewerSessionColdPersistenceRecord>();

  async deleteMany(resourceKeys: string[]) {
    resourceKeys.forEach(resourceKey => this.records.delete(resourceKey));
  }

  async get(resourceKey: string) {
    return this.records.get(resourceKey);
  }

  async getAllByAccount(accountScope: string) {
    return Array.from(this.records.values()).filter(record => record.accountScope === accountScope);
  }

  async getAllByLibrary(accountScope: string, libraryId: number) {
    return Array.from(this.records.values()).filter(record => (
      record.accountScope === accountScope && record.libraryId === libraryId
    ));
  }

  async put(record: ViewerSessionColdPersistenceRecord, evictedResourceKeys: string[]) {
    evictedResourceKeys.forEach(resourceKey => this.records.delete(resourceKey));
    this.records.set(record.resourceKey, structuredClone(record));
  }
}

class FailingColdPersistence extends MemoryColdPersistence {
  override async get(resourceKey: string): Promise<never> {
    void resourceKey;
    throw new Error('database unavailable');
  }
}

function identity(options: {
  accountScope?: string;
  libraryId?: number;
  nodeId?: number;
  viewerKind?: FileViewerFileType;
} = {}) {
  return createViewerResourceKey({
    accountScope: options.accountScope ?? 'user:1',
    libraryId: options.libraryId ?? 3,
    nodeId: options.nodeId ?? 8,
    viewerKind: options.viewerKind ?? 'pdf',
  })!;
}

function snapshot(options: {
  accountScope?: string;
  contentRevision?: string | null;
  libraryId?: number;
  nodeId?: number;
  savedAt?: number;
  schemaVersion?: number;
  viewerKind?: FileViewerFileType;
} = {}): ViewerSessionSnapshot<{ page: number }> {
  return {
    identity: identity(options),
    contentRevision: options.contentRevision ?? 'v1',
    savedAt: options.savedAt ?? 1_000,
    schemaVersion: options.schemaVersion ?? 1,
    payload: { page: options.nodeId ?? 8 },
  };
}

describe('ViewerSessionColdStore', () => {
  it('stores detached device snapshots and restores matching versions', async () => {
    const persistence = new MemoryColdPersistence();
    const store = new ViewerSessionColdStore({ persistence, now: () => 1_000 });
    const input = snapshot();

    const written = await store.writeSnapshot(input);
    input.payload.page = 99;
    written.payload.page = 88;

    expect((await store.readSnapshot<{ page: number }>(input.identity, {
      schemaVersion: 1,
      contentRevision: 'v1',
    }))?.payload.page).toBe(8);
  });

  it('rejects viewer policies that do not allow device persistence', async () => {
    const store = new ViewerSessionColdStore({ persistence: new MemoryColdPersistence() });

    await expect(store.writeSnapshot(snapshot({ viewerKind: 'image' })))
      .rejects.toMatchObject({ code: 'invalid-snapshot' } satisfies Partial<ViewerSessionColdStoreError>);
    expect(await store.readSnapshot(identity({ viewerKind: 'image' }))).toBeNull();
  });

  it('deletes expired, schema-mismatched and revision-mismatched records', async () => {
    let now = 1_000;
    const persistence = new MemoryColdPersistence();
    const store = new ViewerSessionColdStore({ persistence, now: () => now, retentionMs: 100 });
    const first = snapshot({ nodeId: 8 });
    const second = snapshot({ nodeId: 9 });
    const third = snapshot({ nodeId: 10 });
    await store.writeSnapshot(first);
    await store.writeSnapshot(second);
    await store.writeSnapshot(third);

    expect(await store.readSnapshot(first.identity, { schemaVersion: 2 })).toBeNull();
    expect(await store.readSnapshot(second.identity, { contentRevision: 'v2' })).toBeNull();
    now = 1_101;
    expect(await store.readSnapshot(third.identity)).toBeNull();
    expect(persistence.records.size).toBe(0);
  });

  it('removes malformed persisted records instead of exposing payloads', async () => {
    const persistence = new MemoryColdPersistence();
    const store = new ViewerSessionColdStore({ persistence, now: () => 1_000 });
    const input = snapshot();
    await store.writeSnapshot(input);
    const [resourceKey, record] = Array.from(persistence.records.entries())[0];
    persistence.records.set(resourceKey, { ...record, accountScope: 'user:2' });

    expect(await store.readSnapshot(input.identity)).toBeNull();
    expect(persistence.records.size).toBe(0);
  });

  it('evicts the oldest account entry atomically when the byte budget is exceeded', async () => {
    let now = 1_000;
    const persistence = new MemoryColdPersistence();
    const store = new ViewerSessionColdStore({
      persistence,
      now: () => now,
      accountMaxBytes: 750,
      maxEntryBytes: 750,
    });
    const oldest = snapshot({ nodeId: 8, savedAt: 1_000 });
    const newest = snapshot({ nodeId: 9, savedAt: 2_000 });
    await store.writeSnapshot(oldest);
    now = 2_000;
    await store.writeSnapshot(newest);

    expect(await store.readSnapshot(oldest.identity)).toBeNull();
    expect((await store.readSnapshot<{ page: number }>(newest.identity))?.payload.page).toBe(9);
    expect(persistence.records.size).toBe(1);
  });

  it('isolates library cleanup by account and library', async () => {
    const persistence = new MemoryColdPersistence();
    const store = new ViewerSessionColdStore({ persistence, now: () => 1_000 });
    const target = snapshot({ accountScope: 'user:1', libraryId: 3, nodeId: 8 });
    const otherLibrary = snapshot({ accountScope: 'user:1', libraryId: 4, nodeId: 9 });
    const otherAccount = snapshot({ accountScope: 'user:2', libraryId: 3, nodeId: 10 });
    await store.writeSnapshot(target);
    await store.writeSnapshot(otherLibrary);
    await store.writeSnapshot(otherAccount);

    await store.deleteLibrary('user:1', 3);

    expect(await store.readSnapshot(target.identity)).toBeNull();
    expect(await store.readSnapshot(otherLibrary.identity)).not.toBeNull();
    expect(await store.readSnapshot(otherAccount.identity)).not.toBeNull();
  });

  it('normalizes persistence failures without exposing database-specific errors', async () => {
    const store = new ViewerSessionColdStore({ persistence: new FailingColdPersistence() });

    await expect(store.readSnapshot(identity()))
      .rejects.toMatchObject({ code: 'storage-unavailable' } satisfies Partial<ViewerSessionColdStoreError>);
  });
});

import { describe, expect, it } from 'vitest';
import { createViewerDraftKey, createViewerResourceKey } from './viewer-session-identity';
import {
  ViewerDraftStore,
  ViewerDraftStoreError,
  type ViewerDraftPersistence,
  type ViewerDraftPersistenceRecord,
} from './viewer-draft-store';

class MemoryDraftPersistence implements ViewerDraftPersistence {
  readonly records = new Map<string, ViewerDraftPersistenceRecord>();

  async delete(resourceKey: string) {
    this.records.delete(resourceKey);
  }

  async deleteMany(resourceKeys: string[]) {
    resourceKeys.forEach((resourceKey) => this.records.delete(resourceKey));
  }

  async get(resourceKey: string) {
    return this.records.get(resourceKey);
  }

  async getAllByAccount(accountScope: string) {
    return Array.from(this.records.values()).filter(
      (record) => record.accountScope === accountScope,
    );
  }

  async put(record: ViewerDraftPersistenceRecord) {
    this.records.set(record.resourceKey, structuredClone(record));
  }
}

function createIdentity(accountScope = 'user:1', nodeId = 8) {
  return createViewerResourceKey({
    accountScope,
    libraryId: 3,
    nodeId,
    viewerKind: 'text',
  })!;
}

describe('ViewerDraftStore', () => {
  it('replaces the previous revision while preserving its conflict baseline', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({ persistence, now: () => 1_000 });
    const identity = createIdentity();

    await store.writeDraft(createViewerDraftKey(identity, 'sha256:old')!, 'first');
    await store.writeDraft(createViewerDraftKey(identity, 'sha256:new')!, 'second');

    expect(persistence.records.size).toBe(1);
    expect(await store.readLatest(identity)).toMatchObject({
      key: { contentRevision: 'sha256:new' },
      content: 'second',
    });
  });

  it('isolates drafts by account and resource identity', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({ persistence, now: () => 1_000 });
    const firstIdentity = createIdentity('user:1');
    const secondIdentity = createIdentity('user:2');

    await store.writeDraft(createViewerDraftKey(firstIdentity, 'sha256:a')!, 'account one');
    await store.writeDraft(createViewerDraftKey(secondIdentity, 'sha256:b')!, 'account two');

    expect((await store.readLatest(firstIdentity))?.content).toBe('account one');
    expect((await store.readLatest(secondIdentity))?.content).toBe('account two');

    await store.deleteDrafts([firstIdentity, secondIdentity]);
    expect(await store.readLatest(firstIdentity)).toBeNull();
    expect(await store.readLatest(secondIdentity)).toBeNull();
  });

  it('expires stale drafts and removes them from persistence', async () => {
    let now = 1_000;
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({
      persistence,
      now: () => now,
      retentionMs: 100,
    });
    const identity = createIdentity();

    await store.writeDraft(createViewerDraftKey(identity, 'sha256:a')!, 'draft');
    now = 1_101;

    expect(await store.readLatest(identity)).toBeNull();
    expect(persistence.records.size).toBe(0);
  });

  it('enforces per-draft and account capacity limits without deleting safe drafts', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({
      persistence,
      now: () => 1_000,
      maxDraftBytes: 520,
      accountMaxBytes: 1_026,
    });
    const firstIdentity = createIdentity('user:1', 8);
    const secondIdentity = createIdentity('user:1', 9);

    await store.writeDraft(createViewerDraftKey(firstIdentity, 'sha256:a')!, 'a');
    await expect(store.writeDraft(
      createViewerDraftKey(secondIdentity, 'sha256:b')!,
      '123456789',
    )).rejects.toMatchObject({ code: 'draft-too-large' } satisfies Partial<ViewerDraftStoreError>);
    await expect(store.writeDraft(
      createViewerDraftKey(secondIdentity, 'sha256:b')!,
      'bb',
    )).rejects.toMatchObject({ code: 'account-quota-exceeded' } satisfies Partial<ViewerDraftStoreError>);

    expect((await store.readLatest(firstIdentity))?.content).toBe('a');
    expect(await store.readLatest(secondIdentity)).toBeNull();
  });

  it('rejects non-draft viewer identities at the storage boundary', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({ persistence });
    const pdfIdentity = createViewerResourceKey({
      accountScope: 'user:1',
      libraryId: 3,
      nodeId: 8,
      viewerKind: 'pdf',
    })!;
    const invalidKey = createViewerDraftKey(pdfIdentity, 'sha256:a')!;

    await expect(store.writeDraft(invalidKey, 'draft'))
      .rejects.toMatchObject({ code: 'invalid-draft-key' } satisfies Partial<ViewerDraftStoreError>);
    expect(await store.readLatest(pdfIdentity)).toBeNull();
  });

  it('removes malformed persisted identities instead of exposing their content', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({ persistence, now: () => 1_000 });
    const identity = createIdentity();
    const resourceKey = '["user:1",3,"node:8","text"]';
    persistence.records.set(resourceKey, {
      schemaVersion: 1,
      key: { ...identity, accountScope: 'user:01', contentRevision: 'sha256:a' },
      savedAt: 900,
      expiresAt: 2_000,
      estimatedBytes: 520,
      content: 'private draft',
      resourceKey,
      accountScope: 'user:1',
    });

    expect(await store.readLatest(identity)).toBeNull();
    expect(persistence.records.size).toBe(0);
  });

  it('rejects delayed writes from a resource generation discarded by node deletion', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new ViewerDraftStore({ persistence, now: () => 1_000 });
    const identity = createIdentity();
    const oldGeneration = store.getWriteGeneration(identity);
    const draftKey = createViewerDraftKey(identity, 'sha256:a')!;

    await store.writeDraft(draftKey, 'before delete', { writeGeneration: oldGeneration });
    await store.discardDrafts([identity]);
    await expect(store.writeDraft(
      draftKey,
      'delayed cleanup',
      { writeGeneration: oldGeneration },
    )).rejects.toMatchObject({ code: 'draft-invalidated' } satisfies Partial<ViewerDraftStoreError>);
    expect(await store.readLatest(identity)).toBeNull();

    const restoredGeneration = store.getWriteGeneration(identity);
    await store.writeDraft(draftKey, 'after restore', {
      writeGeneration: restoredGeneration,
    });
    expect((await store.readLatest(identity))?.content).toBe('after restore');
  });
});

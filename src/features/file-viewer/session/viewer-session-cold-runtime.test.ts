import { describe, expect, it } from 'vitest';
import { createViewerLiveInstanceKey, createViewerResourceKey } from './viewer-session-identity';
import { ViewerSessionColdRuntime } from './viewer-session-cold-runtime';
import { ViewerSessionRegistry } from './viewer-session-registry';
import type { ViewerResourceKey, ViewerSessionSnapshot } from './viewer-session.types';

class MemoryColdStore {
  readonly deletedLibraries: Array<[string, number]> = [];
  readonly deletedResources: ViewerResourceKey[][] = [];
  readonly writes: ViewerSessionSnapshot[] = [];

  async deleteLibrary(accountScope: string, libraryId: number) {
    this.deletedLibraries.push([accountScope, libraryId]);
  }

  async deleteResources(identities: ViewerResourceKey[]) {
    this.deletedResources.push(identities);
  }

  async writeSnapshot<TPayload>(snapshot: ViewerSessionSnapshot<TPayload>) {
    this.writes.push(structuredClone(snapshot));
    return structuredClone(snapshot);
  }
}

function resource(nodeId = 8, viewerKind: 'pdf' | 'image' = 'pdf') {
  return createViewerResourceKey({
    accountScope: 'user:1',
    libraryId: 3,
    nodeId,
    viewerKind,
  })!;
}

describe('ViewerSessionColdRuntime', () => {
  it('coalesces captured snapshots and persists only the latest device-capable value', async () => {
    const registry = new ViewerSessionRegistry({ now: () => 1_000 });
    const store = new MemoryColdStore();
    const runtime = new ViewerSessionColdRuntime(registry, store, { writeDebounceMs: 60_000 });
    const identity = resource();
    let page = 1;
    const liveKey = createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime:test',
      libraryId: 3,
      tabId: 'node:8',
      mountGeneration: 0,
    })!;
    runtime.start();
    registry.registerLiveInstance({
      key: liveKey,
      identity,
      schemaVersion: 1,
      contentRevision: null,
      adapter: {
        capture: () => ({ page }),
        restore: () => undefined,
        suspend: () => undefined,
        resume: () => undefined,
        estimateSnapshotBytes: () => 64,
        getPinReasons: () => [],
      },
    });

    registry.captureLiveInstance(liveKey);
    page = 2;
    registry.captureLiveInstance(liveKey);
    await runtime.flushAll();

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].payload).toEqual({ page: 2 });
    runtime.dispose();
  });

  it('does not persist viewer kinds whose policy disables device Cold', async () => {
    const registry = new ViewerSessionRegistry();
    const store = new MemoryColdStore();
    const runtime = new ViewerSessionColdRuntime(registry, store, { writeDebounceMs: 60_000 });
    runtime.scheduleSnapshot({
      identity: resource(8, 'image'),
      schemaVersion: 1,
      contentRevision: null,
      savedAt: 1_000,
      payload: { scale: 2 },
    });

    await runtime.flushAll();

    expect(store.writes).toHaveLength(0);
  });

  it('cancels pending writes before precise library deletion', async () => {
    const registry = new ViewerSessionRegistry();
    const store = new MemoryColdStore();
    const runtime = new ViewerSessionColdRuntime(registry, store, { writeDebounceMs: 60_000 });
    runtime.scheduleSnapshot({
      identity: resource(),
      schemaVersion: 1,
      contentRevision: null,
      savedAt: 1_000,
      payload: { page: 8 },
    });

    await runtime.deleteLibrary('user:1', 3);
    await runtime.flushAll();

    expect(store.writes).toHaveLength(0);
    expect(store.deletedLibraries).toEqual([['user:1', 3]]);
  });

  it('limits resource deletion to device-capable viewer policies', async () => {
    const registry = new ViewerSessionRegistry();
    const store = new MemoryColdStore();
    const runtime = new ViewerSessionColdRuntime(registry, store);

    await runtime.deleteResources([resource(8, 'pdf'), resource(8, 'image')]);

    expect(store.deletedResources).toHaveLength(1);
    expect(store.deletedResources[0]).toEqual([
      expect.objectContaining({ viewerKind: 'pdf' }),
    ]);
  });
});

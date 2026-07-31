import { describe, expect, it, vi } from 'vitest';
import {
  createViewerLiveInstanceKey,
  createViewerResourceKey,
} from './viewer-session-identity';
import { ViewerSessionRegistry } from './viewer-session-registry';
import type {
  ViewerLiveRegistration,
  ViewerResourceKey,
  ViewerSessionAdapter,
} from './viewer-session.types';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

function resource(options: {
  accountScope?: string;
  libraryId?: number;
  nodeId: number;
  viewerKind?: FileViewerFileType;
}): ViewerResourceKey {
  return createViewerResourceKey({
    accountScope: options.accountScope ?? 'user:1',
    libraryId: options.libraryId ?? 1,
    nodeId: options.nodeId,
    viewerKind: options.viewerKind ?? 'pdf',
  })!;
}

function snapshot(identity: ViewerResourceKey, page: number, contentRevision: string | null = 'v1') {
  return {
    schemaVersion: 1,
    identity,
    contentRevision,
    savedAt: 100,
    payload: { page },
  };
}

function liveRegistration(options: {
  generation: number;
  identity: ViewerResourceKey;
  payload: { page: number };
  suspend?: ReturnType<typeof vi.fn>;
  tabId?: string;
}): ViewerLiveRegistration<{ page: number }> {
  const suspend = options.suspend ?? vi.fn();
  const adapter: ViewerSessionAdapter<{ page: number }> = {
    capture: () => options.payload,
    restore: vi.fn(),
    suspend,
    resume: vi.fn(),
    estimateCost: () => 256,
    getPinReasons: () => [],
  };
  return {
    key: createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime-1',
      libraryId: options.identity.libraryId,
      tabId: options.tabId ?? 'node:active',
      mountGeneration: options.generation,
    })!,
    identity: options.identity,
    schemaVersion: 1,
    contentRevision: 'v1',
    adapter,
  };
}

describe('ViewerSessionRegistry warm snapshots', () => {
  it('stores detached snapshots and returns detached reads', () => {
    const registry = new ViewerSessionRegistry();
    const identity = resource({ nodeId: 1 });
    const input = snapshot(identity, 3);

    registry.writeSnapshot(input);
    input.payload.page = 90;
    const firstRead = registry.readSnapshot<{ page: number }>(identity);
    expect(firstRead?.payload.page).toBe(3);

    firstRead!.payload.page = 50;
    expect(registry.readSnapshot<{ page: number }>(identity)?.payload.page).toBe(3);
  });

  it('uses reads to update LRU order', () => {
    const registry = new ViewerSessionRegistry({ maxEntries: 2 });
    const first = resource({ nodeId: 1 });
    const second = resource({ nodeId: 2 });
    const third = resource({ nodeId: 3 });

    registry.writeSnapshot(snapshot(first, 1));
    registry.writeSnapshot(snapshot(second, 2));
    expect(registry.readSnapshot(first)?.payload).toEqual({ page: 1 });
    registry.writeSnapshot(snapshot(third, 3));

    expect(registry.readSnapshot(second)).toBeNull();
    expect(registry.readSnapshot(first)).not.toBeNull();
    expect(registry.readSnapshot(third)).not.toBeNull();
  });

  it('enforces byte budgets independently from entry count', () => {
    const registry = new ViewerSessionRegistry({
      maxEntries: 10,
      maxEstimatedBytes: 600,
    });
    const first = resource({ nodeId: 1 });
    const second = resource({ nodeId: 2 });

    registry.writeSnapshot(snapshot(first, 1), { estimatedBytes: 400 });
    registry.writeSnapshot(snapshot(second, 2), { estimatedBytes: 400 });

    expect(registry.getState()).toMatchObject({ snapshotCount: 1, estimatedBytes: 400 });
    expect(registry.readSnapshot(first)).toBeNull();
    expect(registry.readSnapshot(second)).not.toBeNull();
  });

  it('invalidates incompatible schema and content revisions', () => {
    const registry = new ViewerSessionRegistry();
    const identity = resource({ nodeId: 1 });
    const events: string[] = [];
    registry.subscribe((event) => events.push(`${event.type}:${event.reason || ''}`));

    registry.writeSnapshot(snapshot(identity, 1));
    expect(registry.readSnapshot(identity, { schemaVersion: 2 })).toBeNull();
    expect(registry.readSnapshot(identity, { schemaVersion: 1 })).toBeNull();

    registry.writeSnapshot(snapshot(identity, 2, 'v2'));
    expect(registry.readSnapshot(identity, { contentRevision: 'v3' })).toBeNull();
    expect(events).toContain('restore-skipped:schema-version-mismatch');
    expect(events).toContain('restore-skipped:content-revision-mismatch');
  });

  it('rejects payloads that are not plain JSON data', () => {
    const registry = new ViewerSessionRegistry();
    const identity = resource({ nodeId: 1 });

    expect(() => registry.writeSnapshot({
      ...snapshot(identity, 1),
      payload: { createdAt: new Date() },
    })).toThrow(/non-plain object/);
  });

  it('never exposes snapshot payloads through diagnostics', () => {
    const registry = new ViewerSessionRegistry();
    const identity = resource({ nodeId: 1 });
    const events: unknown[] = [];
    registry.subscribe((event) => events.push(event));

    registry.writeSnapshot({
      ...snapshot(identity, 1),
      payload: { privateDraft: 'do-not-log' },
    });

    expect(JSON.stringify(events)).not.toContain('do-not-log');
    expect(events).toHaveLength(1);
  });

  it('isolates library disposal by account and clears the whole session explicitly', () => {
    const registry = new ViewerSessionRegistry();
    const target = resource({ accountScope: 'user:1', libraryId: 1, nodeId: 1 });
    const otherAccount = resource({ accountScope: 'user:2', libraryId: 1, nodeId: 2 });
    const otherLibrary = resource({ accountScope: 'user:1', libraryId: 2, nodeId: 3 });

    registry.writeSnapshot(snapshot(target, 1));
    registry.writeSnapshot(snapshot(otherAccount, 2));
    registry.writeSnapshot(snapshot(otherLibrary, 3));
    registry.disposeLibrary(1, 'user:1');

    expect(registry.readSnapshot(target)).toBeNull();
    expect(registry.readSnapshot(otherAccount)).not.toBeNull();
    expect(registry.readSnapshot(otherLibrary)).not.toBeNull();
    registry.disposeSession();
    expect(registry.getState().snapshotCount).toBe(0);
  });
});

describe('ViewerSessionRegistry live generations', () => {
  it('does not let an old generation cleanup remove the current adapter', () => {
    const registry = new ViewerSessionRegistry();
    const identity = resource({ nodeId: 1 });
    const oldSuspend = vi.fn();
    const newSuspend = vi.fn();
    const unregisterOld = registry.registerLiveInstance(liveRegistration({
      generation: 0,
      identity,
      payload: { page: 1 },
      suspend: oldSuspend,
    }));
    const unregisterNew = registry.registerLiveInstance(liveRegistration({
      generation: 1,
      identity,
      payload: { page: 2 },
      suspend: newSuspend,
    }));

    expect(oldSuspend).toHaveBeenCalledTimes(1);
    unregisterOld();
    expect(registry.getState().liveInstanceCount).toBe(1);
    unregisterNew();
    expect(newSuspend).toHaveBeenCalledTimes(1);
    expect(registry.getState().liveInstanceCount).toBe(0);
  });

  it('captures the old resource before an explicit replace transaction', () => {
    const registry = new ViewerSessionRegistry({ now: () => 500 });
    const previousIdentity = resource({ nodeId: 1, viewerKind: 'video' });
    const nextIdentity = resource({ nodeId: 2, viewerKind: 'video' });
    const previous = liveRegistration({
      generation: 0,
      identity: previousIdentity,
      payload: { page: 12 },
    });
    const next = liveRegistration({
      generation: 1,
      identity: nextIdentity,
      payload: { page: 1 },
    });

    registry.registerLiveInstance(previous);
    const unregisterNext = registry.replaceLiveInstance(previous.key, next);

    expect(registry.readSnapshot<{ page: number }>(previousIdentity)).toMatchObject({
      savedAt: 500,
      payload: { page: 12 },
    });
    expect(registry.readSnapshot(nextIdentity)).toBeNull();
    expect(registry.getState().liveInstanceCount).toBe(1);
    unregisterNext();
  });

  it('keeps the old registration when replacement validation fails', () => {
    const registry = new ViewerSessionRegistry();
    const previousIdentity = resource({ nodeId: 1 });
    const previousSuspend = vi.fn();
    const previous = liveRegistration({
      generation: 0,
      identity: previousIdentity,
      payload: { page: 7 },
      suspend: previousSuspend,
    });
    const invalidNext = liveRegistration({
      generation: 1,
      identity: resource({ libraryId: 2, nodeId: 2 }),
      payload: { page: 1 },
    });
    invalidNext.key = createViewerLiveInstanceKey({
      runtimeSessionId: 'runtime-1',
      libraryId: 1,
      tabId: 'node:active',
      mountGeneration: 1,
    })!;

    registry.registerLiveInstance(previous);
    expect(() => registry.replaceLiveInstance(previous.key, invalidNext))
      .toThrow(/libraryId must match/);
    expect(previousSuspend).not.toHaveBeenCalled();
    expect(registry.getState().liveInstanceCount).toBe(1);
  });

  it('suspends live adapters when the auth session is disposed', () => {
    const registry = new ViewerSessionRegistry();
    const suspend = vi.fn();
    registry.registerLiveInstance(liveRegistration({
      generation: 0,
      identity: resource({ nodeId: 1 }),
      payload: { page: 1 },
      suspend,
    }));

    registry.disposeSession();

    expect(suspend).toHaveBeenCalledTimes(1);
    expect(registry.getState()).toMatchObject({
      liveInstanceCount: 0,
      snapshotCount: 0,
    });
  });

  it('never exposes URL-backed tab ids through live diagnostics', () => {
    const registry = new ViewerSessionRegistry();
    const events: unknown[] = [];
    registry.subscribe((event) => events.push(event));
    const registration = liveRegistration({
      generation: 0,
      identity: resource({ nodeId: 1 }),
      payload: { page: 1 },
      tabId: 'url:https://example.com/file?signature=private',
    });

    const unregister = registry.registerLiveInstance(registration);
    unregister();

    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain('example.com');
    expect(JSON.stringify(events)).not.toContain('private');
  });
});

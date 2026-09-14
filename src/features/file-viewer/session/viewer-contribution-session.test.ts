import { describe, expect, it } from 'vitest';
import { createViewerResourceKey, createViewerDraftKey, serializeViewerResourceKey } from './viewer-session-identity';
import { ViewerSessionRegistry } from './viewer-session-registry';
import { ViewerSessionColdStore, type ViewerSessionColdPersistenceRecord } from './viewer-session-cold-store';
import { ViewerSessionColdRuntime } from './viewer-session-cold-runtime';
import { ViewerSessionRuntime } from './viewer-session-runtime';
import { getViewerSessionPolicy } from './viewer-session-policies';

const identity = (viewerId?: string, nodeId = 900099) => createViewerResourceKey({ accountScope: 'user:900001', libraryId: 900007, nodeId, viewerKind: 'text', viewerId })!;
const snapshot = (viewerId?: string, nodeId = 900099) => ({ schemaVersion: 1, identity: identity(viewerId, nodeId), contentRevision: 'fixture:v1', savedAt: 1000, payload: { position: viewerId ?? 'core' } });
function persistence() {
  const records = new Map<string, ViewerSessionColdPersistenceRecord>();
  return { records, get: async (key: string) => records.get(key),
    getAllByAccount: async (account: string) => [...records.values()].filter(r => r.accountScope === account),
    getAllByLibrary: async (account: string, library: number) => [...records.values()].filter(r => r.accountScope === account && r.libraryId === library),
    deleteMany: async (keys: string[]) => { keys.forEach(key => records.delete(key)); },
    put: async (record: ViewerSessionColdPersistenceRecord, evicted: string[]) => { evicted.forEach(key => records.delete(key)); records.set(record.resourceKey, structuredClone(record)); },
  };
}
describe('viewer restore namespaces', () => {
  it('keeps legacy keys byte-for-byte and separates two viewers of the same type', () => {
    const legacy = '["user:900001",900007,"node:900099","text"]';
    expect(serializeViewerResourceKey(identity())).toBe(legacy);
    expect(serializeViewerResourceKey(identity('omniflow.viewer.text'))).toBe(legacy);
    expect(serializeViewerResourceKey(identity('example.a'))).not.toBe(serializeViewerResourceKey(identity('example.b')));
    expect(createViewerDraftKey(identity('example.a'), 'v1')).toBeNull();
    expect(getViewerSessionPolicy('text', 'example.a').hasDraft).toBe(false);
  });
  it('restores matching Warm/Cold states and invalidates only the mismatched schema', async () => {
    const registry = new ViewerSessionRegistry();
    const store = new ViewerSessionColdStore({ persistence: persistence(), now: () => 2000 });
    for (const id of ['example.a', 'example.b']) { registry.writeSnapshot(snapshot(id)); await store.writeSnapshot(snapshot(id)); }
    expect(registry.readSnapshot(identity('example.a'))?.payload).toEqual({ position: 'example.a' });
    expect((await store.readSnapshot(identity('example.b'), { schemaVersion: 1, contentRevision: 'fixture:v1' }))?.payload).toEqual({ position: 'example.b' });
    expect(await store.readSnapshot(identity('example.a'), { schemaVersion: 2 })).toBeNull();
    expect(await store.readSnapshot(identity('example.b'), { schemaVersion: 1 })).not.toBeNull();
  });
  it('deletes on-disk missing-viewer states as well as live-known namespaces by node', async () => {
    const data = persistence(); const registry = new ViewerSessionRegistry();
    const store = new ViewerSessionColdStore({ persistence: data, now: () => 2000 });
    const cold = new ViewerSessionColdRuntime(registry, store);
    const runtime = new ViewerSessionRuntime(registry, cold);
    for (const id of ['example.a', 'missing.viewer']) await store.writeSnapshot(snapshot(id));
    await store.writeSnapshot(snapshot('example.a', 900100));
    registry.writeSnapshot(snapshot('example.a'));
    await runtime.disposeNodeResources('user:900001', 900007, [900099]);
    expect(registry.getState().snapshotCount).toBe(0);
    expect(await store.readSnapshot(identity('missing.viewer'))).toBeNull();
    expect(await store.readSnapshot(identity('example.a', 900100))).not.toBeNull();
  });
});

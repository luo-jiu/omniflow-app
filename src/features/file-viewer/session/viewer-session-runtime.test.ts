import { describe, expect, it } from 'vitest';
import { createViewerResourceKey } from './viewer-session-identity';
import { ViewerSessionRegistry } from './viewer-session-registry';
import { ViewerSessionRuntime } from './viewer-session-runtime';

function createIdentity(libraryId = 1) {
  return createViewerResourceKey({
    accountScope: 'user:1',
    libraryId,
    nodeId: 8,
    viewerKind: 'pdf',
  })!;
}

describe('ViewerSessionRuntime', () => {
  it('allocates a new mount generation for each live slot registration', () => {
    const runtime = new ViewerSessionRuntime(new ViewerSessionRegistry());
    runtime.start();

    const first = runtime.createLiveInstanceKey({ libraryId: 1, tabId: 'node:8' });
    const second = runtime.createLiveInstanceKey({ libraryId: 1, tabId: 'node:8' });

    expect(first?.mountGeneration).toBe(0);
    expect(second?.mountGeneration).toBe(1);
  });

  it('invalidates warm snapshots when the runtime reload generation changes', () => {
    const registry = new ViewerSessionRegistry();
    const runtime = new ViewerSessionRuntime(registry);
    const identity = createIdentity();
    runtime.start();
    runtime.prepareResource(identity, 0);
    registry.writeSnapshot({
      schemaVersion: 1,
      identity,
      contentRevision: null,
      savedAt: 100,
      payload: { page: 5 },
    });

    runtime.prepareResource(identity, 0);
    expect(registry.readSnapshot(identity)).not.toBeNull();
    runtime.prepareResource(identity, 1);
    expect(registry.readSnapshot(identity)).toBeNull();
  });

  it('does not reuse mount generations after a library is disposed', () => {
    const runtime = new ViewerSessionRuntime(new ViewerSessionRegistry());
    runtime.start();
    expect(runtime.createLiveInstanceKey({ libraryId: 1, tabId: 'node:8' })?.mountGeneration)
      .toBe(0);
    expect(runtime.createLiveInstanceKey({ libraryId: 1, tabId: 'node:8' })?.mountGeneration)
      .toBe(1);

    runtime.disposeLibrary(1);

    expect(runtime.createLiveInstanceKey({ libraryId: 1, tabId: 'node:8' })?.mountGeneration)
      .toBe(2);
  });

  it('clears every viewer-kind snapshot for deleted nodes and delegates Cold cleanup', async () => {
    const registry = new ViewerSessionRegistry();
    const deletedColdIdentities: unknown[][] = [];
    const runtime = new ViewerSessionRuntime(registry, {
      deleteResources: async identities => {
        deletedColdIdentities.push(identities);
      },
    });
    const pdfIdentity = createIdentity();
    const imageIdentity = createViewerResourceKey({
      accountScope: 'user:1',
      libraryId: 1,
      nodeId: 8,
      viewerKind: 'image',
    })!;
    [pdfIdentity, imageIdentity].forEach((identity) => registry.writeSnapshot({
      schemaVersion: 1,
      identity,
      contentRevision: null,
      savedAt: 100,
      payload: {},
    }));

    await runtime.disposeNodeResources('user:1', 1, [8]);

    expect(registry.readSnapshot(pdfIdentity)).toBeNull();
    expect(registry.readSnapshot(imageIdentity)).toBeNull();
    expect(deletedColdIdentities).toHaveLength(1);
    expect(deletedColdIdentities[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceIdentity: 'node:8', viewerKind: 'pdf' }),
    ]));
    expect(deletedColdIdentities[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceIdentity: 'node:8', viewerKind: 'image' }),
    ]));
  });
});

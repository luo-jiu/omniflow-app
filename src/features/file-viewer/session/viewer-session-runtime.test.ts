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
});

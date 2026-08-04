import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewerResourceKey } from './viewer-session-identity';
import { viewerSessionRegistry, viewerSessionRuntime } from './viewer-session-runtime';
import { disposeViewerSessionOnClose } from './viewer-session-close';

const accountScope = 'user:987654321';

function writeSnapshot(viewerKind: 'image' | 'pdf', nodeId: number) {
  const identity = createViewerResourceKey({
    accountScope,
    libraryId: 7,
    nodeId,
    viewerKind,
  })!;
  viewerSessionRegistry.writeSnapshot({
    contentRevision: null,
    identity,
    payload: { position: 12 },
    savedAt: Date.now(),
    schemaVersion: 1,
  });
  return identity;
}

describe('disposeViewerSessionOnClose', () => {
  beforeEach(() => viewerSessionRuntime.start());
  afterEach(() => viewerSessionRuntime.dispose());

  it('discards snapshots only for viewers whose close policy is discard', () => {
    const imageIdentity = writeSnapshot('image', 11);
    const pdfIdentity = writeSnapshot('pdf', 12);

    disposeViewerSessionOnClose({
      accountScope,
      libraryId: 7,
      nodeId: 11,
      viewerKind: 'image',
    });
    disposeViewerSessionOnClose({
      accountScope,
      libraryId: 7,
      nodeId: 12,
      viewerKind: 'pdf',
    });

    expect(viewerSessionRegistry.readSnapshot(imageIdentity)).toBeNull();
    expect(viewerSessionRegistry.readSnapshot(pdfIdentity)).not.toBeNull();
  });

  it('ignores incomplete resource identities', () => {
    const identity = writeSnapshot('image', 13);
    disposeViewerSessionOnClose({
      accountScope: null,
      libraryId: 7,
      nodeId: 13,
      viewerKind: 'image',
    });
    expect(viewerSessionRegistry.readSnapshot(identity)).not.toBeNull();
  });
});

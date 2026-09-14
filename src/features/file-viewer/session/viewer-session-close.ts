import type { FileViewerFileType } from '@/shared/file-viewer-types';
import { createViewerResourceKey } from './viewer-session-identity';
import { getViewerSessionPolicy } from './viewer-session-policies';
import { viewerSessionRuntime } from './viewer-session-runtime';

interface DisposeViewerSessionOnCloseOptions {
  accountScope: string | null;
  libraryId: number | null;
  nodeId: number | null;
  viewerKind: FileViewerFileType | null;
  viewerId?: string;
}

export function disposeViewerSessionOnClose(options: DisposeViewerSessionOnCloseOptions) {
  const { accountScope, libraryId, nodeId, viewerKind, viewerId } = options;
  if (!viewerKind || !accountScope || libraryId == null) return;
  if (getViewerSessionPolicy(viewerKind, viewerId).closeBehavior !== 'discard') return;

  const identity = createViewerResourceKey({
    accountScope,
    libraryId,
    nodeId,
    viewerKind,
    viewerId,
  });
  if (identity) viewerSessionRuntime.disposeResource(identity);
}

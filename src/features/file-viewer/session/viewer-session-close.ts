import type { FileViewerFileType } from '@/shared/file-viewer-types';
import { createViewerResourceKey } from './viewer-session-identity';
import { viewerSessionPolicies } from './viewer-session-policies';
import { viewerSessionRuntime } from './viewer-session-runtime';

interface DisposeViewerSessionOnCloseOptions {
  accountScope: string | null;
  libraryId: number | null;
  nodeId: number | null;
  viewerKind: FileViewerFileType | null;
}

export function disposeViewerSessionOnClose(options: DisposeViewerSessionOnCloseOptions) {
  const { accountScope, libraryId, nodeId, viewerKind } = options;
  if (!viewerKind || !accountScope || libraryId == null) return;
  if (viewerSessionPolicies[viewerKind].closeBehavior !== 'discard') return;

  const identity = createViewerResourceKey({
    accountScope,
    libraryId,
    nodeId,
    viewerKind,
  });
  if (identity) viewerSessionRuntime.disposeResource(identity);
}

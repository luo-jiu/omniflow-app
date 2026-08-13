import type {
  FileViewerReturnTarget,
  FileViewerTab,
} from './file-viewer.context';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

const MAX_RETURN_TARGET_DEPTH = 32;

function normalizeReturnNodeId(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const nodeId = Number(value);
  return Number.isFinite(nodeId) ? nodeId : null;
}

export interface BuildFileViewerReturnTargetOptions {
  fileUrl: string;
  fileName?: string | null;
  fileType: FileViewerFileType;
  nodeId?: number | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
}

export function normalizeFileViewerReturnTarget(
  target: FileViewerReturnTarget | null | undefined,
  depth = 0,
): FileViewerReturnTarget | null {
  if (!target || depth >= MAX_RETURN_TARGET_DEPTH) return null;
  const fileUrl = String(target.fileUrl || '').trim();
  if (!fileUrl || !target.fileType) return null;
  return {
    fileUrl,
    fileName: target.fileName ?? null,
    fileType: target.fileType,
    nodeId: normalizeReturnNodeId(target.nodeId),
    tabTypeLabel: target.tabTypeLabel ?? null,
    returnTarget: normalizeFileViewerReturnTarget(target.returnTarget, depth + 1),
  };
}

export function buildFileViewerReturnTarget(
  options: BuildFileViewerReturnTargetOptions,
): FileViewerReturnTarget | null {
  const fileUrl = String(options.fileUrl || '').trim();
  if (!fileUrl) return null;
  return normalizeFileViewerReturnTarget({
    fileUrl,
    fileName: options.fileName ?? null,
    fileType: options.fileType,
    nodeId: normalizeReturnNodeId(options.nodeId),
    tabTypeLabel: options.tabTypeLabel ?? null,
    returnTarget: options.returnTarget ?? null,
  });
}

export function resolveFileViewerReturnOptions(
  target: FileViewerReturnTarget,
  tabs: FileViewerTab[],
): {
  tabTypeLabel: string | null;
  returnTarget: FileViewerReturnTarget | null;
} {
  const targetTab = tabs.find(tab => (
    target.nodeId !== null && target.nodeId !== undefined
      ? tab.nodeId === target.nodeId
      : tab.fileUrl === target.fileUrl
  ));
  return {
    tabTypeLabel: target.tabTypeLabel ?? null,
    returnTarget: target.returnTarget ?? targetTab?.returnTarget ?? null,
  };
}

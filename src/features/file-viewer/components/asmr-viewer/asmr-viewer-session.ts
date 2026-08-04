export const ASMR_VIEWER_SESSION_SCHEMA_VERSION = 1;
export const ASMR_VIEWER_SESSION_ESTIMATED_BYTES = 512;

const MAX_PATH_DEPTH = 128;
const MAX_SCROLL_TOP = 100_000_000;

export interface AsmrNodeItem {
  id: number;
  name: string;
  type: 'dir' | 'file' | string | number;
  ext?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface AsmrPathItem {
  id: number;
  name: string;
}

export interface AsmrViewMetaPayload {
  sn?: string;
  tag?: string;
  tagIds?: number[];
  coverNodeId?: number;
  [key: string]: unknown;
}

export interface AsmrViewerSessionSnapshot {
  currentAudioId: number | null;
  currentAudioParentNodeId: number | null;
  listAnchorItemId: number | null;
  listAnchorOffsetRatio: number;
  listScrollRatio: number | null;
  listScrollTop: number;
  pathStack: AsmrPathItem[];
  selectedId: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readNodeId(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseAsmrViewerSessionSnapshot(value: unknown): AsmrViewerSessionSnapshot | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AsmrViewerSessionSnapshot>;
  if (!Array.isArray(candidate.pathStack) || candidate.pathStack.length === 0 || candidate.pathStack.length > MAX_PATH_DEPTH) {
    return null;
  }
  const pathStack: AsmrPathItem[] = [];
  for (const item of candidate.pathStack) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = readNodeId((item as Partial<AsmrPathItem>).id);
    const name = (item as Partial<AsmrPathItem>).name;
    if (id == null || typeof name !== 'string') return null;
    pathStack.push({ id, name: name.slice(0, 512) });
  }
  const currentAudioId = readNodeId(candidate.currentAudioId);
  const currentAudioParentNodeId = readNodeId(candidate.currentAudioParentNodeId);
  const listAnchorItemId = readNodeId(candidate.listAnchorItemId);
  const listAnchorOffsetRatio = readFiniteNumber(candidate.listAnchorOffsetRatio);
  const listScrollRatio = candidate.listScrollRatio === null ? null : readFiniteNumber(candidate.listScrollRatio);
  const listScrollTop = readFiniteNumber(candidate.listScrollTop);
  const selectedId = readNodeId(candidate.selectedId);
  if (
    currentAudioId === undefined
    || currentAudioParentNodeId === undefined
    || listAnchorItemId === undefined
    || listAnchorOffsetRatio == null
    || (listScrollRatio === null && candidate.listScrollRatio !== null)
    || listScrollTop == null
    || listScrollTop < 0
    || selectedId === undefined
  ) {
    return null;
  }
  return {
    currentAudioId,
    currentAudioParentNodeId,
    listAnchorItemId,
    listAnchorOffsetRatio: clamp(listAnchorOffsetRatio, 0, 1),
    listScrollRatio: listScrollRatio == null ? null : clamp(listScrollRatio, 0, 1),
    listScrollTop: clamp(listScrollTop, 0, MAX_SCROLL_TOP),
    pathStack,
    selectedId,
  };
}

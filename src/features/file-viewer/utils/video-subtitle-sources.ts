import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { buildFileFullName } from '@/utils/fileTreeSettings';

export interface VideoSubtitleSourceNode {
  id: number;
  name?: string;
  type?: string;
  ext?: string;
  sortOrder?: number;
  sort_order?: number;
}

const VIDEO_SUBTITLE_EXTENSIONS = new Set(['lrc', 'srt', 'vtt', 'ass', 'ssa', 'qrc']);

export function normalizeVideoSubtitleExtension(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

export function getVideoSubtitleNodeSortOrder(item: VideoSubtitleSourceNode): number {
  const value = Number(item.sortOrder ?? item.sort_order ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function isVideoSubtitleSourceNode(item: VideoSubtitleSourceNode): boolean {
  if (item.type !== 'file') return false;
  const ext = normalizeVideoSubtitleExtension(item.ext);
  if (VIDEO_SUBTITLE_EXTENSIONS.has(ext)) return true;
  const fullName = buildFileFullName(String(item.name || ''), item.ext).toLowerCase();
  return ext === 'xml' && fullName.endsWith('.qrc.xml');
}

function compareVideoSubtitleSourceNodes(
  left: VideoSubtitleSourceNode,
  right: VideoSubtitleSourceNode,
): number {
  const orderDiff = getVideoSubtitleNodeSortOrder(left) - getVideoSubtitleNodeSortOrder(right);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id || 0) - Number(right.id || 0);
}

function toVideoSubtitleSource(
  item: VideoSubtitleSourceNode,
  libraryId: number,
): FileViewerSubtitleSource | null {
  if (!item.id || item.id <= 0 || !libraryId) return null;
  return {
    id: `library:${libraryId}:${item.id}`,
    sourceType: 'library',
    fileName: buildFileFullName(String(item.name || '字幕'), item.ext),
    nodeId: item.id,
    libraryId,
    sortOrder: getVideoSubtitleNodeSortOrder(item),
  };
}

export function buildVideoSubtitleSources(
  items: VideoSubtitleSourceNode[],
  libraryId: number,
): FileViewerSubtitleSource[] {
  return items
    .filter(isVideoSubtitleSourceNode)
    .sort(compareVideoSubtitleSourceNodes)
    .map(item => toVideoSubtitleSource(item, libraryId))
    .filter((item): item is FileViewerSubtitleSource => Boolean(item));
}

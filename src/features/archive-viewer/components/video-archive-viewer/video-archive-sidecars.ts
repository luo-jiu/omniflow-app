import { resolvePreviewFileType } from '@/utils/preview-file-type';
import { buildFileFullName } from '@/utils/fileTreeSettings';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';

export interface VideoArchiveChildNode {
  id: number;
  name?: string;
  type?: string;
  ext?: string;
  mimeType?: string;
  sortOrder?: number;
  sort_order?: number;
}

export interface VideoArchiveSidecarIndex {
  coverNodeIdByName: Map<string, number>;
  subtitlesByName: Map<string, VideoArchiveChildNode[]>;
}

export const VIDEO_ARCHIVE_EMPTY_SIDECARS: VideoArchiveSidecarIndex = {
  coverNodeIdByName: new Map(),
  subtitlesByName: new Map(),
};

const VIDEO_SUBTITLE_EXTENSIONS = new Set(['lrc', 'srt', 'vtt', 'ass', 'ssa']);

function normalizeVideoArchiveExtension(ext?: string): string {
  return String(ext || '').trim().toLowerCase().replace(/^\./, '');
}

export function normalizeVideoArchiveMatchName(name?: string, ext?: string): string {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedExt = normalizeVideoArchiveExtension(ext);
  if (!normalizedName || !normalizedExt || !normalizedName.endsWith(`.${normalizedExt}`)) {
    return normalizedName;
  }
  return normalizedName.slice(0, -(normalizedExt.length + 1)).trim();
}

function isVideoArchiveCoverNode(item: VideoArchiveChildNode): boolean {
  return item.type === 'file' && resolvePreviewFileType(item.mimeType, item.ext) === 'image';
}

function isVideoArchiveSubtitleNode(item: VideoArchiveChildNode): boolean {
  return item.type === 'file' && VIDEO_SUBTITLE_EXTENSIONS.has(normalizeVideoArchiveExtension(item.ext));
}

function getVideoArchiveNodeSortOrder(item: VideoArchiveChildNode): number {
  const value = Number(item.sortOrder ?? item.sort_order ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function compareVideoArchiveSubtitleNodes(left: VideoArchiveChildNode, right: VideoArchiveChildNode): number {
  const orderDiff = getVideoArchiveNodeSortOrder(left) - getVideoArchiveNodeSortOrder(right);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id || 0) - Number(right.id || 0);
}

function toVideoSubtitleSource(
  item: VideoArchiveChildNode,
  libraryId: number,
): FileViewerSubtitleSource | null {
  if (!item.id || item.id <= 0 || !libraryId) return null;
  return {
    id: `library:${libraryId}:${item.id}`,
    sourceType: 'library',
    fileName: buildFileFullName(String(item.name || '字幕'), item.ext),
    nodeId: item.id,
    libraryId,
    sortOrder: getVideoArchiveNodeSortOrder(item),
  };
}

export function buildVideoSubtitleSources(
  items: VideoArchiveChildNode[],
  libraryId: number,
): FileViewerSubtitleSource[] {
  return items
    .filter(isVideoArchiveSubtitleNode)
    .sort(compareVideoArchiveSubtitleNodes)
    .map(item => toVideoSubtitleSource(item, libraryId))
    .filter((item): item is FileViewerSubtitleSource => Boolean(item));
}

export function buildVideoArchiveSidecarIndex(children: VideoArchiveChildNode[]): VideoArchiveSidecarIndex {
  const coverNodeIdByName = new Map<string, number>();
  const subtitlesByName = new Map<string, VideoArchiveChildNode[]>();

  children.forEach((item) => {
    const matchName = normalizeVideoArchiveMatchName(item.name, item.ext);
    if (!matchName || item.id <= 0) return;
    if (isVideoArchiveCoverNode(item) && !coverNodeIdByName.has(matchName)) {
      coverNodeIdByName.set(matchName, item.id);
      return;
    }
    if (isVideoArchiveSubtitleNode(item)) {
      const bucket = subtitlesByName.get(matchName) || [];
      bucket.push(item);
      subtitlesByName.set(matchName, bucket);
    }
  });

  subtitlesByName.forEach((items, key) => {
    subtitlesByName.set(key, [...items].sort(compareVideoArchiveSubtitleNodes));
  });

  return {
    coverNodeIdByName,
    subtitlesByName,
  };
}

import { resolvePreviewFileType } from '@/utils/preview-file-type';
import {
  buildVideoSubtitleSources,
  getVideoSubtitleNodeSortOrder,
  isVideoSubtitleSourceNode,
  normalizeVideoSubtitleExtension,
} from '@/features/file-viewer/utils/video-subtitle-sources';

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

function normalizeVideoArchiveExtension(ext?: string): string {
  return normalizeVideoSubtitleExtension(ext);
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
  return isVideoSubtitleSourceNode(item);
}

function compareVideoArchiveSubtitleNodes(left: VideoArchiveChildNode, right: VideoArchiveChildNode): number {
  const orderDiff = getVideoSubtitleNodeSortOrder(left) - getVideoSubtitleNodeSortOrder(right);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id || 0) - Number(right.id || 0);
}
export { buildVideoSubtitleSources };

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

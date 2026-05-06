import { resolvePreviewFileType } from '@/utils/preview-file-type';
import {
  buildVideoSubtitleSources,
  getVideoSubtitleNodeSortOrder,
  isVideoSubtitleSourceNode,
  normalizeVideoSubtitleExtension,
} from '@/features/file-viewer/utils/video-subtitle-sources';

export interface AudioArchiveChildNode {
  id: number;
  name?: string;
  type?: string;
  ext?: string;
  mimeType?: string;
  sortOrder?: number;
  sort_order?: number;
}

export interface AudioArchiveSidecarIndex {
  coverNodeIdByName: Map<string, number>;
  subtitlesByName: Map<string, AudioArchiveChildNode[]>;
}

export const AUDIO_ARCHIVE_EMPTY_SIDECARS: AudioArchiveSidecarIndex = {
  coverNodeIdByName: new Map(),
  subtitlesByName: new Map(),
};

function normalizeAudioArchiveExtension(ext?: string): string {
  return normalizeVideoSubtitleExtension(ext);
}

export function normalizeAudioArchiveMatchName(name?: string, ext?: string): string {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedExt = normalizeAudioArchiveExtension(ext);
  if (!normalizedName || !normalizedExt || !normalizedName.endsWith(`.${normalizedExt}`)) {
    return normalizedName;
  }
  return normalizedName.slice(0, -(normalizedExt.length + 1)).trim();
}

function isAudioArchiveCoverNode(item: AudioArchiveChildNode): boolean {
  return item.type === 'file' && resolvePreviewFileType(item.mimeType, item.ext, item.name) === 'image';
}

function compareAudioArchiveSubtitleNodes(left: AudioArchiveChildNode, right: AudioArchiveChildNode): number {
  const orderDiff = getVideoSubtitleNodeSortOrder(left) - getVideoSubtitleNodeSortOrder(right);
  if (orderDiff !== 0) return orderDiff;
  return Number(left.id || 0) - Number(right.id || 0);
}

export { buildVideoSubtitleSources as buildAudioSubtitleSources };

export function buildAudioArchiveSidecarIndex(children: AudioArchiveChildNode[]): AudioArchiveSidecarIndex {
  const coverNodeIdByName = new Map<string, number>();
  const subtitlesByName = new Map<string, AudioArchiveChildNode[]>();

  children.forEach((item) => {
    const matchName = normalizeAudioArchiveMatchName(item.name, item.ext);
    if (!matchName || item.id <= 0) return;
    if (isAudioArchiveCoverNode(item) && !coverNodeIdByName.has(matchName)) {
      coverNodeIdByName.set(matchName, item.id);
      return;
    }
    if (isVideoSubtitleSourceNode(item)) {
      const bucket = subtitlesByName.get(matchName) || [];
      bucket.push(item);
      subtitlesByName.set(matchName, bucket);
    }
  });

  subtitlesByName.forEach((items, key) => {
    subtitlesByName.set(key, [...items].sort(compareAudioArchiveSubtitleNodes));
  });

  return {
    coverNodeIdByName,
    subtitlesByName,
  };
}

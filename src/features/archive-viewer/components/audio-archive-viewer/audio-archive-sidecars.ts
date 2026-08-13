import {
  buildVideoSubtitleSources,
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

export { buildVideoSubtitleSources as buildAudioSubtitleSources };

import {
  buildVideoSubtitleSources,
  normalizeVideoSubtitleExtension,
} from '@/features/file-viewer/utils/video-subtitle-sources';

// Keeps entry-mode and companion-file discovery outside the player controller.
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';
import { resolveNodeFileIdentity } from '@/features/file-identity';

export interface AudioArchiveChildNode {
  id: number;
  name?: string;
  type?: string;
  ext?: string;
  mimeType?: string;
  sortOrder?: number;
  sort_order?: number;
}

export interface AudioArchiveCard {
  id: number;
  mediaNodeId: number;
  title: string;
  sortOrder: number;
  coverNodeId: number | null;
  coverUrl: string | null;
  subtitleCount: number;
  durationSeconds?: number | null;
}

export interface SingleAudioFolderContent {
  card: AudioArchiveCard;
  subtitleSources: FileViewerSubtitleSource[];
}

export type AudioViewerMode = 'archive' | 'folder' | 'bare';

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

export function resolveAudioViewerMode(fileUrl: string): AudioViewerMode {
  if (fileUrl.startsWith('audio-archive://')) return 'archive';
  if (fileUrl.startsWith('audio-folder://')) return 'folder';
  return 'bare';
}

export function buildBareAudioCard(nodeId: number, title: string): AudioArchiveCard | null {
  if (!Number.isFinite(nodeId) || nodeId <= 0) return null;
  return {
    id: nodeId,
    mediaNodeId: nodeId,
    title: String(title || '').trim() || '音频',
    sortOrder: 0,
    coverNodeId: null,
    coverUrl: null,
    subtitleCount: 0,
    durationSeconds: null,
  };
}

export function buildSingleAudioFolderContent({
  children,
  folderNodeId,
  libraryId,
  title,
}: {
  children: AudioArchiveChildNode[];
  folderNodeId: number;
  libraryId: number;
  title: string;
}): SingleAudioFolderContent | null {
  const visibleFiles = children.filter(child => (
    (String(child.type) === 'file' || Number(child.type) === 1)
      && !String(child.name || '').trim().startsWith('.')
      && Number(child.id) > 0
  ));
  const mediaNode = visibleFiles.find(child => resolveNodeFileIdentity({
    name: String(child.name || ''),
    ext: child.ext,
    mimeType: child.mimeType,
  }).previewKind === 'audio');
  if (!mediaNode) return null;

  const coverNode = visibleFiles.find(child => resolveNodeFileIdentity({
    name: String(child.name || ''),
    ext: child.ext,
    mimeType: child.mimeType,
  }).previewKind === 'image');
  const subtitleSources = buildVideoSubtitleSources(visibleFiles, libraryId);

  return {
    card: {
      id: folderNodeId,
      mediaNodeId: mediaNode.id,
      title: String(title || '').trim() || '音乐',
      sortOrder: 0,
      coverNodeId: coverNode?.id ?? null,
      coverUrl: null,
      subtitleCount: subtitleSources.length,
      durationSeconds: null,
    },
    subtitleSources,
  };
}

export { buildVideoSubtitleSources as buildAudioSubtitleSources };

import { createContext } from 'react';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

export interface FileViewerReturnTarget {
  fileUrl: string;
  fileName: string | null;
  fileType: FileViewerFileType;
  nodeId: number | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
}

export interface FileViewerSubtitleSource {
  id: string;
  sourceType: 'library';
  fileName: string;
  nodeId: number;
  libraryId: number;
  sortOrder?: number | null;
}

export interface FileViewerVideoPlaylistItem {
  nodeId: number;
  libraryId: number;
  title: string;
  sortOrder?: number | null;
  durationSeconds?: number | null;
  subtitleCardNodeId?: number | null;
  subtitleSources?: FileViewerSubtitleSource[];
}

export interface FileViewerVideoPlaylist {
  id: string;
  title: string;
  items: FileViewerVideoPlaylistItem[];
  total?: number | null;
  nextOffset?: number | null;
  hasMore?: boolean;
  source?: {
    kind: 'video_archive_collection';
    nodeId: number;
    libraryId: number;
  } | null;
}

export interface FileViewerAudioPlaylistItem {
  nodeId: number;
  libraryId: number;
  title: string;
  sortOrder?: number | null;
  durationSeconds?: number | null;
  coverUrl?: string | null;
  subtitleSources?: FileViewerSubtitleSource[];
}

export interface FileViewerAudioPlaylist {
  id: string;
  title: string;
  items: FileViewerAudioPlaylistItem[];
}

export interface FileViewerOpenOptions {
  contentRevision?: string | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
  replaceTabId?: string | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  videoPlaylist?: FileViewerVideoPlaylist | null;
  videoAutoPlay?: boolean;
  audioSubtitleSources?: FileViewerSubtitleSource[];
  audioPlaylist?: FileViewerAudioPlaylist | null;
  audioAutoPlay?: boolean;
  audioCoverUrl?: string | null;
}

export interface FileViewerState {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  tabTypeLabel?: string | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  videoPlaylist?: FileViewerVideoPlaylist | null;
  videoAutoPlay?: boolean;
  audioSubtitleSources?: FileViewerSubtitleSource[];
  audioPlaylist?: FileViewerAudioPlaylist | null;
  audioAutoPlay?: boolean;
  audioCoverUrl?: string | null;
  loading: boolean;
}

export interface FileViewerTab {
  id: string;
  libraryId: number | null;
  nodeId: number | null;
  fileUrl: string;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  videoPlaylist?: FileViewerVideoPlaylist | null;
  videoAutoPlay?: boolean;
  audioSubtitleSources?: FileViewerSubtitleSource[];
  audioPlaylist?: FileViewerAudioPlaylist | null;
  audioAutoPlay?: boolean;
  audioCoverUrl?: string | null;
  loading: boolean;
  reloadToken?: number;
  contentRevision: string | null;
}

export interface FileViewerContextType {
  fileState: FileViewerState;
  tabs: FileViewerTab[];
  activeTabId: string | null;
  setFileUrl: (
    url: string | null,
    fileName: string | null,
    fileType: FileViewerFileType | null,
    nodeId?: number | null,
    options?: FileViewerOpenOptions,
  ) => void;
  setLoading: (loading: boolean) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeTabByNodeId: (nodeId: number) => void;
  reloadActiveTab: () => void;
  reorderTabs: (
    draggedTabId: string,
    targetTabId: string,
    position: 'before' | 'after',
  ) => void;
}

export const FileViewerContext = createContext<FileViewerContextType | undefined>(undefined);

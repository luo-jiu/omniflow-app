import { createContext } from 'react';
import type { FileViewerFileType } from '@/shared/file-viewer-types';

export interface FileViewerReturnTarget {
  fileUrl: string;
  fileName: string | null;
  fileType: FileViewerFileType;
  nodeId: number | null;
  tabTypeLabel?: string | null;
}

export interface FileViewerSubtitleSource {
  id: string;
  sourceType: 'library';
  fileName: string;
  nodeId: number;
  libraryId: number;
  sortOrder?: number | null;
}

export interface FileViewerOpenOptions {
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
}

export interface FileViewerState {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  tabTypeLabel?: string | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  loading: boolean;
}

export interface FileViewerTab {
  id: string;
  nodeId: number | null;
  fileUrl: string;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  loading: boolean;
  reloadToken?: number;
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

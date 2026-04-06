import { createContext } from 'react';

export interface FileViewerReturnTarget {
  fileUrl: string;
  fileName: string | null;
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other';
  nodeId: number | null;
  tabTypeLabel?: string | null;
}

export interface FileViewerState {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other' | null;
  tabTypeLabel?: string | null;
  loading: boolean;
}

export interface FileViewerTab {
  id: string;
  nodeId: number | null;
  fileUrl: string;
  fileName: string | null;
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other' | null;
  tabTypeLabel?: string | null;
  returnTarget?: FileViewerReturnTarget | null;
  loading: boolean;
}

export interface FileViewerContextType {
  fileState: FileViewerState;
  tabs: FileViewerTab[];
  activeTabId: string | null;
  setFileUrl: (
    url: string | null,
    fileName: string | null,
    fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'other' | null,
    nodeId?: number | null,
    options?: {
      tabTypeLabel?: string | null;
      returnTarget?: FileViewerReturnTarget | null;
    },
  ) => void;
  setLoading: (loading: boolean) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeTabByNodeId: (nodeId: number) => void;
}

export const FileViewerContext = createContext<FileViewerContextType | undefined>(undefined);

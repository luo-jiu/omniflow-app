import { createContext } from 'react';

export interface FileViewerState {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: 'image' | 'video' | 'audio' | 'other' | null;
  loading: boolean;
}

export interface FileViewerContextType {
  fileState: FileViewerState;
  setFileUrl: (
    url: string | null,
    fileName: string | null,
    fileType: 'image' | 'video' | 'audio' | 'other' | null,
    nodeId?: number | null,
  ) => void;
  setLoading: (loading: boolean) => void;
}

export const FileViewerContext = createContext<FileViewerContextType | undefined>(undefined);

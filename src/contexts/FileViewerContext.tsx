import React, { createContext, useContext, useState, ReactNode } from 'react';

interface FileViewerState {
  fileUrl: string | null;
  fileName: string | null;
  fileType: 'image' | 'video' | 'other' | null;
  loading: boolean;
}

interface FileViewerContextType {
  fileState: FileViewerState;
  setFileUrl: (url: string | null, fileName: string | null, fileType: 'image' | 'video' | 'other' | null) => void;
  setLoading: (loading: boolean) => void;
}

const FileViewerContext = createContext<FileViewerContextType | undefined>(undefined);

export const FileViewerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [fileState, setFileState] = useState<FileViewerState>({
    fileUrl: null,
    fileName: null,
    fileType: null,
    loading: false,
  });

  const setFileUrl = (url: string | null, fileName: string | null, fileType: 'image' | 'video' | 'other' | null) => {
    setFileState({
      fileUrl: url,
      fileName,
      fileType,
      loading: false,
    });
  };

  const setLoading = (loading: boolean) => {
    setFileState(prev => ({ ...prev, loading }));
  };

  return (
    <FileViewerContext.Provider value={{ fileState, setFileUrl, setLoading }}>
      {children}
    </FileViewerContext.Provider>
  );
};

export const useFileViewer = () => {
  const context = useContext(FileViewerContext);
  if (!context) {
    throw new Error('useFileViewer must be used within FileViewerProvider');
  }
  return context;
};

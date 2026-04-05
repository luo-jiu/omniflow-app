import { useContext } from 'react';
import { FileViewerContext } from '@/contexts/file-viewer.context';

export function useFileViewer() {
  const context = useContext(FileViewerContext);
  if (!context) {
    throw new Error('useFileViewer must be used within FileViewerProvider');
  }
  return context;
}

import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileViewerReturnTarget, FileViewerSubtitleSource, FileViewerVideoPlaylist, FileViewerVideoTransition } from '@/contexts/file-viewer.context';
export interface FileDispatcherProps {
  viewerId?: string;
  viewerGeneration?: number;
  onSelectViewer?: (id: string, remember?: boolean) => void;
  accountScope: string | null;
  libraryId: number | null;
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  returnTarget?: FileViewerReturnTarget | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  videoPlaylist?: FileViewerVideoPlaylist | null;
  videoAutoPlay?: boolean;
  videoTransition?: FileViewerVideoTransition;
  loading: boolean;
  active?: boolean;
  reloadToken?: number;
  contentRevision: string | null;
  tabId: string;
}

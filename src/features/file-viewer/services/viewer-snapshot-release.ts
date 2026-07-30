import type { FileViewerTab } from '@/contexts/file-viewer.context';
import {
  clearAllAsmrArchiveSnapshots,
  clearAsmrArchiveSnapshotForFile,
} from '@/features/archive-viewer/components/asmr-archive-viewer/asmr-archive-cache';
import {
  clearAllAudioArchiveSnapshots,
  clearAudioArchiveSnapshotForFile,
} from '@/features/archive-viewer/components/audio-archive-viewer/audio-archive-cache';
import {
  clearAllComicArchiveSnapshots,
  clearComicArchiveSnapshotForFile,
} from '@/features/archive-viewer/components/comic-archive-viewer/comic-archive-cache';
import {
  clearAllVideoArchiveSnapshots,
  clearVideoArchiveSnapshotForFile,
} from '@/features/archive-viewer/components/video-archive-viewer/video-archive-cache';
import {
  clearAllAsmrViewerSnapshots,
  clearAsmrViewerSnapshotForFile,
} from '@/features/file-viewer/components/asmr-viewer/asmr-viewer-cache';
import {
  clearAllComicReaderSnapshots,
  clearComicReaderSnapshotForFile,
} from '@/features/file-viewer/components/comic-viewer/comic-reader-cache';
import {
  clearAllGallerySnapshots,
  clearGallerySnapshotForFile,
} from '@/features/file-viewer/components/gallery-viewer/gallery-viewer-cache';
import {
  clearAllPdfViewerSnapshots,
  clearPdfViewerSnapshotForFile,
} from '@/features/file-viewer/components/pdf-viewer/pdf-viewer-cache';
import {
  clearAllVideoProgressSnapshots,
  clearVideoProgressSnapshotForFile,
} from '@/features/file-viewer/components/video-viewer/video-progress-cache';

export function clearViewerSnapshotsForTabs(tabs: FileViewerTab[] | null | undefined) {
  (tabs ?? []).forEach((tab) => {
    switch (tab.fileType) {
      case 'pdf':
        clearPdfViewerSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'video':
        clearVideoProgressSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'comic':
        clearComicReaderSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'gallery':
        clearGallerySnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'asmr':
        clearAsmrViewerSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'audio_archive':
        clearAudioArchiveSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'video_archive':
        clearVideoArchiveSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'comic_archive':
        clearComicArchiveSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      case 'asmr_archive':
        clearAsmrArchiveSnapshotForFile(tab.fileUrl, tab.nodeId);
        break;
      default:
        break;
    }
  });
}

export function clearAllViewerSnapshots() {
  clearAllPdfViewerSnapshots();
  clearAllVideoProgressSnapshots();
  clearAllComicReaderSnapshots();
  clearAllGallerySnapshots();
  clearAllAsmrViewerSnapshots();
  clearAllAudioArchiveSnapshots();
  clearAllVideoArchiveSnapshots();
  clearAllComicArchiveSnapshots();
  clearAllAsmrArchiveSnapshots();
}

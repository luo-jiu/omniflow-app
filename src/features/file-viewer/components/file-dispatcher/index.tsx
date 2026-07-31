import React from 'react';
import { Spin } from "@douyinfe/semi-ui";
import ImageViewer from "../image-viewer";
import AudioViewer from "../audio-viewer";
import VideoViewer from "../video-viewer";
import ComicViewer from "../comic-viewer";
import GalleryViewer from "../gallery-viewer";
import PdfViewer from "../pdf-viewer";
import TextViewer from "../text-viewer";
import AsmrViewer from "../asmr-viewer";
import AsmrArchiveViewer from "../../../archive-viewer/components/asmr-archive-viewer";
import ComicArchiveViewer from "../../../archive-viewer/components/comic-archive-viewer";
import GalleryArchiveViewer from "../../../archive-viewer/components/gallery-archive-viewer";
import VideoArchiveViewer from "../../../archive-viewer/components/video-archive-viewer";
import AudioArchiveViewer from "../../../archive-viewer/components/audio-archive-viewer";
import styled from 'styled-components';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type {
  FileViewerAudioPlaylist,
  FileViewerReturnTarget,
  FileViewerSubtitleSource,
  FileViewerVideoPlaylist,
} from '@/contexts/file-viewer.context';

interface FileDispatcherProps {
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
  audioSubtitleSources?: FileViewerSubtitleSource[];
  audioPlaylist?: FileViewerAudioPlaylist | null;
  audioAutoPlay?: boolean;
  audioCoverUrl?: string | null;
  loading: boolean;
  active?: boolean;
  reloadToken?: number;
  contentRevision: string | null;
  tabId: string;
}

const DispatcherWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  .loading-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .unsupported-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px;
    text-align: center;
    
    .filename {
      color: var(--semi-color-text-2);
      font-size: 14px;
    }

    .download-btn {
      padding: 10px 24px;
      background: var(--semi-color-primary);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      transition: background 0.2s;
      &:hover {
        background: var(--semi-color-primary-hover);
      }
    }
  }

`;

/**
 * 文件分发器组件
 * 根据文件类型渲染对应的查看器 Feature
 */
const FileDispatcher: React.FC<FileDispatcherProps> = ({
  accountScope,
  libraryId,
  nodeId,
  fileUrl,
  fileName,
  fileType,
  returnTarget,
  videoSubtitleSources,
  videoPlaylist,
  videoAutoPlay = false,
  audioSubtitleSources,
  audioPlaylist,
  audioAutoPlay = false,
  audioCoverUrl,
  loading,
  active = true,
  reloadToken = 0,
  contentRevision,
  tabId,
}) => {
  if (loading) {
    return (
      <DispatcherWrapper>
        <div className="loading-container">
          <Spin size="large" tip="正在加载文件..." />
        </div>
      </DispatcherWrapper>
    );
  }

  if (!fileUrl) return null;

  switch (fileType) {
    case 'image':
      return <ImageViewer nodeId={nodeId} url={fileUrl} fileName={fileName} active={active} />;
    
    case 'audio':
      return (
        <AudioViewer
          nodeId={nodeId}
          url={fileUrl}
          fileName={fileName}
          active={active}
          tabId={tabId}
          returnTarget={returnTarget}
          subtitleSources={audioSubtitleSources}
          playlist={audioPlaylist}
          autoPlay={audioAutoPlay}
          coverUrl={audioCoverUrl}
        />
      );

    case 'video':
      return (
        <VideoViewer
          nodeId={nodeId}
          url={fileUrl}
          fileName={fileName}
          active={active}
          tabId={tabId}
          returnTarget={returnTarget}
          subtitleSources={videoSubtitleSources}
          playlist={videoPlaylist}
          autoPlay={videoAutoPlay}
        />
      );

    case 'pdf':
      return (
        <PdfViewer
          accountScope={accountScope}
          active={active}
          contentRevision={contentRevision}
          fileName={fileName}
          libraryId={libraryId}
          nodeId={nodeId}
          reloadToken={reloadToken}
          tabId={tabId}
          url={fileUrl}
        />
      );

    case 'text':
      return <TextViewer nodeId={nodeId} url={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'comic':
      return <ComicViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'gallery':
      return <GalleryViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} tabId={tabId} />;

    case 'asmr':
      return <AsmrViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} tabId={tabId} />;

    case 'asmr_archive':
      return <AsmrArchiveViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'comic_archive':
      return (
        <ComicArchiveViewer
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          active={active}
          reloadToken={reloadToken}
          returnTarget={returnTarget}
        />
      );

    case 'gallery_archive':
      return (
        <GalleryArchiveViewer
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          active={active}
          reloadToken={reloadToken}
          returnTarget={returnTarget}
        />
      );

    case 'video_archive':
      return <VideoArchiveViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'audio_archive':
      return (
        <AudioArchiveViewer
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          active={active}
          tabId={tabId}
          reloadToken={reloadToken}
        />
      );

    default:
      return (
        <DispatcherWrapper>
          <div className="unsupported-container">
            <p>该文件类型暂不支持预览</p>
            <p className="filename">{fileName}</p>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="download-btn">
              下载文件
            </a>
          </div>
        </DispatcherWrapper>
      );
  }
};

export default FileDispatcher;

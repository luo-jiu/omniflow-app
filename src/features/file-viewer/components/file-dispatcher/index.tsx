import React from 'react';
import { Spin } from "@douyinfe/semi-ui";
import ImageViewer from "../image-viewer";
import AudioViewer from "../audio-viewer";
import VideoViewer from "../video-viewer";
import ComicViewer from "../comic-viewer";
import PdfViewer from "../pdf-viewer";
import TextViewer from "../text-viewer";
import AsmrViewer from "../asmr-viewer";
import AsmrArchiveViewer from "../../../archive-viewer/components/asmr-archive-viewer";
import ComicArchiveViewer from "../../../archive-viewer/components/comic-archive-viewer";
import VideoArchiveViewer from "../../../archive-viewer/components/video-archive-viewer";
import AudioArchiveViewer from "../../../archive-viewer/components/audio-archive-viewer";
import styled from 'styled-components';
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileViewerSubtitleSource } from '@/contexts/file-viewer.context';

interface FileDispatcherProps {
  nodeId: number | null;
  fileUrl: string | null;
  fileName: string | null;
  fileType: FileViewerFileType | null;
  videoSubtitleSources?: FileViewerSubtitleSource[];
  loading: boolean;
  active?: boolean;
  reloadToken?: number;
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
  nodeId,
  fileUrl,
  fileName,
  fileType,
  videoSubtitleSources,
  loading,
  active = true,
  reloadToken = 0,
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
      return <ImageViewer url={fileUrl} fileName={fileName} />;
    
    case 'audio':
      return <AudioViewer nodeId={nodeId} url={fileUrl} fileName={fileName} active={active} tabId={tabId} />;

    case 'video':
      return (
        <VideoViewer
          nodeId={nodeId}
          url={fileUrl}
          fileName={fileName}
          active={active}
          tabId={tabId}
          subtitleSources={videoSubtitleSources}
        />
      );

    case 'pdf':
      return <PdfViewer nodeId={nodeId} url={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'text':
      return <TextViewer nodeId={nodeId} url={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'comic':
      return <ComicViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} />;

    case 'asmr':
      return <AsmrViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} reloadToken={reloadToken} tabId={tabId} />;

    case 'asmr_archive':
      return <AsmrArchiveViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} />;

    case 'comic_archive':
      return (
        <ComicArchiveViewer
          folderNodeId={nodeId}
          fileUrl={fileUrl}
          fileName={fileName}
          active={active}
          reloadToken={reloadToken}
        />
      );

    case 'video_archive':
      return <VideoArchiveViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} />;

    case 'audio_archive':
      return <AudioArchiveViewer folderNodeId={nodeId} fileUrl={fileUrl} fileName={fileName} active={active} />;

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

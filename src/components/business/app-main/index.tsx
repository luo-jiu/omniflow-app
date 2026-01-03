import {FC, ReactNode} from "react";
import MainWrapper from "./style.ts";
import ReactLogo from "@/assets/img/React.svg";
import { useFileViewer } from "@/contexts/FileViewerContext";
import { Spin } from "@douyinfe/semi-ui";

interface IProps {
  children?: ReactNode;
}

const AppMain: FC<IProps> = () => {
  const { fileState } = useFileViewer();

  // 如果有文件正在查看，显示文件内容
  if (fileState.fileUrl) {
    return (
      <MainWrapper>
        <div className="file-viewer">
          {fileState.loading ? (
            <div className="file-viewer-loading">
              <Spin size="large" />
            </div>
          ) : (
            <>
              {fileState.fileType === 'image' && (
                <div className="file-viewer-content">
                  <img 
                    src={fileState.fileUrl} 
                    alt={fileState.fileName || 'Image'} 
                    className="file-viewer-image"
                  />
                  {fileState.fileName && (
                    <div className="file-viewer-title">{fileState.fileName}</div>
                  )}
                </div>
              )}
              {fileState.fileType === 'video' && (
                <div className="file-viewer-content">
                  <video 
                    src={fileState.fileUrl} 
                    controls 
                    className="file-viewer-video"
                  >
                    您的浏览器不支持视频播放
                  </video>
                  {fileState.fileName && (
                    <div className="file-viewer-title">{fileState.fileName}</div>
                  )}
                </div>
              )}
              {fileState.fileType === 'other' && (
                <div className="file-viewer-content">
                  <div className="file-viewer-other">
                    <p>文件类型暂不支持预览</p>
                    <p className="file-viewer-filename">{fileState.fileName}</p>
                    <a 
                      href={fileState.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="file-viewer-download"
                    >
                      下载文件
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </MainWrapper>
    );
  }

  // 默认显示原来的内容
  return (
    <MainWrapper>
      <header className="header">
        <div className="logo-box">
          <img src={ReactLogo} alt="Logo" className="logo"/>
        </div>
        <div className="text-box">
          <h1 className="heading-primary">
            <span className="heading-primary-main">Outdoors</span>
            <span className="heading-primary-sub">is where life happens</span>
          </h1>
          <a href="#" className="btn btn-white">Discover our tours</a>
        </div>
      </header>
    </MainWrapper>
  );
}

export default AppMain;

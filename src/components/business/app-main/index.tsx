import React, { FC, ReactNode } from "react";
import MainWrapper from "./style.ts";
import { useFileViewer } from "@/hooks/useFileViewer";
import WelcomeView from "@/features/file-viewer/components/welcome-view";
import FileDispatcher from "@/features/file-viewer/components/file-dispatcher";
import GlobalAudioMiniBar from "@/components/business/global-audio-mini-bar";
import FileTabsBar from "./FileTabsBar";
import { globalAudioPlayer } from "@/features/file-viewer/services/global-audio-player";
import { resolveAsmrOwnerKey } from "@/features/file-viewer/utils/asmr-owner-key";

interface IProps {
  children?: ReactNode;
}

/**
 * 主工作区容器
 * 负责在“欢迎页”和“文件预览页”之间切换
 */
const AppMain: FC<IProps> = () => {
  const { fileState, tabs, activeTabId, activateTab, closeTab } = useFileViewer();
  const [playerState, setPlayerState] = React.useState(() => globalAudioPlayer.getState());

  React.useEffect(() => globalAudioPlayer.subscribe(setPlayerState), []);

  const activeAsmrViewerKey = React.useMemo(() => {
    if (fileState.fileType !== 'asmr') {
      return null;
    }
    return resolveAsmrOwnerKey(String(fileState.fileUrl || ''), fileState.nodeId);
  }, [fileState.fileType, fileState.fileUrl, fileState.nodeId]);

  const suppressGlobalAudioBar = (
    fileState.fileType === 'asmr'
    && playerState.ownerType === 'asmr'
    && Boolean(activeAsmrViewerKey)
    && playerState.ownerKey === activeAsmrViewerKey
  );

  // 如果没有文件在查看，显示欢迎视图
  if (!fileState.fileUrl && !fileState.loading) {
    return (
      <MainWrapper>
        <FileTabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
        <GlobalAudioMiniBar suppressed={suppressGlobalAudioBar} />
        <div className="main-content">
          <WelcomeView />
        </div>
      </MainWrapper>
    );
  }

  // 否则显示文件分发器（处理图片、视频等预览）
  return (
    <MainWrapper className="viewer-mode">
      <FileTabsBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
      />
      <GlobalAudioMiniBar suppressed={suppressGlobalAudioBar} />
      <div className="main-content">
        <FileDispatcher
          nodeId={fileState.nodeId}
          fileUrl={fileState.fileUrl}
          fileName={fileState.fileName}
          fileType={fileState.fileType}
          loading={fileState.loading}
        />
      </div>
    </MainWrapper>
  );
}

export default AppMain;

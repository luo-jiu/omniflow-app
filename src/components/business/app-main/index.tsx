import { FC, ReactNode } from "react";
import MainWrapper from "./style.ts";
import { useFileViewer } from "@/hooks/useFileViewer";
import WelcomeView from "@/features/file-viewer/components/welcome-view";
import FileDispatcher from "@/features/file-viewer/components/file-dispatcher";
import GlobalAudioMiniBar from "@/components/business/global-audio-mini-bar";
import FileTabsBar from "./FileTabsBar";

interface IProps {
  children?: ReactNode;
}

/**
 * 主工作区容器
 * 负责在“欢迎页”和“文件预览页”之间切换
 */
const AppMain: FC<IProps> = () => {
  const { fileState, tabs, activeTabId, activateTab, closeTab } = useFileViewer();
  const hasTabs = tabs.length > 0;
  const audioTopOffset = hasTabs ? 38 : 12;

  // 如果没有文件在查看，显示欢迎视图
  if (!fileState.fileUrl && !fileState.loading) {
    return (
      <MainWrapper>
        <GlobalAudioMiniBar topOffset={audioTopOffset} />
        <FileTabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
        <div className="main-content">
          <WelcomeView />
        </div>
      </MainWrapper>
    );
  }

  // 否则显示文件分发器（处理图片、视频等预览）
  return (
    <MainWrapper className="viewer-mode">
      <GlobalAudioMiniBar topOffset={audioTopOffset} />
      <FileTabsBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
      />
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

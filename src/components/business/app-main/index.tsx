import React, { FC, ReactNode } from "react";
import MainWrapper from "./style.ts";
import { useFileViewer } from "@/hooks/useFileViewer";
import WelcomeView from "@/features/file-viewer/components/welcome-view";
import FileDispatcher from "@/features/file-viewer/components/file-dispatcher";
import FileTabsBar from "./FileTabsBar";

interface IProps {
  children?: ReactNode;
  hideTabsBar?: boolean;
}

/**
 * 主工作区容器
 * 负责在“欢迎页”和“文件预览页”之间切换
 */
const AppMain: FC<IProps> = ({ hideTabsBar = false }) => {
  const { fileState, tabs, activeTabId, activateTab, closeTab, reorderTabs } = useFileViewer();
  const [keepAliveTabIds, setKeepAliveTabIds] = React.useState<string[]>(() => (
    activeTabId ? [activeTabId] : []
  ));

  const tabMap = React.useMemo(() => {
    return new Map(tabs.map((tab) => [tab.id, tab]));
  }, [tabs]);

  React.useEffect(() => {
    setKeepAliveTabIds((prev) => {
      const survived = prev.filter((tabId) => tabMap.has(tabId));
      if (!activeTabId || !tabMap.has(activeTabId)) {
        return survived;
      }
      return [...survived.filter((tabId) => tabId !== activeTabId), activeTabId];
    });
  }, [activeTabId, tabMap]);

  const keepAliveTabs = React.useMemo(() => {
    const cached = keepAliveTabIds
      .map((tabId) => tabMap.get(tabId))
      .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    if (!activeTabId) {
      return cached;
    }
    const activeTab = tabMap.get(activeTabId);
    if (!activeTab) {
      return cached;
    }
    if (cached.some((tab) => tab.id === activeTabId)) {
      return cached;
    }
    return [...cached, activeTab];
  }, [activeTabId, keepAliveTabIds, tabMap]);

  // 如果没有文件在查看，显示欢迎视图
  if (!fileState.fileUrl && !fileState.loading) {
    return (
      <MainWrapper>
        {hideTabsBar ? null : (
          <FileTabsBar
            tabs={tabs}
            activeTabId={activeTabId}
            onActivate={activateTab}
            onClose={closeTab}
            onReorder={reorderTabs}
          />
        )}
        <div className="main-content">
          <WelcomeView />
        </div>
      </MainWrapper>
    );
  }

  // 否则显示文件分发器（处理图片、视频等预览）
  return (
    <MainWrapper className="viewer-mode">
      {hideTabsBar ? null : (
        <FileTabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
          onReorder={reorderTabs}
        />
      )}
      <div className="main-content">
        <div className="tab-stage-stack">
          {keepAliveTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`tab-stage ${isActive ? 'active' : 'inactive'}`}
                aria-hidden={!isActive}
              >
                <FileDispatcher
                  key={`${tab.id}:${tab.reloadToken ?? 0}`}
                  nodeId={tab.nodeId}
                  fileUrl={tab.fileUrl}
                  fileName={tab.fileName}
                  fileType={tab.fileType}
                  videoSubtitleSources={tab.videoSubtitleSources}
                  loading={tab.loading}
                  active={isActive}
                  reloadToken={tab.reloadToken ?? 0}
                  tabId={tab.id}
                />
              </div>
            );
          })}
        </div>
      </div>
    </MainWrapper>
  );
}

export default AppMain;

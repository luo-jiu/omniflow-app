import React, { FC, ReactNode } from "react";
import MainWrapper from "./style.ts";
import { useFileViewer } from "@/hooks/useFileViewer";
import WelcomeView from "@/features/file-viewer/components/welcome-view";
import FileDispatcher from "@/features/file-viewer/components/file-dispatcher";
import FileTabsBar from "./FileTabsBar";
import { useAuth } from '@/hooks/useAuth';
import {
  buildViewerHotRetentionCandidates,
  createUserViewerAccountScope,
  DEFAULT_VIEWER_HOT_RETENTION_BUDGET,
  planViewerHotRetention,
  prepareViewerHotEvictions,
  VIEWER_HOT_RETENTION_ENFORCEMENT_ENABLED,
  ViewerHotAccessOrderOwner,
  viewerSessionRegistry,
} from '@/features/file-viewer/session';

interface IProps {
  children?: ReactNode;
  hideTabsBar?: boolean;
  workspaceActive?: boolean;
}

const subscribeViewerHotRetention = (listener: () => void) => (
  viewerSessionRegistry.subscribeRetention(listener)
);

const getViewerHotRetentionRevision = () => viewerSessionRegistry.getRetentionRevision();

/**
 * 主工作区容器
 * 负责在“欢迎页”和“文件预览页”之间切换
 */
const AppMain: FC<IProps> = ({ hideTabsBar = false, workspaceActive = true }) => {
  const { fileState, tabs, activeTabId, activateTab, closeTab, reorderTabs } = useFileViewer();
  const { user } = useAuth();
  const hotRetentionRevision = React.useSyncExternalStore(
    subscribeViewerHotRetention,
    getViewerHotRetentionRevision,
    getViewerHotRetentionRevision,
  );
  const accountScope = React.useMemo(
    () => createUserViewerAccountScope(Number(user?.id)),
    [user?.id],
  );
  const hotAccessOrderOwnerRef = React.useRef<ViewerHotAccessOrderOwner | null>(null);
  if (hotAccessOrderOwnerRef.current === null) {
    hotAccessOrderOwnerRef.current = new ViewerHotAccessOrderOwner();
  }
  const [keepAliveTabIds, setKeepAliveTabIds] = React.useState<string[]>(() => (
    activeTabId ? [activeTabId] : []
  ));

  const tabMap = React.useMemo(() => {
    return new Map(tabs.map((tab) => [tab.id, tab]));
  }, [tabs]);

  React.useEffect(() => {
    hotAccessOrderOwnerRef.current?.retain(tabs.map(tab => tab.id));
  }, [tabs]);

  React.useEffect(() => {
    if (workspaceActive && activeTabId) {
      hotAccessOrderOwnerRef.current?.touch(activeTabId);
    }
  }, [activeTabId, workspaceActive]);

  React.useEffect(() => {
    setKeepAliveTabIds((prev) => {
      const survived = prev.filter((tabId) => tabMap.has(tabId));
      if (!activeTabId || !tabMap.has(activeTabId)) {
        return survived;
      }
      if (survived.includes(activeTabId)) {
        return survived;
      }
      return [...survived, activeTabId];
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

  React.useEffect(() => {
    if (!VIEWER_HOT_RETENTION_ENFORCEMENT_ENABLED || !workspaceActive) return;
    const accessOrders = new Map(
      hotAccessOrderOwnerRef.current
        ?.snapshot(keepAliveTabs.map(tab => tab.id))
        .map(item => [item.tabId, item.lastAccessOrder])
      ?? [],
    );
    const tabProjections = keepAliveTabs.map(tab => ({
      active: tab.id === activeTabId,
      lastAccessOrder: accessOrders.get(tab.id) ?? null,
      libraryId: tab.libraryId,
      tabId: tab.id,
      viewerKind: tab.fileType,
    }));
    const candidates = buildViewerHotRetentionCandidates(
      tabProjections,
      viewerSessionRegistry.getLiveRetentionProjections(),
    );
    const plan = planViewerHotRetention(candidates, DEFAULT_VIEWER_HOT_RETENTION_BUDGET);
    if (plan.evictions.length === 0) return;
    const prepared = prepareViewerHotEvictions(
      plan.evictions,
      tabProjections,
      target => viewerSessionRegistry.prepareLiveInstanceForHotEviction(target),
      target => viewerSessionRegistry.hasRestorableSnapshotForHotEviction(target),
    );
    if (prepared.evictedTabIds.length === 0) return;
    const evictedTabIds = new Set(prepared.evictedTabIds);
    setKeepAliveTabIds(prev => prev.filter(tabId => !evictedTabIds.has(tabId)));
  }, [activeTabId, hotRetentionRevision, keepAliveTabs, workspaceActive]);

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
            const isActive = workspaceActive && tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`tab-stage ${isActive ? 'active' : 'inactive'}`}
                data-viewer-interaction-root
                aria-hidden={!isActive}
              >
                <FileDispatcher
                  key={`${tab.id}:${tab.reloadToken ?? 0}`}
                  nodeId={tab.nodeId}
                  accountScope={accountScope}
                  libraryId={tab.libraryId}
                  fileUrl={tab.fileUrl}
                  fileName={tab.fileName}
                  fileType={tab.fileType}
                  returnTarget={tab.returnTarget}
                  videoSubtitleSources={tab.videoSubtitleSources}
                  videoPlaylist={tab.videoPlaylist}
                  videoAutoPlay={tab.videoAutoPlay}
                  audioSubtitleSources={tab.audioSubtitleSources}
                  audioPlaylist={tab.audioPlaylist}
                  audioAutoPlay={tab.audioAutoPlay}
                  audioCoverUrl={tab.audioCoverUrl}
                  loading={tab.loading}
                  active={isActive}
                  reloadToken={tab.reloadToken ?? 0}
                  contentRevision={tab.contentRevision}
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

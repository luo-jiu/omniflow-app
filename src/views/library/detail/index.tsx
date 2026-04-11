import AppMain from "@/components/business/app-main";
import { DirectorySidebar } from "@/features/file-explorer";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileViewerProvider } from "@/contexts/FileViewerContext";
import { useFileViewer } from "@/hooks/useFileViewer";
import {
  IconHome,
  IconUpload,
  IconDelete,
  IconRefresh,
  IconPlus,
  IconClose,
  IconArrowLeft,
  IconArrowRight,
  IconGlobeStroke,
  IconApps,
} from "@douyinfe/semi-icons";
import styled, { css } from "styled-components";
import EmbeddedBrowserPanel, { type EmbeddedBrowserHandle } from "@/features/embedded-browser/components/EmbeddedBrowserPanel";

const DEFAULT_SIDE_PANEL_WIDTH = 300;
const MIN_SIDE_PANEL_WIDTH = 220;
const SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT = 37;
const SIDE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:side-panel-width:';

function getSidePanelWidthStorageKey(libraryId: number) {
  return `${SIDE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

function loadSidePanelWidth(libraryId: number): number {
  const raw = localStorage.getItem(getSidePanelWidthStorageKey(libraryId));
  if (!raw) return DEFAULT_SIDE_PANEL_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDE_PANEL_WIDTH;
  return Math.max(MIN_SIDE_PANEL_WIDTH, Math.floor(parsed));
}

function saveSidePanelWidth(libraryId: number, width: number) {
  localStorage.setItem(getSidePanelWidthStorageKey(libraryId), String(Math.floor(width)));
}

const DetailWrapper = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

const SidePanel = styled.div`
  position: relative;
  width: ${DEFAULT_SIDE_PANEL_WIDTH}px;
  min-width: ${MIN_SIDE_PANEL_WIDTH}px;
  max-width: 80vw;
  display: flex;
  flex-direction: column;
  background: var(--app-bg-sidebar);
  flex-shrink: 0;
  height: 100%;

  body[theme-mode="dark"] & {
    background: var(--app-bg-sidebar);
  }
`;

const ResizeHandle = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
`;

const SidePanelHeader = styled.div`
  height: ${SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT}px;
  min-height: ${SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT}px;
  padding: 0 16px;
  padding-left: 80px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: var(--app-bg-sidebar);
  -webkit-app-region: drag;
  flex-shrink: 0;
  position: relative;
  z-index: 2;

  h1 {
    -webkit-app-region: no-drag;
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text);
    margin: 0;
  }
`;

const SidePanelTree = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px 10px 6px;

  *::-webkit-scrollbar {
    height: 6px;
    width: 6px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
    border-radius: 10px;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.2);
  }
  *::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

const SidePanelFooter = styled.div`
  padding: 10px 14px;
  border-top: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  .footer-left {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--app-text-muted);
    background: transparent;
    border: none;

    &:hover {
      background: rgba(0, 0, 0, 0.05);
      color: var(--app-text);
    }
  }
`;

const ContentArea = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  border-top-left-radius: 12px;
  border-bottom-left-radius: 12px;
`;

const toolbarActionButtonStyles = css`
  .toolbar-action-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }

  .toolbar-action-btn .semi-icon {
    font-size: 16px;
  }

  .toolbar-action-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }

  .toolbar-action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const toolbarBackButtonStyles = css`
  .toolbar-back-btn {
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    -webkit-app-region: no-drag;
  }

  .toolbar-back-btn .semi-icon {
    font-size: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .toolbar-back-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }
`;

const ContentToolbar = styled.div`
  height: 38px;
  flex-shrink: 0;
  background: var(--app-bg);
  border-bottom: 1px solid var(--app-border);
  border-top-left-radius: 12px;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  padding: 0 8px;

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    -webkit-app-region: no-drag;
  }

  .toolbar-spacer {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }

  .toolbar-browser-form {
    width: 100%;
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }

  .toolbar-browser-input {
    width: 100%;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 10px;
    outline: none;
    font-size: 13px;
  }

  .toolbar-browser-input:focus {
    border-color: var(--semi-color-primary);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 6px;
    -webkit-app-region: no-drag;
  }
  ${toolbarBackButtonStyles}
  ${toolbarActionButtonStyles}
`;

const BrowserTabsRow = styled.div`
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
  overflow: hidden;
  -webkit-app-region: drag;

  .browser-tabs-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .browser-tabs-list::-webkit-scrollbar {
    display: none;
  }

  .browser-tabs-list > .toolbar-action-btn {
    flex-shrink: 0;
  }

  .browser-tab-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .browser-tab-btn {
    min-width: 140px;
    max-width: 260px;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .browser-tab-btn.active {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
    color: var(--app-text);
  }

  .browser-tab-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    text-align: left;
  }

  .browser-tab-close {
    width: 20px;
    height: 20px;
    margin-left: auto;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .browser-tab-close:hover {
    color: var(--app-text);
  }

  ${toolbarBackButtonStyles}
  ${toolbarActionButtonStyles}
`;

const ContentBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  -webkit-app-region: no-drag;

  & > * {
    flex: 1;
    min-height: 0;
  }
`;

type BrowserTab = {
  canGoBack?: boolean;
  canGoForward?: boolean;
  id: string;
  title: string;
  url: string;
};

function createBrowserTabId() {
  return `browser-tab:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createBrowserTab(): BrowserTab {
  return {
    canGoBack: false,
    canGoForward: false,
    id: createBrowserTabId(),
    title: '新标签页',
    url: '',
  };
}

function updateBrowserTabList(
  tabs: BrowserTab[],
  tabId: string,
  updater: (tab: BrowserTab) => BrowserTab,
) {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
}

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { setFileUrl, tabs, activeTabId, fileState, reloadActiveTab } = useFileViewer();
  const navigate = useNavigate();
  const sidePanelRef = React.useRef<HTMLDivElement>(null);
  const browserRef = React.useRef<EmbeddedBrowserHandle | null>(null);
  const [sidePanelWidth, setSidePanelWidth] = React.useState<number>(() => loadSidePanelWidth(libraryId));
  const [browserModeOpen, setBrowserModeOpen] = React.useState(false);
  const [browserTabs, setBrowserTabs] = React.useState<BrowserTab[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = React.useState<string | null>(null);
  const [browserInput, setBrowserInput] = React.useState('');
  const browserInputRef = React.useRef<HTMLInputElement | null>(null);
  const latestPanelWidthRef = React.useRef<number>(sidePanelWidth);
  const resizeMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const resizeUpHandlerRef = React.useRef<(() => void) | null>(null);

  const cleanupResizeListeners = React.useCallback(() => {
    if (resizeMoveHandlerRef.current) {
      document.removeEventListener("mousemove", resizeMoveHandlerRef.current);
      resizeMoveHandlerRef.current = null;
    }
    if (resizeUpHandlerRef.current) {
      document.removeEventListener("mouseup", resizeUpHandlerRef.current);
      resizeUpHandlerRef.current = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  React.useEffect(() => {
    const restored = loadSidePanelWidth(libraryId);
    latestPanelWidthRef.current = restored;
    setSidePanelWidth(restored);
  }, [libraryId]);

  React.useEffect(() => {
    return () => {
      cleanupResizeListeners();
    };
  }, [cleanupResizeListeners]);

  const handleResizeMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    cleanupResizeListeners();
    const startX = e.clientX;
    const startWidth = sidePanelRef.current?.offsetWidth || sidePanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!sidePanelRef.current) return;
      const maxWidth = Math.floor(window.innerWidth * 0.8);
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, MIN_SIDE_PANEL_WIDTH), maxWidth);
      sidePanelRef.current.style.width = `${newWidth}px`;
      latestPanelWidthRef.current = newWidth;
    };

    const onMouseUp = () => {
      const finalWidth = Math.floor(latestPanelWidthRef.current);
      setSidePanelWidth(finalWidth);
      saveSidePanelWidth(libraryId, finalWidth);
      cleanupResizeListeners();
    };

    resizeMoveHandlerRef.current = onMouseMove;
    resizeUpHandlerRef.current = onMouseUp;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [cleanupResizeListeners, libraryId, sidePanelWidth]);

  const handleFileOpen = async (
    fileUrl: string,
    fileName: string,
    fileType: "image" | "video" | "audio" | "pdf" | "comic" | "asmr" | "asmr_archive" | "comic_archive" | "other",
    nodeId: number,
    options?: {
      tabTypeLabel?: string | null;
      returnTarget?: {
        fileUrl: string;
        fileName: string | null;
        fileType: 'image' | 'video' | 'audio' | 'pdf' | 'comic' | 'asmr' | 'asmr_archive' | 'comic_archive' | 'other';
        nodeId: number | null;
        tabTypeLabel?: string | null;
      } | null;
    },
  ) => {
    setBrowserModeOpen(false);
    void window.electronEmbeddedBrowser.deactivate();
    setFileUrl(fileUrl, fileName, fileType, nodeId, options);
  };

  const activeTab = React.useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find(tab => tab.id === activeTabId) || null;
  }, [activeTabId, tabs]);

  const archiveReturnTarget = activeTab?.returnTarget ?? null;
  const showBackToArchive = (
    (fileState.fileType === 'asmr' && archiveReturnTarget?.fileType === 'asmr_archive')
    || (fileState.fileType === 'comic' && archiveReturnTarget?.fileType === 'comic_archive')
  );

  const handleArchiveReturn = React.useCallback(() => {
    if (!archiveReturnTarget) {
      return;
    }
    setFileUrl(
      archiveReturnTarget.fileUrl,
      archiveReturnTarget.fileName,
      archiveReturnTarget.fileType,
      archiveReturnTarget.nodeId,
      { tabTypeLabel: archiveReturnTarget.tabTypeLabel ?? null },
    );
  }, [archiveReturnTarget, setFileUrl]);

  const normalizeBrowserUrl = React.useCallback((input: string) => {
    const trimmed = String(input || '').trim();
    if (!trimmed) {
      return '';
    }
    if (!/\s/.test(trimmed) && /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return trimmed;
    }
    if (!/\s/.test(trimmed) && /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([/?#].*)?$/i.test(trimmed)) {
      return `http://${trimmed}`;
    }
    if (!/\s/.test(trimmed) && /^[^\s]+\.[^\s]+/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }, []);

  const applyBrowserTabUpdate = React.useCallback((tabId: string, updater: (tab: BrowserTab) => BrowserTab) => {
    setBrowserTabs((prev) => updateBrowserTabList(prev, tabId, updater));
  }, []);

  const applyBrowserTabState = React.useCallback((payload: {
    canGoBack?: boolean;
    canGoForward?: boolean;
    tabId: string;
    title?: string;
    url?: string;
  }) => {
    applyBrowserTabUpdate(payload.tabId, (tab) => ({
      ...tab,
      canGoBack: payload.canGoBack ?? tab.canGoBack,
      canGoForward: payload.canGoForward ?? tab.canGoForward,
      title: payload.title || tab.title || tab.url || '新标签页',
      url: payload.url ?? tab.url,
    }));
  }, [applyBrowserTabUpdate]);

  const syncBrowserInputWithTab = React.useCallback((tabId: string | null, nextUrl: string) => {
    if (!tabId || tabId !== activeBrowserTabId) {
      return;
    }
    setBrowserInput(nextUrl);
  }, [activeBrowserTabId]);

  const createAndActivateBrowserTab = React.useCallback(() => {
    const nextTab = createBrowserTab();
    setBrowserTabs((prev) => [...prev, nextTab]);
    setActiveBrowserTabId(nextTab.id);
    setBrowserModeOpen(true);
    setBrowserInput('');
    void window.electronEmbeddedBrowser.openTab(nextTab.id);
  }, []);

  const openEmbeddedBrowser = React.useCallback(() => {
    if (browserTabs.length > 0) {
      const fallbackTabId = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
      setBrowserModeOpen(true);
      setActiveBrowserTabId(fallbackTabId);
      const fallbackTab = browserTabs.find((tab) => tab.id === fallbackTabId) ?? null;
      setBrowserInput(fallbackTab?.url ?? '');
      return;
    }
    createAndActivateBrowserTab();
  }, [activeBrowserTabId, browserTabs, createAndActivateBrowserTab]);

  const activateBrowserTab = React.useCallback((tabId: string) => {
    setActiveBrowserTabId(tabId);
    setBrowserModeOpen(true);
    const targetTab = browserTabs.find((tab) => tab.id === tabId) ?? null;
    setBrowserInput(targetTab?.url ?? '');
    void window.electronEmbeddedBrowser.activateTab(tabId);
  }, [browserTabs]);

  const closeBrowserTab = React.useCallback((tabId: string) => {
    const nextTabs = browserTabs.filter((tab) => tab.id !== tabId);
    const closingActive = activeBrowserTabId === tabId;
    setBrowserTabs(nextTabs);
    if (closingActive) {
      const fallback = nextTabs[nextTabs.length - 1] ?? null;
      setActiveBrowserTabId(fallback?.id ?? null);
      setBrowserInput(fallback?.url ?? '');
      setBrowserModeOpen(nextTabs.length > 0);
      if (fallback) {
        void window.electronEmbeddedBrowser.activateTab(fallback.id);
      } else {
        void window.electronEmbeddedBrowser.deactivate();
      }
    }
    void window.electronEmbeddedBrowser.closeTab(tabId);
  }, [activeBrowserTabId, browserTabs]);

  const closeEmbeddedBrowserMode = React.useCallback(() => {
    setBrowserModeOpen(false);
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const submitBrowserInput = React.useCallback((rawValue: string) => {
    if (!activeBrowserTabId) {
      return;
    }
    const nextUrl = normalizeBrowserUrl(rawValue);
    if (!nextUrl) {
      return;
    }
    setBrowserInput(nextUrl);
    setBrowserModeOpen(true);
    applyBrowserTabUpdate(activeBrowserTabId, (tab) => ({
      ...tab,
      url: nextUrl,
      title: tab.title || nextUrl,
    }));
    browserRef.current?.navigate(activeBrowserTabId, nextUrl);
  }, [activeBrowserTabId, applyBrowserTabUpdate, normalizeBrowserUrl]);

  const handleBrowserSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    submitBrowserInput(browserInput);
  }, [browserInput, submitBrowserInput]);

  const submitBrowserDraft = React.useCallback((draftValue: string) => {
    submitBrowserInput(draftValue);
  }, [submitBrowserInput]);

  const handleToolbarRefresh = React.useCallback(() => {
    if (browserModeOpen) {
      browserRef.current?.reload();
      return;
    }
    reloadActiveTab();
  }, [browserModeOpen, reloadActiveTab]);

  const handleBrowserBack = React.useCallback(() => {
    if (!activeBrowserTabId) {
      return;
    }
    void window.electronEmbeddedBrowser.goBack(activeBrowserTabId);
  }, [activeBrowserTabId]);

  const handleBrowserForward = React.useCallback(() => {
    if (!activeBrowserTabId) {
      return;
    }
    void window.electronEmbeddedBrowser.goForward(activeBrowserTabId);
  }, [activeBrowserTabId]);

  const activeBrowserTab = React.useMemo(() => {
    if (!activeBrowserTabId) {
      return null;
    }
    return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
  }, [activeBrowserTabId, browserTabs]);

  React.useEffect(() => {
    if (!browserModeOpen) {
      return;
    }
    if (!activeBrowserTab?.url) {
      return;
    }
    window.requestAnimationFrame(() => {
      browserInputRef.current?.focus();
      browserInputRef.current?.select();
    });
  }, [activeBrowserTab, browserModeOpen]);

  React.useEffect(() => {
    return () => {
      void window.electronEmbeddedBrowser.closeAll();
    };
  }, []);

  return (
    <DetailWrapper>
      <SidePanel ref={sidePanelRef} style={{ width: `${sidePanelWidth}px` }}>
        <SidePanelHeader />

        <SidePanelTree>
          <DirectorySidebar libraryId={libraryId} onFileOpen={handleFileOpen} />
        </SidePanelTree>

        <SidePanelFooter>
          <div className="footer-left">
            <button
              className="footer-btn"
              onClick={() => navigate("/libraries")}
              title="返回库列表"
            >
              <IconHome size="large" />
            </button>
            <button
              className="footer-btn"
              onClick={() => navigate("/upload-center")}
              title="上传中心"
            >
              <IconUpload size="large" />
            </button>
            <button
              className="footer-btn"
              onClick={() => navigate(`/libraries/${libraryId}/recycle-bin`)}
              title="回收站"
            >
              <IconDelete size="large" />
            </button>
          </div>

        </SidePanelFooter>
        <ResizeHandle onMouseDown={handleResizeMouseDown} />
      </SidePanel>

      <ContentArea>
        {browserModeOpen ? (
          <>
            <BrowserTabsRow>
              <div className="browser-tab-actions">
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={closeEmbeddedBrowserMode}
                  title="返回工作区"
                >
                  <IconApps />
                </button>
              </div>
              <div className="browser-tabs-list">
                {browserTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`browser-tab-btn ${tab.id === activeBrowserTabId ? 'active' : ''}`}
                    onClick={() => activateBrowserTab(tab.id)}
                  >
                    <span className="browser-tab-title">{tab.title || tab.url || '新标签页'}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="browser-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeBrowserTab(tab.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          closeBrowserTab(tab.id);
                        }
                      }}
                    >
                      <IconClose />
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={createAndActivateBrowserTab}
                  title="新建浏览器标签"
                >
                  <IconPlus />
                </button>
              </div>
            </BrowserTabsRow>
            <ContentToolbar>
              <div className="toolbar-left">
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={handleBrowserBack}
                  title="后退"
                  disabled={!activeBrowserTab?.canGoBack}
                >
                  <IconArrowLeft />
                </button>
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={handleBrowserForward}
                  title="前进"
                  disabled={!activeBrowserTab?.canGoForward}
                >
                  <IconArrowRight />
                </button>
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={handleToolbarRefresh}
                  title="刷新网页"
                >
                  <IconRefresh />
                </button>
              </div>
              <div className="toolbar-spacer">
                <form className="toolbar-browser-form" onSubmit={handleBrowserSubmit}>
                  <input
                    ref={browserInputRef}
                    className="toolbar-browser-input"
                    value={browserInput}
                    onChange={(event) => setBrowserInput(event.target.value)}
                    placeholder="输入网址后回车"
                  />
                </form>
              </div>
              <div className="toolbar-right" />
            </ContentToolbar>
          </>
        ) : (
          <ContentToolbar>
          <div className="toolbar-left">
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={handleArchiveReturn}
              title={showBackToArchive && archiveReturnTarget ? "返回上一级" : "当前无可返回内容"}
              disabled={!showBackToArchive || !archiveReturnTarget}
            >
              <IconArrowLeft />
            </button>
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={openEmbeddedBrowser}
              title="打开内置浏览器"
            >
              <IconGlobeStroke />
            </button>
          </div>
          <div className="toolbar-spacer" />
          <div className="toolbar-right">
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={handleToolbarRefresh}
              title="刷新当前标签页"
              disabled={!activeTabId}
            >
              <IconRefresh />
            </button>
          </div>
          </ContentToolbar>
        )}
        <ContentBody>
          {browserModeOpen ? (
            <EmbeddedBrowserPanel
              ref={browserRef}
              activeTabId={activeBrowserTabId}
              currentUrl={
                activeBrowserTab?.url ?? ''
              }
              onUrlChange={(nextUrl) => {
                if (!activeBrowserTabId) {
                  return;
                }
                applyBrowserTabUpdate(activeBrowserTabId, (tab) => ({
                  ...tab,
                  url: nextUrl,
                  title: tab.title || nextUrl,
                }));
                syncBrowserInputWithTab(activeBrowserTabId, nextUrl);
              }}
              onStateChange={(payload) => {
                if (!payload.tabId) {
                  return;
                }
                applyBrowserTabState({
                  ...payload,
                  tabId: payload.tabId,
                });
                if (payload.tabId === activeBrowserTabId && payload.url) {
                  setBrowserInput(payload.url);
                }
              }}
              onSubmitDraft={submitBrowserDraft}
            />
          ) : (
            <AppMain hideTabsBar={false} />
          )}
        </ContentBody>
      </ContentArea>
    </DetailWrapper>
  );
};

const LibraryDetail: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const cacheKey = `library:${id}`;

  return (
    <FileViewerProvider key={cacheKey} cacheKey={cacheKey}>
      <LibraryDetailContent key={id} libraryId={libraryId} />
    </FileViewerProvider>
  );
};

export default LibraryDetail;

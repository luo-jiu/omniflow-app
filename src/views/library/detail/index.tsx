import AppMain from "@/components/business/app-main";
import { DirectorySidebar, type DirectorySidebarHandle } from "@/features/file-explorer";
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
  IconFolder,
} from "@douyinfe/semi-icons";
import styled, { css } from "styled-components";
import EmbeddedBrowserPanel, { type EmbeddedBrowserHandle } from "@/features/embedded-browser/components/EmbeddedBrowserPanel";
import EmbeddedBrowserDownloadImportModal from "@/features/embedded-browser/downloads/components/EmbeddedBrowserDownloadImportModal";
import { useEmbeddedBrowserDownloadImport } from "@/features/embedded-browser/downloads/hooks/useEmbeddedBrowserDownloadImport";
import SearchWorkspace, { type SearchWorkspaceMode } from "./SearchWorkspace";
import {
  loadLibraryDetailWorkspaceState,
  saveLibraryDetailWorkspaceState,
  type BrowserTab,
  type LibraryDetailWorkspaceState,
  type WorkspaceDisplayMode,
} from "./workspace-state";

const DEFAULT_SIDE_PANEL_WIDTH = 300;
const MIN_SIDE_PANEL_WIDTH = 220;
const SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT = 37;
const SIDE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:side-panel-width:';
const CONTENT_TOOLBAR_HEIGHT = 46;
const TOOLBAR_ACTION_BUTTON_SIZE = 36;
const TOOLBAR_ACTION_ICON_SIZE = 18;
const BROWSER_TAB_HEIGHT = 36;
const BROWSER_INPUT_HEIGHT = 34;

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
  background: var(--app-bg);
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
    background: var(--app-scrollbar-track);
  }
  *::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
    border-radius: 10px;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
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
    width: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
    height: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
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
    font-size: ${TOOLBAR_ACTION_ICON_SIZE}px;
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
    height: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
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
    font-size: ${TOOLBAR_ACTION_ICON_SIZE}px;
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
  height: ${CONTENT_TOOLBAR_HEIGHT}px;
  flex-shrink: 0;
  background: var(--app-bg);
  border-bottom: 1px solid var(--app-border);
  border-top-left-radius: 12px;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  padding: 0 10px;

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
  }

  .toolbar-spacer {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .browser-tabs-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .browser-tabs-list.scroll-mode {
    -webkit-app-region: no-drag;
  }

  .browser-tabs-list::-webkit-scrollbar {
    display: none;
  }

  .browser-tab-btn {
    min-width: 140px;
    max-width: 260px;
    height: ${BROWSER_TAB_HEIGHT}px;
    padding: 0 13px;
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

  .browser-tab-btn.dragging {
    opacity: 0.64;
  }

  .browser-tab-btn.drop-before {
    box-shadow: inset 2px 0 0 var(--semi-color-primary);
  }

  .browser-tab-btn.drop-after {
    box-shadow: inset -2px 0 0 var(--semi-color-primary);
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
    width: 22px;
    height: 22px;
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

  .toolbar-browser-form {
    width: 100%;
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }

  .toolbar-browser-input {
    width: 100%;
    height: ${BROWSER_INPUT_HEIGHT}px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 12px;
    outline: none;
    font-size: 14px;
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

function reorderBrowserTabs(
  tabs: BrowserTab[],
  draggedTabId: string,
  targetTabId: string,
  position: 'before' | 'after',
) {
  if (draggedTabId === targetTabId) {
    return tabs;
  }

  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  const adjustedTargetIndex = nextTabs.findIndex((tab) => tab.id === targetTabId);
  if (adjustedTargetIndex < 0) {
    return tabs;
  }
  const insertIndex = position === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  nextTabs.splice(insertIndex, 0, draggedTab);
  return nextTabs;
}

function createEmptyBrowserTab() {
  const nextTab = createBrowserTab();
  return {
    id: nextTab.id,
    tab: nextTab,
  };
}

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { setFileUrl, tabs, activeTabId, fileState, reloadActiveTab } = useFileViewer();
  const navigate = useNavigate();
  const sidePanelRef = React.useRef<HTMLDivElement>(null);
  const directorySidebarRef = React.useRef<DirectorySidebarHandle | null>(null);
  const handleBrowserDownloadImportSuccess = React.useCallback(async ({ targetFolder }: { targetFolder: { id: number } }) => {
    await directorySidebarRef.current?.refreshNodeSubtree(targetFolder.id);
  }, []);
  const {
    activeDownload: activeBrowserDownload,
    closeActiveDownload,
    importActiveDownload,
    importLoading: importingBrowserDownload,
  } = useEmbeddedBrowserDownloadImport(libraryId, {
    onImportSuccess: handleBrowserDownloadImportSuccess,
  });
  const workspaceCacheKey = React.useMemo(() => `library:${libraryId}`, [libraryId]);
  const initialWorkspaceState = React.useMemo(
    () => loadLibraryDetailWorkspaceState(workspaceCacheKey),
    [workspaceCacheKey],
  );
  const browserRef = React.useRef<EmbeddedBrowserHandle | null>(null);
  const browserTabsListRef = React.useRef<HTMLDivElement | null>(null);
  const browserTabButtonRefMap = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingBrowserTabDragRef = React.useRef<{ started: boolean; tabId: string } | null>(null);
  const browserTabMouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const browserTabMouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const browserTabClickBlockUntilRef = React.useRef(0);
  const previousActiveBrowserTabIdRef = React.useRef<string | null>(null);
  const previousBrowserTabCountRef = React.useRef(0);
  const [sidePanelWidth, setSidePanelWidth] = React.useState<number>(() => loadSidePanelWidth(libraryId));
  const [browserModeOpen, setBrowserModeOpen] = React.useState(initialWorkspaceState.browserModeOpen);
  const [browserTabs, setBrowserTabs] = React.useState<BrowserTab[]>(initialWorkspaceState.browserTabs);
  const [activeBrowserTabId, setActiveBrowserTabId] = React.useState<string | null>(initialWorkspaceState.activeBrowserTabId);
  const [draggingBrowserTabId, setDraggingBrowserTabId] = React.useState<string | null>(null);
  const [browserTabsScrollMode, setBrowserTabsScrollMode] = React.useState(false);
  const [browserTabDropTarget, setBrowserTabDropTarget] = React.useState<{
    position: 'before' | 'after';
    tabId: string;
  } | null>(null);
  const [browserInput, setBrowserInput] = React.useState(initialWorkspaceState.browserInput);
  const [searchMode, setSearchMode] = React.useState<SearchWorkspaceMode>(initialWorkspaceState.searchMode);
  const [searchDraft, setSearchDraft] = React.useState(initialWorkspaceState.searchDraft);
  const [workspaceDisplayMode, setWorkspaceDisplayMode] = React.useState<WorkspaceDisplayMode>(initialWorkspaceState.workspaceDisplayMode);
  const browserInputRef = React.useRef<HTMLInputElement | null>(null);
  const latestWorkspaceStateRef = React.useRef<LibraryDetailWorkspaceState>(initialWorkspaceState);
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
    setWorkspaceDisplayMode('file-viewer');
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

  const showSearchHome = React.useCallback((nextMode?: SearchWorkspaceMode) => {
    setBrowserModeOpen(false);
    if (nextMode) {
      setSearchMode(nextMode);
    }
    setWorkspaceDisplayMode('search-home');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

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
    const next = createEmptyBrowserTab();
    setBrowserTabs((prev) => [...prev, next.tab]);
    setActiveBrowserTabId(next.id);
    setBrowserModeOpen(true);
    setWorkspaceDisplayMode('browser');
    setBrowserInput('');
    setSearchMode('web');
    void window.electronEmbeddedBrowser.openTab(next.id);
    return next.id;
  }, []);

  const openEmbeddedBrowser = React.useCallback(() => {
    if (browserTabs.length > 0) {
      const fallbackTabId = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
      setBrowserModeOpen(true);
      setWorkspaceDisplayMode('browser');
      setActiveBrowserTabId(fallbackTabId);
      const fallbackTab = browserTabs.find((tab) => tab.id === fallbackTabId) ?? null;
      setBrowserInput(fallbackTab?.url ?? '');
      return;
    }
    createAndActivateBrowserTab();
  }, [activeBrowserTabId, browserTabs, createAndActivateBrowserTab]);

  const openFileWorkspace = React.useCallback(() => {
    setBrowserModeOpen(false);
    void window.electronEmbeddedBrowser.deactivate();
    if (activeTabId) {
      setWorkspaceDisplayMode('file-viewer');
      return;
    }
    showSearchHome('files');
  }, [activeTabId, showSearchHome]);

  const activateBrowserTab = React.useCallback((tabId: string) => {
    setActiveBrowserTabId(tabId);
    setBrowserModeOpen(true);
    setWorkspaceDisplayMode('browser');
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

  const reorderBrowserTabList = React.useCallback((
    draggedTabId: string,
    targetTabId: string,
    position: 'before' | 'after',
  ) => {
    setBrowserTabs((prev) => reorderBrowserTabs(prev, draggedTabId, targetTabId, position));
  }, []);

  const submitBrowserInput = React.useCallback((rawValue: string, targetTabId?: string | null) => {
    const resolvedTabId = targetTabId ?? activeBrowserTabId;
    if (!resolvedTabId) {
      return;
    }
    const nextUrl = normalizeBrowserUrl(rawValue);
    if (!nextUrl) {
      return;
    }
    setBrowserInput(nextUrl);
    setBrowserModeOpen(true);
    setWorkspaceDisplayMode('browser');
    applyBrowserTabUpdate(resolvedTabId, (tab) => ({
      ...tab,
      url: nextUrl,
      title: tab.title || nextUrl,
    }));
    browserRef.current?.navigate(resolvedTabId, nextUrl);
  }, [activeBrowserTabId, applyBrowserTabUpdate, normalizeBrowserUrl]);

  const handleSearchWorkspaceSubmit = React.useCallback(async (rawValue: string) => {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) {
      return;
    }
    if (searchMode === 'web') {
      setBrowserInput(trimmed);
      setSearchDraft(trimmed);
      const existingTabId = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
      const targetTabId = existingTabId ?? createAndActivateBrowserTab();
      setBrowserModeOpen(true);
      setWorkspaceDisplayMode('browser');
      if (targetTabId) {
        setActiveBrowserTabId(targetTabId);
        window.requestAnimationFrame(() => {
          submitBrowserInput(trimmed, targetTabId);
        });
      }
      return;
    }
    setSearchDraft(trimmed);
  }, [
    activeBrowserTabId,
    browserTabs,
    createAndActivateBrowserTab,
    searchMode,
    submitBrowserInput,
  ]);

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

  const detachBrowserTabDragListeners = React.useCallback(() => {
    if (browserTabMouseMoveListenerRef.current) {
      window.removeEventListener('mousemove', browserTabMouseMoveListenerRef.current);
      browserTabMouseMoveListenerRef.current = null;
    }
    if (browserTabMouseUpListenerRef.current) {
      window.removeEventListener('mouseup', browserTabMouseUpListenerRef.current);
      browserTabMouseUpListenerRef.current = null;
    }
  }, []);

  const clearBrowserTabDragState = React.useCallback(() => {
    pendingBrowserTabDragRef.current = null;
    setDraggingBrowserTabId(null);
    setBrowserTabDropTarget(null);
    detachBrowserTabDragListeners();
  }, [detachBrowserTabDragListeners]);

  const resolveBrowserTabDropTarget = React.useCallback((
    clientX: number,
    draggedTabId: string,
  ): { position: 'before' | 'after'; tabId: string } | null => {
    const candidateTabs = browserTabs.filter((tab) => tab.id !== draggedTabId);
    if (candidateTabs.length === 0) {
      return null;
    }

    let nearest: { distance: number; position: 'before' | 'after'; tabId: string } | null = null;
    for (const tab of candidateTabs) {
      const button = browserTabButtonRefMap.current.get(tab.id);
      if (!button) {
        continue;
      }
      const rect = button.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const position: 'before' | 'after' = clientX < midpoint ? 'before' : 'after';
      const distance = clientX >= rect.left && clientX <= rect.right
        ? Math.abs(clientX - midpoint) * 0.5
        : Math.min(Math.abs(clientX - rect.left), Math.abs(clientX - rect.right)) + rect.width / 2;
      if (!nearest || distance < nearest.distance) {
        nearest = { distance, position, tabId: tab.id };
      }
    }

    return nearest ? { tabId: nearest.tabId, position: nearest.position } : null;
  }, [browserTabs]);

  const handleBrowserTabsWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) {
      return;
    }
    const container = browserTabsListRef.current;
    if (!container) {
      return;
    }
    if (container.scrollWidth <= container.clientWidth + 1) {
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) {
      return;
    }
    event.preventDefault();
    container.scrollLeft += delta;
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setBrowserTabsScrollMode(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setBrowserTabsScrollMode(false);
      }
    };
    const handleWindowBlur = () => {
      setBrowserTabsScrollMode(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

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
    if (!browserModeOpen || !activeBrowserTabId) {
      previousActiveBrowserTabIdRef.current = activeBrowserTabId;
      previousBrowserTabCountRef.current = browserTabs.length;
      return;
    }
    const activeTabChanged = previousActiveBrowserTabIdRef.current !== activeBrowserTabId;
    const tabCountIncreased = browserTabs.length > previousBrowserTabCountRef.current;
    previousActiveBrowserTabIdRef.current = activeBrowserTabId;
    previousBrowserTabCountRef.current = browserTabs.length;
    if (!activeTabChanged && !tabCountIncreased) {
      return;
    }
    const button = browserTabButtonRefMap.current.get(activeBrowserTabId);
    if (!button) {
      return;
    }
    window.requestAnimationFrame(() => {
      button.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }, [activeBrowserTabId, browserModeOpen, browserTabs.length]);

  React.useEffect(() => {
    if (browserModeOpen) {
      return;
    }
    if (workspaceDisplayMode === 'browser') {
      setWorkspaceDisplayMode(activeTabId ? 'file-viewer' : 'search-home');
    }
  }, [activeTabId, browserModeOpen, workspaceDisplayMode]);

  React.useEffect(() => {
    const nextWorkspaceState: LibraryDetailWorkspaceState = {
      activeBrowserTabId,
      browserInput,
      browserModeOpen,
      browserTabs,
      searchDraft,
      searchMode,
      workspaceDisplayMode,
    };
    latestWorkspaceStateRef.current = nextWorkspaceState;
    saveLibraryDetailWorkspaceState(workspaceCacheKey, nextWorkspaceState);
  }, [
    activeBrowserTabId,
    browserInput,
    browserModeOpen,
    browserTabs,
    searchDraft,
    searchMode,
    workspaceCacheKey,
    workspaceDisplayMode,
  ]);

  React.useEffect(() => {
    return () => {
      clearBrowserTabDragState();
      saveLibraryDetailWorkspaceState(workspaceCacheKey, latestWorkspaceStateRef.current);
      void window.electronEmbeddedBrowser.deactivate();
    };
  }, [clearBrowserTabDragState, workspaceCacheKey]);

  return (
    <DetailWrapper>
      <SidePanel ref={sidePanelRef} style={{ width: `${sidePanelWidth}px` }}>
        <SidePanelHeader />

        <SidePanelTree>
          <DirectorySidebar ref={directorySidebarRef} libraryId={libraryId} onFileOpen={handleFileOpen} />
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
        <ContentToolbar>
          <div className="toolbar-left">
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={() => showSearchHome()}
              title="打开搜索主页"
            >
              <IconApps />
            </button>
            {browserModeOpen ? (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={openFileWorkspace}
                title="打开文件模式"
              >
                <IconFolder />
              </button>
            ) : workspaceDisplayMode === 'file-viewer' && showBackToArchive && archiveReturnTarget ? (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={handleArchiveReturn}
                title="返回上一级"
              >
                <IconArrowLeft />
              </button>
            ) : (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={openFileWorkspace}
                title="打开文件模式"
              >
                <IconFolder />
              </button>
            )}
            {!browserModeOpen ? (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={openEmbeddedBrowser}
                title="打开内置浏览器"
              >
                <IconGlobeStroke />
              </button>
            ) : null}
          </div>
          <div className="toolbar-spacer">
            {browserModeOpen ? (
              <div
                ref={browserTabsListRef}
                className={`browser-tabs-list ${browserTabsScrollMode ? 'scroll-mode' : ''}`}
                onWheelCapture={handleBrowserTabsWheel}
              >
                {browserTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`browser-tab-btn ${tab.id === activeBrowserTabId ? 'active' : ''}${draggingBrowserTabId === tab.id ? ' dragging' : ''}${browserTabDropTarget?.tabId === tab.id && browserTabDropTarget.position === 'before' && draggingBrowserTabId !== tab.id ? ' drop-before' : ''}${browserTabDropTarget?.tabId === tab.id && browserTabDropTarget.position === 'after' && draggingBrowserTabId !== tab.id ? ' drop-after' : ''}`}
                    ref={(element) => {
                      if (element) {
                        browserTabButtonRefMap.current.set(tab.id, element);
                      } else {
                        browserTabButtonRefMap.current.delete(tab.id);
                      }
                    }}
                    onMouseDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      pendingBrowserTabDragRef.current = {
                        started: false,
                        tabId: tab.id,
                      };
                      setBrowserTabDropTarget(null);
                      detachBrowserTabDragListeners();

                      const handleMouseMove = (moveEvent: MouseEvent) => {
                        const pending = pendingBrowserTabDragRef.current;
                        if (!pending || pending.tabId !== tab.id) {
                          return;
                        }
                        if (!pending.started) {
                          if (Math.abs(moveEvent.clientX - event.clientX) < 6) {
                            return;
                          }
                          pending.started = true;
                          setDraggingBrowserTabId(tab.id);
                          browserTabClickBlockUntilRef.current = Date.now() + 180;
                        }
                        setBrowserTabDropTarget(resolveBrowserTabDropTarget(moveEvent.clientX, tab.id));
                      };

                      const handleMouseUp = (upEvent: MouseEvent) => {
                        const pending = pendingBrowserTabDragRef.current;
                        if (pending?.started) {
                          const finalDropTarget = resolveBrowserTabDropTarget(upEvent.clientX, tab.id);
                          if (finalDropTarget) {
                            reorderBrowserTabList(tab.id, finalDropTarget.tabId, finalDropTarget.position);
                          }
                        }
                        clearBrowserTabDragState();
                      };

                      browserTabMouseMoveListenerRef.current = handleMouseMove;
                      browserTabMouseUpListenerRef.current = handleMouseUp;
                      window.addEventListener('mousemove', handleMouseMove);
                      window.addEventListener('mouseup', handleMouseUp);
                    }}
                    onClick={() => {
                      if (Date.now() < browserTabClickBlockUntilRef.current) {
                        return;
                      }
                      activateBrowserTab(tab.id);
                    }}
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
                      onMouseDown={(event) => {
                        event.stopPropagation();
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
              </div>
            ) : null}
          </div>
          <div className="toolbar-right">
            {browserModeOpen ? (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={createAndActivateBrowserTab}
                title="新建浏览器标签"
              >
                <IconPlus />
              </button>
            ) : (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={handleToolbarRefresh}
                title="刷新当前标签页"
                disabled={!activeTabId}
              >
                <IconRefresh />
              </button>
            )}
          </div>
        </ContentToolbar>
        {browserModeOpen ? (
          <>
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
        ) : null}
        <ContentBody>
          {workspaceDisplayMode === 'browser' ? (
            <EmbeddedBrowserPanel
              ref={browserRef}
              activeTabId={activeBrowserTabId}
              currentUrl={
                activeBrowserTab?.url ?? ''
              }
              suspendNativeView={Boolean(activeBrowserDownload)}
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
          ) : workspaceDisplayMode === 'search-home' ? (
            <SearchWorkspace
              mode={searchMode}
              value={searchDraft}
              onValueChange={setSearchDraft}
              onModeChange={setSearchMode}
              onSubmit={handleSearchWorkspaceSubmit}
              placeholder={searchMode === 'web' ? '输入网址或关键词' : '搜索文件或文件夹'}
              title="Omniflow"
              description="输入网址或关键词开始"
            />
          ) : (
            <AppMain hideTabsBar={false} />
          )}
        </ContentBody>
      </ContentArea>
      <EmbeddedBrowserDownloadImportModal
        download={activeBrowserDownload}
        importLoading={importingBrowserDownload}
        libraryId={libraryId}
        onCancel={() => {
          void closeActiveDownload({ discardFile: true });
        }}
        onConfirm={(targetFolder) => {
          void importActiveDownload(targetFolder);
        }}
      />
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

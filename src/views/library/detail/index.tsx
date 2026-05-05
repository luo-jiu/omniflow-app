import AppMain from "@/components/business/app-main";
import {
  DirectorySidebar,
  type DirectorySidebarHandle,
  type SelectedTreeNode,
} from "@/features/file-explorer";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileViewerProvider } from "@/contexts/FileViewerContext";
import { LibraryWorkspaceControlsContext } from "@/contexts/library-workspace-controls.context";
import { MediaRegistryProvider } from "@/contexts/MediaRegistryContext";
import { useMediaEntries, useMediaRegistry } from "@/hooks/useMediaRegistry";
import MediaHubPopover from "@/components/business/media-hub-popover";
import { useFileViewer } from "@/hooks/useFileViewer";
import {
  IconHome,
  IconUpload,
  IconDelete,
  IconSetting,
  IconRefresh,
  IconPlus,
  IconClose,
  IconArrowLeft,
  IconArrowRight,
  IconGlobeStroke,
  IconApps,
  IconFolder,
  IconStar,
  IconStarStroked,
  IconMore,
  IconEdit,
  IconPulse,
  IconWrench,
  IconMusic,
} from "@douyinfe/semi-icons";
import { Input, Modal, Popover, Select, Toast } from '@douyinfe/semi-ui';
import ContextMenu, { type ContextMenuItem } from "@/components/ui/context-menu";
import EmbeddedBrowserPanel, { type EmbeddedBrowserHandle } from "@/features/embedded-browser/components/EmbeddedBrowserPanel";
import EmbeddedBrowserAutoFillBar from "@/features/embedded-browser/passwords/components/EmbeddedBrowserAutoFillBar";
import EmbeddedBrowserPasswordSaveBar from "@/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSaveBar";
import { subscribeCredentialAutoFilled, subscribeCredentialCaptured } from "@/features/embedded-browser/passwords/services/embedded-browser-password.api";
import EmbeddedBrowserDownloadImportModal from "@/features/embedded-browser/downloads/components/EmbeddedBrowserDownloadImportModal";
import { useEmbeddedBrowserDownloadImport } from "@/features/embedded-browser/downloads/hooks/useEmbeddedBrowserDownloadImport";
import EmbeddedBrowserResourcePanel from "@/features/embedded-browser/resources/components/EmbeddedBrowserResourcePanel";
import type { EmbeddedBrowserHlsDownloadPlan } from "@/features/embedded-browser/resources/model/embedded-browser-hls-manifest";
import type { EmbeddedBrowserHlsManifest } from "@/features/embedded-browser/resources/model/embedded-browser-hls-manifest";
import type { EmbeddedBrowserMpdDownloadPlan } from "@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest";
import type { EmbeddedBrowserMpdManifest } from "@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest";
import type { EmbeddedBrowserCapturedResource } from "@/features/embedded-browser/resources/types";
import type { ToolWorkspaceMediaRequest } from "@/features/tool-workspace/types";
import {
  createBrowserBookmark,
  deleteBrowserBookmark,
  fetchBrowserBookmarkTree,
  matchBrowserBookmark,
  moveBrowserBookmark,
  updateBrowserBookmark,
  type BrowserBookmarkItem,
  type BrowserBookmarkKind,
  type BrowserBookmarkMatchResult,
} from "@/features/embedded-browser/services/browser-bookmark.api";
import {
  buildBookmarkParentOptions,
  collectBookmarkFolderIds,
  collectURLBookmarkItems,
  getDefaultBookmarkTitle,
  getPersistableBookmarkIconUrl,
  isURLBookmark,
  replaceBookmarkIconInTree,
  resolveVisibleBookmarkCount,
  ROOT_BOOKMARK_PARENT_VALUE,
} from "@/features/embedded-browser/bookmarks/tree";
import {
  cacheResolvedFaviconDataUrl,
} from "@/features/embedded-browser/services/favicon-cache";
import { getFileLink } from '@/features/file-explorer/services/file.api';
import { resolveBrowserFileMapping } from '@/features/browser-file-mappings/services/browser-file-mapping.api';
import { getAppPopupContainer } from '@/utils/popup-container';
import { useAuth } from '@/hooks/useAuth';
import SearchWorkspace, { type SearchWorkspaceMode } from "./SearchWorkspace";
import BrowserSettingsWorkspace, { type BrowserSettingsSection } from './BrowserSettingsWorkspace';
import ToolWorkspace from "@/features/tool-workspace";
import {
  loadLibraryDetailWorkspaceState,
  saveLibraryDetailWorkspaceState,
  type BrowserTab,
  type LibraryDetailWorkspaceState,
  type WorkspaceDisplayMode,
} from "./workspace-state";
import type { FileViewerFileType } from '@/shared/file-viewer-types';
import type { FileViewerOpenOptions } from '@/contexts/file-viewer.context';
import {
  BOOKMARK_TOOLBAR_HORIZONTAL_PADDING,
  MAX_BROWSER_RESOURCE_PANEL_WIDTH,
  MIN_BROWSER_RESOURCE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  SIDE_PANEL_COLLAPSE_ANIMATION_MS,
  loadBrowserResourcePanelWidth,
  loadSidePanelWidth,
  saveBrowserResourcePanelWidth,
  saveSidePanelWidth,
} from './layout-constants';
import {
  ArchiveReturnIconSlot,
  BookmarkContextMenuLayer,
  BookmarkManagerContent,
  BookmarkToolbar,
  BrowserWorkspace,
  BrowserWorkspaceAside,
  BrowserWorkspaceAsideResizeHandle,
  BrowserWorkspaceMain,
  ContentArea,
  ContentBody,
  ContentToolbar,
  DetailWrapper,
  ResizeHandle,
  SidePanel,
  SidePanelFooter,
  SidePanelHeader,
  SidePanelMotionProperty,
  SidePanelTree,
  SidebarCollapseIcon,
  TitlebarSidePanelToggleButton,
  TitlebarSidePanelToggleHost,
} from './layout-styles';
import {
  createBrowserSettingsTab,
  createEmptyBrowserTab,
  isBrowserSettingsTab,
  reorderBrowserTabs,
  updateBrowserTabList,
} from './browser-tabs';
import {
  BookmarkVisual,
  BrowserTabVisual,
} from './bookmark-visuals';
import {
  getBookmarkIconDisplaySignature,
  getBookmarkManagerMeta,
  type BookmarkIconDisplayEntry,
} from './bookmark-visual-helpers';

type BookmarkContextMenuState = {
  item: BrowserBookmarkItem | null;
  x: number;
  y: number;
} | null;

type BookmarkDropTarget = {
  bookmarkId: number | null;
  position: 'before' | 'after' | 'inside' | 'end';
} | null;

type BookmarkMenuDropTarget = {
  bookmarkId: number;
  parentId: number | null;
  position: 'before' | 'after' | 'inside';
} | null;

type BookmarkEditDraft = {
  item: BrowserBookmarkItem | null;
  kind: BrowserBookmarkKind;
  parentId: number | null;
  title: string;
  url: string;
  iconUrl: string;
} | null;

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { user } = useAuth();
  const { setFileUrl, tabs, activeTabId, fileState, reloadActiveTab, activateTab } = useFileViewer();
  const mediaEntries = useMediaEntries();
  const mediaRegistry = useMediaRegistry();
  const navigate = useNavigate();
  const sidePanelRef = React.useRef<HTMLDivElement>(null);
  const browserResourcePanelRef = React.useRef<HTMLDivElement>(null);
  const directorySidebarRef = React.useRef<DirectorySidebarHandle | null>(null);
  const handleBrowserDownloadImportSuccess = React.useCallback(async ({ targetFolder }: { targetFolder: { id: number } }) => {
    await directorySidebarRef.current?.refreshNodeSubtree(targetFolder.id);
  }, []);
  const {
    activeDownload: activeBrowserDownload,
    closeActiveDownload,
    importActiveDownload,
    importLoading: importingBrowserDownload,
    saveActiveDownloadToDesktop,
    savingLoading: savingBrowserDownload,
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
  const bookmarkToolbarRef = React.useRef<HTMLDivElement | null>(null);
  const bookmarkBarListRef = React.useRef<HTMLDivElement | null>(null);
  const bookmarkButtonRefMap = React.useRef<Map<number, HTMLButtonElement>>(new Map());
  const bookmarkMenuItemRefMap = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingBrowserTabDragRef = React.useRef<{ started: boolean; tabId: string } | null>(null);
  const browserTabMouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const browserTabMouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const browserTabClickBlockUntilRef = React.useRef(0);
  const bookmarkIconHydrateKeysRef = React.useRef<Set<string>>(new Set());
  const bookmarkIconSyncKeyRef = React.useRef('');
  const pendingBookmarkDragRef = React.useRef<{ bookmarkId: number; started: boolean } | null>(null);
  const bookmarkMouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const bookmarkMouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const bookmarkClickBlockUntilRef = React.useRef(0);
  const pendingBookmarkMenuDragRef = React.useRef<{ bookmarkId: number; parentId: number | null; started: boolean } | null>(null);
  const bookmarkMenuMouseMoveListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const bookmarkMenuMouseUpListenerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const bookmarkMenuClickBlockUntilRef = React.useRef(0);
  const previousActiveBrowserTabIdRef = React.useRef<string | null>(null);
  const previousBrowserTabCountRef = React.useRef(0);
  const [sidePanelWidth, setSidePanelWidth] = React.useState<number>(() => loadSidePanelWidth(libraryId));
  const [sidePanelCollapsed, setSidePanelCollapsed] = React.useState(false);
  const [sidePanelMotionSyncSignal, setSidePanelMotionSyncSignal] = React.useState(0);
  const [sidePanelResizing, setSidePanelResizing] = React.useState(false);
  const [sidePanelVisualWidth, setSidePanelVisualWidthState] = React.useState<number>(() => (
    loadSidePanelWidth(libraryId)
  ));
  const [browserResourcePanelVisible, setBrowserResourcePanelVisible] = React.useState<boolean>(false);
  const [browserResourcePanelWidth, setBrowserResourcePanelWidth] = React.useState<number>(() => (
    loadBrowserResourcePanelWidth(libraryId)
  ));
  const [browserModeOpen, setBrowserModeOpen] = React.useState(initialWorkspaceState.browserModeOpen);
  const [browserTabs, setBrowserTabs] = React.useState<BrowserTab[]>(initialWorkspaceState.browserTabs);
  const [activeBrowserTabId, setActiveBrowserTabId] = React.useState<string | null>(initialWorkspaceState.activeBrowserTabId);
  const [draggingBrowserTabId, setDraggingBrowserTabId] = React.useState<string | null>(null);
  const [browserTabsScrollMode, setBrowserTabsScrollMode] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState<BrowserBookmarkItem[]>([]);
  const [bookmarkIconDisplayUrls, setBookmarkIconDisplayUrls] = React.useState<Record<number, BookmarkIconDisplayEntry>>({});
  const [bookmarkMatch, setBookmarkMatch] = React.useState<BrowserBookmarkMatchResult>({ matched: false, bookmark: null });
  const [bookmarkBarVisible, setBookmarkBarVisible] = React.useState(true);
  const [visibleBookmarkCount, setVisibleBookmarkCount] = React.useState<number>(999);
  const [bookmarkContextMenu, setBookmarkContextMenu] = React.useState<BookmarkContextMenuState>(null);
  const [bookmarkEditDraft, setBookmarkEditDraft] = React.useState<BookmarkEditDraft>(null);
  const [bookmarkManagerOpen, setBookmarkManagerOpen] = React.useState(false);
  const [collapsedBookmarkFolderIds, setCollapsedBookmarkFolderIds] = React.useState<number[]>([]);
  const [draggingBookmarkId, setDraggingBookmarkId] = React.useState<number | null>(null);
  const [bookmarkDropTarget, setBookmarkDropTarget] = React.useState<BookmarkDropTarget>(null);
  const [bookmarkMenuDropTarget, setBookmarkMenuDropTarget] = React.useState<BookmarkMenuDropTarget>(null);
  const [pendingBrowserFileOpenByTabId, setPendingBrowserFileOpenByTabId] = React.useState<Record<string, {
    fileName: string;
    sourceUrl: string;
  }>>({});
  const [browserTabDropTarget, setBrowserTabDropTarget] = React.useState<{
    position: 'before' | 'after';
    tabId: string;
  } | null>(null);
  const [browserInput, setBrowserInput] = React.useState(initialWorkspaceState.browserInput);
  const [searchMode, setSearchMode] = React.useState<SearchWorkspaceMode>(initialWorkspaceState.searchMode);
  const [searchDraft, setSearchDraft] = React.useState(initialWorkspaceState.searchDraft);
  const [selectedTreeNode, setSelectedTreeNode] = React.useState<SelectedTreeNode | null>(null);
  const [treeRootNodeId, setTreeRootNodeId] = React.useState<number | null>(null);
  const [workspaceDisplayMode, setWorkspaceDisplayMode] = React.useState<WorkspaceDisplayMode>(initialWorkspaceState.workspaceDisplayMode);
  const [mediaProcessingRequest, setMediaProcessingRequest] = React.useState<ToolWorkspaceMediaRequest | null>(null);
  const [videoWideModeActive, setVideoWideModeActive] = React.useState(false);
  const browserInputRef = React.useRef<HTMLInputElement | null>(null);
  const latestWorkspaceStateRef = React.useRef<LibraryDetailWorkspaceState>(initialWorkspaceState);
  const latestPanelWidthRef = React.useRef<number>(sidePanelWidth);
  const sidePanelCollapsedRef = React.useRef<boolean>(sidePanelCollapsed);
  const sidePanelVisualWidthRef = React.useRef<number>(sidePanelVisualWidth);
  const videoWideModeRestoreRef = React.useRef<{
    sidePanelCollapsed: boolean;
    sidePanelWidth: number;
  } | null>(null);
  const latestBrowserResourcePanelWidthRef = React.useRef<number>(browserResourcePanelWidth);
  const resizeMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const resizeUpHandlerRef = React.useRef<(() => void) | null>(null);
  const browserResourcePanelResizeMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const browserResourcePanelResizeUpHandlerRef = React.useRef<(() => void) | null>(null);

  const activeBrowserTab = React.useMemo(() => {
    if (!activeBrowserTabId) {
      return null;
    }
    return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
  }, [activeBrowserTabId, browserTabs]);
  const activeBrowserTabIsSettings = isBrowserSettingsTab(activeBrowserTab);
  const [browserSettingsSection, setBrowserSettingsSection] = React.useState<BrowserSettingsSection | null>(null);
  const [pendingCredential, setPendingCredential] = React.useState<{
    credentialRequestId: string
    domain: string
    username: string
    tabId: string
  } | null>(null);
  React.useEffect(() => {
    return subscribeCredentialCaptured((payload) => {
      if (payload.tabId && payload.tabId === activeBrowserTabId) {
        setPendingCredential({
          credentialRequestId: payload.credentialRequestId,
          domain: payload.domain,
          username: payload.username,
          tabId: payload.tabId,
        })
      }
    })
  }, [activeBrowserTabId])
  const [autoFilledCredential, setAutoFilledCredential] = React.useState<{
    tabId: string
    domain: string
    filledUsername: string
    alternatives: Array<{ id: string; username: string }>
  } | null>(null);
  React.useEffect(() => {
    return subscribeCredentialAutoFilled((payload) => {
      if (payload.tabId && payload.tabId === activeBrowserTabId) {
        setAutoFilledCredential({
          tabId: payload.tabId,
          domain: payload.domain,
          filledUsername: payload.filledUsername,
          alternatives: payload.alternatives,
        })
      }
    })
  }, [activeBrowserTabId])
  React.useEffect(() => {
    setPendingCredential(null)
    setAutoFilledCredential(null)
  }, [activeBrowserTabId])
  const getPreferredBrowserPageTabId = React.useCallback(() => {
    const activePageTabId = (
      activeBrowserTabId
      && browserTabs.some((tab) => tab.id === activeBrowserTabId && !isBrowserSettingsTab(tab))
    )
      ? activeBrowserTabId
      : null;
    if (activePageTabId) {
      return activePageTabId;
    }
    for (let index = browserTabs.length - 1; index >= 0; index -= 1) {
      const candidate = browserTabs[index];
      if (!isBrowserSettingsTab(candidate)) {
        return candidate.id;
      }
    }
    return null;
  }, [activeBrowserTabId, browserTabs]);

  const faviconCacheOwnerKey = React.useMemo(() => {
    const userId = Number(user?.id);
    if (Number.isFinite(userId) && userId > 0) {
      return `user:${userId}`;
    }
    const username = String(user?.username || '').trim();
    return username ? `user:${username}` : '';
  }, [user?.id, user?.username]);

  const bookmarkFolderIds = React.useMemo(() => collectBookmarkFolderIds(bookmarks), [bookmarks]);

  const getResolvedBookmarkDisplayIcon = React.useCallback((item: BrowserBookmarkItem) => {
    const entry = bookmarkIconDisplayUrls[item.id];
    if (!entry || entry.signature !== getBookmarkIconDisplaySignature(item)) {
      return undefined;
    }
    return entry;
  }, [bookmarkIconDisplayUrls]);

  const invalidateBookmarkDisplayIcon = React.useCallback((bookmarkId: number) => {
    setBookmarkIconDisplayUrls((current) => {
      if (!current[bookmarkId]) {
        return current;
      }
      const next = { ...current };
      delete next[bookmarkId];
      return next;
    });
  }, []);

  const bookmarkParentOptions = React.useMemo(
    () => buildBookmarkParentOptions(bookmarks, bookmarkEditDraft?.item ?? null),
    [bookmarkEditDraft?.item, bookmarks],
  );

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

  const cleanupBrowserResourcePanelResizeListeners = React.useCallback(() => {
    if (browserResourcePanelResizeMoveHandlerRef.current) {
      document.removeEventListener("mousemove", browserResourcePanelResizeMoveHandlerRef.current);
      browserResourcePanelResizeMoveHandlerRef.current = null;
    }
    if (browserResourcePanelResizeUpHandlerRef.current) {
      document.removeEventListener("mouseup", browserResourcePanelResizeUpHandlerRef.current);
      browserResourcePanelResizeUpHandlerRef.current = null;
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const setSidePanelVisualWidth = React.useCallback((nextWidth: number) => {
    const normalizedWidth = Math.max(0, Math.floor(nextWidth));
    sidePanelVisualWidthRef.current = normalizedWidth;
    setSidePanelVisualWidthState(normalizedWidth);
  }, []);

  const toggleSidePanelCollapsed = React.useCallback(() => {
    cleanupResizeListeners();
    setSidePanelResizing(false);
    setSidePanelMotionSyncSignal((current) => current + 1);
    setSidePanelCollapsed((current) => {
      const nextCollapsed = !current;
      sidePanelCollapsedRef.current = nextCollapsed;
      if (nextCollapsed) {
        setSidePanelVisualWidth(0);
        return nextCollapsed;
      }
      const restoredWidth = Math.max(MIN_SIDE_PANEL_WIDTH, latestPanelWidthRef.current || sidePanelWidth);
      setSidePanelWidth(restoredWidth);
      latestPanelWidthRef.current = restoredWidth;
      setSidePanelVisualWidth(restoredWidth);
      return nextCollapsed;
    });
  }, [cleanupResizeListeners, setSidePanelVisualWidth, sidePanelWidth]);

  const setVideoWideMode = React.useCallback((enabled: boolean) => {
    cleanupResizeListeners();
    setSidePanelResizing(false);

    if (enabled) {
      if (videoWideModeRestoreRef.current) {
        return;
      }
      setVideoWideModeActive(true);
      videoWideModeRestoreRef.current = {
        sidePanelCollapsed: sidePanelCollapsedRef.current,
        sidePanelWidth: latestPanelWidthRef.current || MIN_SIDE_PANEL_WIDTH,
      };
      if (!sidePanelCollapsedRef.current) {
        sidePanelCollapsedRef.current = true;
        setSidePanelCollapsed(true);
        setSidePanelMotionSyncSignal((current) => current + 1);
        setSidePanelVisualWidth(0);
      }
      return;
    }

    const restore = videoWideModeRestoreRef.current;
    if (!restore) {
      setVideoWideModeActive(false);
      return;
    }
    videoWideModeRestoreRef.current = null;
    setVideoWideModeActive(false);
    setSidePanelMotionSyncSignal((current) => current + 1);
    if (restore.sidePanelCollapsed) {
      sidePanelCollapsedRef.current = true;
      setSidePanelCollapsed(true);
      setSidePanelVisualWidth(0);
      return;
    }
    const restoredWidth = Math.max(
      MIN_SIDE_PANEL_WIDTH,
      restore.sidePanelWidth || latestPanelWidthRef.current || MIN_SIDE_PANEL_WIDTH,
    );
    sidePanelCollapsedRef.current = false;
    setSidePanelCollapsed(false);
    setSidePanelWidth(restoredWidth);
    latestPanelWidthRef.current = restoredWidth;
    setSidePanelVisualWidth(restoredWidth);
  }, [cleanupResizeListeners, setSidePanelVisualWidth]);

  const libraryWorkspaceControls = React.useMemo(() => ({
    setVideoWideMode,
  }), [setVideoWideMode]);

  React.useEffect(() => {
    sidePanelCollapsedRef.current = sidePanelCollapsed;
  }, [sidePanelCollapsed]);

  React.useEffect(() => {
    const restored = loadSidePanelWidth(libraryId);
    latestPanelWidthRef.current = restored;
    setSidePanelWidth(restored);
    if (!sidePanelCollapsedRef.current) {
      setSidePanelVisualWidth(restored);
    }
  }, [libraryId, setSidePanelVisualWidth]);

  React.useEffect(() => {
    const restoredWidth = loadBrowserResourcePanelWidth(libraryId);
    latestBrowserResourcePanelWidthRef.current = restoredWidth;
    setBrowserResourcePanelWidth(restoredWidth);
    setBrowserResourcePanelVisible(false);
  }, [libraryId]);

  React.useEffect(() => {
    return () => {
      cleanupResizeListeners();
    };
  }, [cleanupResizeListeners]);

  React.useEffect(() => {
    return () => {
      cleanupBrowserResourcePanelResizeListeners();
    };
  }, [cleanupBrowserResourcePanelResizeListeners]);

  React.useEffect(() => {
    setCollapsedBookmarkFolderIds((current) => current.filter((id) => bookmarkFolderIds.includes(id)));
  }, [bookmarkFolderIds]);

  React.useEffect(() => {
    const validBookmarkIds = new Set(collectURLBookmarkItems(bookmarks).map((item) => item.id));
    setBookmarkIconDisplayUrls((current) => {
      let changed = false;
      const nextEntries: Record<number, BookmarkIconDisplayEntry> = {};
      Object.entries(current).forEach(([rawId, entry]) => {
        const bookmarkId = Number(rawId);
        if (validBookmarkIds.has(bookmarkId)) {
          nextEntries[bookmarkId] = entry;
          return;
        }
        changed = true;
      });
      return changed ? nextEntries : current;
    });
  }, [bookmarks]);

  const handleResizeMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    cleanupResizeListeners();
    setSidePanelResizing(true);
    setSidePanelCollapsed(false);
    sidePanelCollapsedRef.current = false;
    const startX = e.clientX;
    const startWidth = sidePanelRef.current?.getBoundingClientRect().width || sidePanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!sidePanelRef.current) return;
      const maxWidth = Math.floor(window.innerWidth * 0.8);
      const newWidth = Math.min(Math.max(startWidth + ev.clientX - startX, MIN_SIDE_PANEL_WIDTH), maxWidth);
      setSidePanelVisualWidth(newWidth);
      latestPanelWidthRef.current = newWidth;
    };

    const onMouseUp = () => {
      const finalWidth = Math.floor(latestPanelWidthRef.current);
      setSidePanelWidth(finalWidth);
      setSidePanelVisualWidth(finalWidth);
      saveSidePanelWidth(libraryId, finalWidth);
      setSidePanelResizing(false);
      cleanupResizeListeners();
    };

    resizeMoveHandlerRef.current = onMouseMove;
    resizeUpHandlerRef.current = onMouseUp;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [cleanupResizeListeners, libraryId, setSidePanelVisualWidth, sidePanelWidth]);

  const handleBrowserResourcePanelResizeMouseDown = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    cleanupBrowserResourcePanelResizeListeners();
    const startX = event.clientX;
    const startWidth = browserResourcePanelRef.current?.offsetWidth || browserResourcePanelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!browserResourcePanelRef.current) {
        return;
      }
      const nextWidth = Math.max(
        MIN_BROWSER_RESOURCE_PANEL_WIDTH,
        Math.min(
          MAX_BROWSER_RESOURCE_PANEL_WIDTH,
          startWidth - (moveEvent.clientX - startX),
        ),
      );
      browserResourcePanelRef.current.style.width = `${nextWidth}px`;
      latestBrowserResourcePanelWidthRef.current = nextWidth;
    };

    const onMouseUp = () => {
      const finalWidth = Math.floor(latestBrowserResourcePanelWidthRef.current);
      setBrowserResourcePanelWidth(finalWidth);
      saveBrowserResourcePanelWidth(libraryId, finalWidth);
      cleanupBrowserResourcePanelResizeListeners();
    };

    browserResourcePanelResizeMoveHandlerRef.current = onMouseMove;
    browserResourcePanelResizeUpHandlerRef.current = onMouseUp;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [
    browserResourcePanelWidth,
    cleanupBrowserResourcePanelResizeListeners,
    libraryId,
  ]);

  const handleFileOpen = async (
    fileUrl: string,
    fileName: string,
    fileType: FileViewerFileType,
    nodeId: number,
    options?: FileViewerOpenOptions,
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
    || (fileState.fileType === 'video' && archiveReturnTarget?.fileType === 'video_archive')
    || (fileState.fileType === 'video_archive' && archiveReturnTarget?.fileType === 'video_archive')
    || (fileState.fileType === 'audio' && archiveReturnTarget?.fileType === 'audio_archive')
  );

  const handleArchiveReturn = React.useCallback(() => {
    if (!archiveReturnTarget) {
      return;
    }
    const targetTab = tabs.find(tab => (
      (archiveReturnTarget.nodeId !== null && archiveReturnTarget.nodeId !== undefined)
        ? tab.nodeId === archiveReturnTarget.nodeId
        : tab.fileUrl === archiveReturnTarget.fileUrl
    ));
    setFileUrl(
      archiveReturnTarget.fileUrl,
      archiveReturnTarget.fileName,
      archiveReturnTarget.fileType,
      archiveReturnTarget.nodeId,
      {
        tabTypeLabel: archiveReturnTarget.tabTypeLabel ?? null,
        returnTarget: targetTab?.returnTarget ?? null,
      },
    );
  }, [archiveReturnTarget, setFileUrl, tabs]);

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

  const reloadBookmarks = React.useCallback(async () => {
    try {
      const tree = await fetchBrowserBookmarkTree();
      setBookmarks(tree);
    } catch (error: any) {
      Toast.error(error?.message || '书签加载失败');
    }
  }, []);

  const refreshBookmarkMatch = React.useCallback(async (rawUrl: string) => {
    const normalizedUrl = String(rawUrl || '').trim();
    if (!normalizedUrl) {
      setBookmarkMatch({ matched: false, bookmark: null });
      return;
    }
    try {
      const result = await matchBrowserBookmark(normalizedUrl);
      setBookmarkMatch(result);
    } catch {
      setBookmarkMatch({ matched: false, bookmark: null });
    }
  }, []);

  const openBookmarkEdit = React.useCallback((item: BrowserBookmarkItem) => {
    setBookmarkEditDraft({
      item,
      kind: item.kind,
      parentId: item.parentId ?? null,
      title: item.title || '',
      url: item.url || '',
      iconUrl: getPersistableBookmarkIconUrl(item.iconUrl),
    });
  }, []);

  const openBookmarkCreate = React.useCallback((kind: BrowserBookmarkKind, parentId: number | null = null) => {
    const activeUrl = activeBrowserTab?.url || browserInput;
    if (parentId != null) {
      setCollapsedBookmarkFolderIds((current) => current.filter((id) => id !== parentId));
    }
    setBookmarkEditDraft({
      item: null,
      kind,
      parentId,
      title: kind === 'url' && activeUrl ? getDefaultBookmarkTitle(activeUrl, activeBrowserTab?.title) : '',
      url: kind === 'url' ? activeUrl : '',
      iconUrl: kind === 'url' && activeUrl ? getPersistableBookmarkIconUrl(activeBrowserTab?.iconSourceUrl) : '',
    });
  }, [activeBrowserTab, browserInput]);

  const closeBookmarkContextMenu = React.useCallback(() => {
    setBookmarkContextMenu(null);
  }, []);

  const saveBookmarkEditDraft = React.useCallback(async () => {
    if (!bookmarkEditDraft) {
      return;
    }
    const title = bookmarkEditDraft.title.trim();
    if (!title) {
      Toast.warning('请输入书签名称');
      return;
    }
    const normalizedUrl = bookmarkEditDraft.url.trim();
    const normalizedIconUrl = getPersistableBookmarkIconUrl(bookmarkEditDraft.iconUrl);
    if (bookmarkEditDraft.kind === 'url' && !normalizedUrl) {
      Toast.warning('请输入网址');
      return;
    }
    const shouldInvalidateDisplayIcon = Boolean(
      bookmarkEditDraft.kind === 'url'
      && bookmarkEditDraft.item
      && (
        normalizedUrl !== String(bookmarkEditDraft.item.url || '').trim()
        || normalizedIconUrl !== getPersistableBookmarkIconUrl(bookmarkEditDraft.item.iconUrl)
      )
    );
    try {
      if (bookmarkEditDraft.item) {
        await updateBrowserBookmark(bookmarkEditDraft.item.id, {
          title,
          ...(bookmarkEditDraft.kind === 'url' ? { url: normalizedUrl } : {}),
          iconUrl: normalizedIconUrl,
        });
        const currentParentId = bookmarkEditDraft.item.parentId ?? null;
        if (bookmarkEditDraft.parentId !== currentParentId) {
          await moveBrowserBookmark(bookmarkEditDraft.item.id, {
            parentId: bookmarkEditDraft.parentId,
          });
        }
        Toast.success('书签已更新');
      } else {
        await createBrowserBookmark({
          parentId: bookmarkEditDraft.parentId,
          kind: bookmarkEditDraft.kind,
          title,
          url: bookmarkEditDraft.kind === 'url' ? normalizedUrl : null,
          iconUrl: normalizedIconUrl || null,
        });
        Toast.success(bookmarkEditDraft.kind === 'folder' ? '文件夹已创建' : '书签已创建');
      }
      if (shouldInvalidateDisplayIcon && bookmarkEditDraft.item) {
        invalidateBookmarkDisplayIcon(bookmarkEditDraft.item.id);
      }
      setBookmarkEditDraft(null);
      await reloadBookmarks();
      await refreshBookmarkMatch(activeBrowserTab?.url || '');
    } catch (error: any) {
      Toast.error(error?.message || '书签保存失败');
    }
  }, [activeBrowserTab, bookmarkEditDraft, invalidateBookmarkDisplayIcon, refreshBookmarkMatch, reloadBookmarks]);

  const removeBookmark = React.useCallback(async (item: BrowserBookmarkItem) => {
    try {
      await deleteBrowserBookmark(item.id);
      Toast.success('书签已删除');
      await reloadBookmarks();
      await refreshBookmarkMatch(activeBrowserTab?.url || '');
    } catch (error: any) {
      Toast.error(error?.message || '书签删除失败');
    }
  }, [activeBrowserTab, refreshBookmarkMatch, reloadBookmarks]);

  const toggleActiveBookmark = React.useCallback(async () => {
    const activeUrl = activeBrowserTab?.url || browserInput;
    const normalizedUrl = String(activeUrl || '').trim();
    if (!normalizedUrl) {
      Toast.warning('当前没有可收藏的网址');
      return;
    }
    try {
      const title = getDefaultBookmarkTitle(normalizedUrl, activeBrowserTab?.title);
      const created = await createBrowserBookmark({
        kind: 'url',
        title,
        url: normalizedUrl,
        iconUrl: getPersistableBookmarkIconUrl(activeBrowserTab?.iconSourceUrl) || null,
      });
      if (activeBrowserTab?.iconUrl) {
        setBookmarkIconDisplayUrls((current) => ({
          ...current,
          [created.id]: {
            dataUrl: activeBrowserTab.iconUrl as string,
            signature: getBookmarkIconDisplaySignature(created),
          },
        }));
      }
      setBookmarkMatch({ matched: true, bookmark: created });
      Toast.success(bookmarkMatch.matched ? '已追加到书签栏' : '已加入书签栏');
      await reloadBookmarks();
    } catch (error: any) {
      Toast.error(error?.message || '收藏操作失败');
    }
  }, [activeBrowserTab, bookmarkMatch.matched, browserInput, reloadBookmarks]);

  const toggleBrowserResourcePanel = React.useCallback(() => {
    setBrowserResourcePanelVisible((current) => !current);
  }, []);

  const openBookmarkURL = React.useCallback((item: BrowserBookmarkItem) => {
    if (!isURLBookmark(item)) {
      return;
    }
    const rawTargetUrl = item.url || '';
    const nextUrl = normalizeBrowserUrl(rawTargetUrl);
    if (!nextUrl) {
      Toast.warning('当前书签缺少有效网址');
      return;
    }
    const existingTabId = getPreferredBrowserPageTabId();
    let targetTabId = existingTabId;
    if (!targetTabId) {
      const next = createEmptyBrowserTab();
      targetTabId = next.id;
      setBrowserTabs((prev) => [
        ...prev,
        {
          ...next.tab,
          title: item.title || nextUrl,
          url: nextUrl,
        },
      ]);
      void window.electronEmbeddedBrowser.openTab(targetTabId);
    } else {
      setBrowserTabs((prev) => updateBrowserTabList(prev, targetTabId!, (tab) => ({
        ...tab,
        title: item.title || tab.title || nextUrl,
        url: nextUrl,
      })));
    }
    setActiveBrowserTabId(targetTabId);
    setBrowserInput(nextUrl);
    setBrowserModeOpen(true);
    setBookmarkBarVisible(false);
    setWorkspaceDisplayMode('browser');
    setSearchMode('web');
    window.requestAnimationFrame(() => {
      if (targetTabId) {
        browserRef.current?.navigate(targetTabId, nextUrl);
      }
    });
  }, [getPreferredBrowserPageTabId, normalizeBrowserUrl]);

  const buildBookmarkContextMenuItems = React.useCallback((item: BrowserBookmarkItem | null): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (item) {
      items.push({
        key: 'edit',
        label: '编辑',
        icon: <IconEdit />,
        onClick: () => openBookmarkEdit(item),
      });
      if (item.kind === 'folder') {
        items.push({
          key: 'new-url-inside',
          label: '新建书签',
          onClick: () => openBookmarkCreate('url', item.id),
        });
        items.push({
          key: 'new-folder-inside',
          label: '新建文件夹',
          onClick: () => openBookmarkCreate('folder', item.id),
        });
      }
      items.push({ key: 'divider-item', type: 'divider' });
      items.push({
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          void removeBookmark(item);
        },
      });
    } else {
      items.push({
        key: 'new-url',
        label: '新建书签',
        onClick: () => openBookmarkCreate('url'),
      });
      items.push({
        key: 'new-folder',
        label: '新建文件夹',
        onClick: () => openBookmarkCreate('folder'),
      });
    }
    items.push({ key: 'divider-manager', type: 'divider' });
    items.push({
      key: 'manager',
      label: '书签管理',
      onClick: () => setBookmarkManagerOpen(true),
    });
    return items;
  }, [openBookmarkCreate, openBookmarkEdit, removeBookmark]);

  const toggleBookmarkFolderCollapsed = React.useCallback((folderId: number) => {
    setCollapsedBookmarkFolderIds((current) => (
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    ));
  }, []);

  const expandAllBookmarkFolders = React.useCallback(() => {
    setCollapsedBookmarkFolderIds([]);
  }, []);

  const collapseAllBookmarkFolders = React.useCallback(() => {
    setCollapsedBookmarkFolderIds(bookmarkFolderIds);
  }, [bookmarkFolderIds]);

  const detachBookmarkDragListeners = React.useCallback(() => {
    if (bookmarkMouseMoveListenerRef.current) {
      window.removeEventListener('mousemove', bookmarkMouseMoveListenerRef.current);
      bookmarkMouseMoveListenerRef.current = null;
    }
    if (bookmarkMouseUpListenerRef.current) {
      window.removeEventListener('mouseup', bookmarkMouseUpListenerRef.current);
      bookmarkMouseUpListenerRef.current = null;
    }
  }, []);

  const clearBookmarkDragState = React.useCallback(() => {
    pendingBookmarkDragRef.current = null;
    setDraggingBookmarkId(null);
    setBookmarkDropTarget(null);
    detachBookmarkDragListeners();
  }, [detachBookmarkDragListeners]);

  const detachBookmarkMenuDragListeners = React.useCallback(() => {
    if (bookmarkMenuMouseMoveListenerRef.current) {
      window.removeEventListener('mousemove', bookmarkMenuMouseMoveListenerRef.current);
      bookmarkMenuMouseMoveListenerRef.current = null;
    }
    if (bookmarkMenuMouseUpListenerRef.current) {
      window.removeEventListener('mouseup', bookmarkMenuMouseUpListenerRef.current);
      bookmarkMenuMouseUpListenerRef.current = null;
    }
  }, []);

  const clearBookmarkMenuDragState = React.useCallback(() => {
    pendingBookmarkMenuDragRef.current = null;
    setBookmarkMenuDropTarget(null);
    setBookmarkDropTarget(null);
    detachBookmarkMenuDragListeners();
  }, [detachBookmarkMenuDragListeners]);

  const resolveBookmarkDropTarget = React.useCallback((
    clientX: number,
    draggedBookmarkId: number,
  ): BookmarkDropTarget => {
    const visibleRoots = bookmarks.slice(0, Math.min(visibleBookmarkCount, bookmarks.length));
    const candidateItems = visibleRoots.filter((item) => item.id !== draggedBookmarkId);
    if (candidateItems.length === 0) {
      return null;
    }

    let nearest: { bookmarkId: number; distance: number; position: 'before' | 'after' | 'inside' } | null = null;
    for (const item of candidateItems) {
      const button = bookmarkButtonRefMap.current.get(item.id);
      if (!button) {
        continue;
      }
      const rect = button.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const folderInsideLeft = rect.left + rect.width * 0.28;
      const folderInsideRight = rect.right - rect.width * 0.28;
      const position: 'before' | 'after' | 'inside' = item.kind === 'folder' && clientX >= folderInsideLeft && clientX <= folderInsideRight
        ? 'inside'
        : (clientX < midpoint ? 'before' : 'after');
      const distance = position === 'inside'
        ? Math.abs(clientX - midpoint) * 0.25
        : (clientX >= rect.left && clientX <= rect.right
          ? Math.abs(clientX - midpoint) * 0.5
          : Math.min(Math.abs(clientX - rect.left), Math.abs(clientX - rect.right)) + rect.width / 2);
      if (!nearest || distance < nearest.distance) {
        nearest = { bookmarkId: item.id, distance, position };
      }
    }
    return nearest ? { bookmarkId: nearest.bookmarkId, position: nearest.position } : null;
  }, [bookmarks, visibleBookmarkCount]);

  const moveRootBookmark = React.useCallback(async (
    draggedBookmarkId: number,
    target: Exclude<BookmarkDropTarget, null>,
  ) => {
    try {
      await moveBrowserBookmark(draggedBookmarkId, {
        parentId: target.position === 'inside' ? target.bookmarkId : null,
        beforeId: target.position === 'before' ? target.bookmarkId : null,
        afterId: target.position === 'after' || target.position === 'end' ? target.bookmarkId : null,
      });
      await reloadBookmarks();
    } catch (error: any) {
      Toast.error(error?.message || '书签移动失败');
    }
  }, [reloadBookmarks]);

  const resolveBookmarkBarDropTarget = React.useCallback((
    clientX: number,
    clientY: number,
    draggedBookmarkId: number,
  ): BookmarkDropTarget => {
    const container = bookmarkBarListRef.current;
    if (!container) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    const verticalMargin = 16;
    const horizontalMargin = 12;
    if (
      clientY < rect.top - verticalMargin
      || clientY > rect.bottom + verticalMargin
      || clientX < rect.left - horizontalMargin
      || clientX > rect.right + horizontalMargin
    ) {
      return null;
    }

    const visibleRoots = bookmarks.slice(0, Math.min(visibleBookmarkCount, bookmarks.length));
    const candidateItems = visibleRoots.filter((item) => item.id !== draggedBookmarkId);
    if (!candidateItems.length) {
      return { bookmarkId: null, position: 'end' };
    }

    const nearest = resolveBookmarkDropTarget(clientX, draggedBookmarkId);
    if (nearest) {
      return nearest;
    }
    const lastVisible = candidateItems[candidateItems.length - 1];
    return {
      bookmarkId: lastVisible?.id ?? null,
      position: 'end',
    };
  }, [bookmarks, resolveBookmarkDropTarget, visibleBookmarkCount]);

  const resolveBookmarkMenuDropTarget = React.useCallback((
    clientX: number,
    clientY: number,
    parentId: number | null,
    siblings: BrowserBookmarkItem[],
    draggedBookmarkId: number,
  ): BookmarkMenuDropTarget => {
    const candidateItems = siblings.filter((item) => item.id !== draggedBookmarkId);
    if (!candidateItems.length) {
      return null;
    }
    let nearest: { bookmarkId: number; distance: number; position: 'before' | 'after' | 'inside' } | null = null;
    let minTop = Number.POSITIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    for (const item of candidateItems) {
      const element = bookmarkMenuItemRefMap.current.get(item.id);
      if (!element) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      minTop = Math.min(minTop, rect.top);
      maxBottom = Math.max(maxBottom, rect.bottom);
      minLeft = Math.min(minLeft, rect.left);
      maxRight = Math.max(maxRight, rect.right);
      const midpoint = rect.top + rect.height / 2;
      const folderInsideLeft = rect.left + rect.width * 0.24;
      const folderInsideRight = rect.right - rect.width * 0.2;
      const position: 'before' | 'after' | 'inside' = item.kind === 'folder'
        && clientX >= folderInsideLeft
        && clientX <= folderInsideRight
        && clientY >= rect.top
        && clientY <= rect.bottom
        ? 'inside'
        : (clientY < midpoint ? 'before' : 'after');
      const distance = position === 'inside'
        ? Math.abs(clientY - midpoint) * 0.2
        : (clientY >= rect.top && clientY <= rect.bottom
          ? Math.abs(clientY - midpoint) * 0.5
          : Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom)) + rect.height / 2);
      if (!nearest || distance < nearest.distance) {
        nearest = { bookmarkId: item.id, distance, position };
      }
    }
    if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom) || !Number.isFinite(minLeft) || !Number.isFinite(maxRight)) {
      return null;
    }
    const verticalMargin = 10;
    const horizontalMargin = 16;
    if (
      clientY < minTop - verticalMargin
      || clientY > maxBottom + verticalMargin
      || clientX < minLeft - horizontalMargin
      || clientX > maxRight + horizontalMargin
    ) {
      return null;
    }
    return nearest ? { bookmarkId: nearest.bookmarkId, parentId, position: nearest.position } : null;
  }, []);

  const moveBookmarkWithinFolder = React.useCallback(async (
    draggedBookmarkId: number,
    target: Exclude<BookmarkMenuDropTarget, null>,
  ) => {
    try {
      await moveBrowserBookmark(draggedBookmarkId, {
        parentId: target.position === 'inside' ? target.bookmarkId : target.parentId,
        beforeId: target.position === 'before' ? target.bookmarkId : null,
        afterId: target.position === 'after' ? target.bookmarkId : null,
      });
      await reloadBookmarks();
    } catch (error: any) {
      Toast.error(error?.message || '书签移动失败');
    }
  }, [reloadBookmarks]);

  const buildBookmarkFolderMenuItems = React.useCallback((items: BrowserBookmarkItem[], parentId: number | null = null): ContextMenuItem[] => {
    if (!items.length) {
      return [{ key: 'empty', type: 'title', label: '空文件夹' }];
    }
    return items.map((item) => {
      const renderDraggableItem = (content: React.ReactNode, onSelect?: () => void) => {
        const isDropTarget = bookmarkMenuDropTarget?.bookmarkId === item.id && bookmarkMenuDropTarget.parentId === parentId;
        const boxShadow = isDropTarget && bookmarkMenuDropTarget?.position !== 'inside'
          ? (bookmarkMenuDropTarget?.position === 'before'
            ? 'inset 0 2px 0 var(--semi-color-primary)'
            : 'inset 0 -2px 0 var(--semi-color-primary)')
          : undefined;
        const background = isDropTarget && bookmarkMenuDropTarget?.position === 'inside'
          ? 'var(--semi-color-primary-light-default)'
          : undefined;
        const border = isDropTarget && bookmarkMenuDropTarget?.position === 'inside'
          ? '1px solid var(--semi-color-primary)'
          : '1px solid transparent';
        return (
          <div
            ref={(element) => {
              if (element) {
                bookmarkMenuItemRefMap.current.set(item.id, element);
              } else {
                bookmarkMenuItemRefMap.current.delete(item.id);
              }
            }}
            style={{ background, border, borderRadius: 8, boxShadow }}
            onClickCapture={() => {
              if (!onSelect) {
                return;
              }
              if (Date.now() < bookmarkMenuClickBlockUntilRef.current) {
                return;
              }
              onSelect();
            }}
            onClick={() => {
              // noop: click is handled in capture phase so the wrapped menu item
              // cannot swallow it before navigation fires.
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              pendingBookmarkMenuDragRef.current = {
                bookmarkId: item.id,
                parentId,
                started: false,
              };
              setBookmarkMenuDropTarget(null);
              detachBookmarkMenuDragListeners();

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const pending = pendingBookmarkMenuDragRef.current;
                if (!pending || pending.bookmarkId !== item.id) {
                  return;
                }
                if (!pending.started) {
                  if (Math.abs(moveEvent.clientY - event.clientY) < 6) {
                    return;
                  }
                  pending.started = true;
                  bookmarkMenuClickBlockUntilRef.current = Date.now() + 180;
                }
                const rootDropTarget = resolveBookmarkBarDropTarget(moveEvent.clientX, moveEvent.clientY, item.id);
                setBookmarkDropTarget(rootDropTarget);
                if (rootDropTarget) {
                  setBookmarkMenuDropTarget(null);
                  return;
                }
                setBookmarkMenuDropTarget(resolveBookmarkMenuDropTarget(moveEvent.clientX, moveEvent.clientY, parentId, items, item.id));
              };

              const handleMouseUp = (upEvent: MouseEvent) => {
                const pending = pendingBookmarkMenuDragRef.current;
                if (pending?.started) {
                  const rootDropTarget = resolveBookmarkBarDropTarget(upEvent.clientX, upEvent.clientY, item.id);
                  if (rootDropTarget) {
                    void moveRootBookmark(item.id, rootDropTarget);
                    clearBookmarkMenuDragState();
                    return;
                  }
                  const finalDropTarget = resolveBookmarkMenuDropTarget(upEvent.clientX, upEvent.clientY, parentId, items, item.id);
                  if (finalDropTarget) {
                    void moveBookmarkWithinFolder(item.id, finalDropTarget);
                  }
                }
                clearBookmarkMenuDragState();
              };

              bookmarkMenuMouseMoveListenerRef.current = handleMouseMove;
              bookmarkMenuMouseUpListenerRef.current = handleMouseUp;
              window.addEventListener('mousemove', handleMouseMove);
              window.addEventListener('mouseup', handleMouseUp);
            }}
          >
            {content}
          </div>
        );
      };

      if (item.kind === 'folder') {
        return {
          key: `folder:${item.id}`,
          label: <span title={item.title || '未命名文件夹'}>{item.title || '未命名文件夹'}</span>,
          icon: <span className="bookmark-folder-glyph" aria-hidden="true" />,
          children: buildBookmarkFolderMenuItems(item.children || [], item.id),
          render: renderDraggableItem,
        };
      }
      return {
        key: `url:${item.id}`,
        label: <span title={item.title || item.url || '未命名书签'}>{item.title || item.url || '未命名书签'}</span>,
        icon: <BookmarkVisual cacheOwnerKey={faviconCacheOwnerKey} displayIcon={getResolvedBookmarkDisplayIcon(item)} item={item} />,
        render: (content) => renderDraggableItem(content, () => openBookmarkURL(item)),
      };
    });
  }, [
    bookmarkMenuDropTarget,
    clearBookmarkMenuDragState,
    detachBookmarkMenuDragListeners,
    faviconCacheOwnerKey,
    getResolvedBookmarkDisplayIcon,
    moveBookmarkWithinFolder,
    moveRootBookmark,
    openBookmarkURL,
    resolveBookmarkBarDropTarget,
    resolveBookmarkMenuDropTarget,
  ]);

  const applyBrowserTabUpdate = React.useCallback((tabId: string, updater: (tab: BrowserTab) => BrowserTab) => {
    setBrowserTabs((prev) => updateBrowserTabList(prev, tabId, updater));
  }, []);

  const applyBrowserTabState = React.useCallback((payload: {
    canGoBack?: boolean;
    canGoForward?: boolean;
    iconSourceUrl?: string;
    iconUrl?: string;
    tabId: string;
      title?: string;
      url?: string;
  }) => {
    if (payload.iconUrl) {
      cacheResolvedFaviconDataUrl({
        ownerKey: faviconCacheOwnerKey,
        dataUrl: payload.iconUrl,
        iconUrl: payload.iconSourceUrl,
        pageUrl: payload.url,
      });
    }
    applyBrowserTabUpdate(payload.tabId, (tab) => ({
      ...tab,
      canGoBack: payload.canGoBack ?? tab.canGoBack,
      canGoForward: payload.canGoForward ?? tab.canGoForward,
      iconSourceUrl: payload.iconSourceUrl || tab.iconSourceUrl,
      iconUrl: payload.iconUrl || tab.iconUrl,
      title: payload.title || tab.title || tab.url || '新标签页',
      url: payload.url ?? tab.url,
    }));
  }, [applyBrowserTabUpdate, faviconCacheOwnerKey]);

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
    setBookmarkBarVisible(true);
    setWorkspaceDisplayMode('browser');
    setBrowserInput('');
    setSearchMode('web');
    void window.electronEmbeddedBrowser.openTab(next.id);
    return next.id;
  }, []);

  const openEmbeddedBrowser = React.useCallback(() => {
    if (browserTabs.length > 0) {
      const fallbackTabId = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
      const fallbackTab = browserTabs.find((tab) => tab.id === fallbackTabId) ?? null;
      const fallbackIsSettings = isBrowserSettingsTab(fallbackTab);
      setBrowserModeOpen(true);
      setBookmarkBarVisible(Boolean(fallbackTab && !fallbackIsSettings && !fallbackTab.url));
      setWorkspaceDisplayMode('browser');
      setActiveBrowserTabId(fallbackTabId);
      setBrowserInput(fallbackIsSettings ? '' : (fallbackTab?.url ?? ''));
      if (fallbackTabId) {
        if (fallbackIsSettings) {
          void window.electronEmbeddedBrowser.deactivate();
        } else {
          void window.electronEmbeddedBrowser.activateTab(fallbackTabId);
        }
      }
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

  const openToolsWorkspace = React.useCallback(() => {
    setBrowserModeOpen(false);
    setWorkspaceDisplayMode('tools');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const openMediaProcessingWorkspace = React.useCallback((resources: EmbeddedBrowserCapturedResource[]) => {
    if (!resources.length) {
      return;
    }
    setMediaProcessingRequest({
      id: Date.now(),
      kind: 'resources',
      resources,
    });
    setBrowserModeOpen(false);
    setWorkspaceDisplayMode('tools');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const openHlsDownloadWorkspace = React.useCallback((
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserHlsManifest,
    plan: EmbeddedBrowserHlsDownloadPlan,
  ) => {
    setMediaProcessingRequest({
      id: Date.now(),
      kind: 'hls-download',
      manifest,
      plan,
      resource,
    });
    setBrowserModeOpen(false);
    setWorkspaceDisplayMode('tools');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const openMpdDownloadWorkspace = React.useCallback((
    resource: EmbeddedBrowserCapturedResource,
    manifest: EmbeddedBrowserMpdManifest,
    plan: EmbeddedBrowserMpdDownloadPlan,
  ) => {
    setMediaProcessingRequest({
      id: Date.now(),
      kind: 'mpd-download',
      manifest,
      plan,
      resource,
    });
    setBrowserModeOpen(false);
    setWorkspaceDisplayMode('tools');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const activateBrowserTab = React.useCallback((tabId: string) => {
    setActiveBrowserTabId(tabId);
    setBrowserModeOpen(true);
    setWorkspaceDisplayMode('browser');
    const targetTab = browserTabs.find((tab) => tab.id === tabId) ?? null;
    const targetIsSettings = isBrowserSettingsTab(targetTab);
    setBookmarkBarVisible(Boolean(targetTab && !targetIsSettings && !targetTab.url));
    setBrowserInput(targetIsSettings ? '' : (targetTab?.url ?? ''));
    if (targetIsSettings) {
      void window.electronEmbeddedBrowser.deactivate();
      return;
    }
    void window.electronEmbeddedBrowser.activateTab(tabId);
  }, [browserTabs]);

  const openBrowserSettings = React.useCallback(() => {
    const existingTab = browserTabs.find((tab) => isBrowserSettingsTab(tab)) ?? null;
    if (existingTab) {
      activateBrowserTab(existingTab.id);
      return;
    }
    const settingsTab = createBrowserSettingsTab();
    setBrowserTabs((prev) => [...prev, settingsTab]);
    setActiveBrowserTabId(settingsTab.id);
    setBrowserModeOpen(true);
    setBookmarkBarVisible(false);
    setWorkspaceDisplayMode('browser');
    setBrowserInput('');
    setSearchMode('web');
    void window.electronEmbeddedBrowser.deactivate();
  }, [activateBrowserTab, browserTabs]);

  const closeBrowserTab = React.useCallback((tabId: string) => {
    const closingTab = browserTabs.find((tab) => tab.id === tabId) ?? null;
    const nextTabs = browserTabs.filter((tab) => tab.id !== tabId);
    const closingActive = activeBrowserTabId === tabId;
    setBrowserTabs(nextTabs);
    if (closingActive) {
      const fallback = nextTabs[nextTabs.length - 1] ?? null;
      const fallbackIsSettings = isBrowserSettingsTab(fallback);
      setActiveBrowserTabId(fallback?.id ?? null);
      setBrowserInput(fallbackIsSettings ? '' : (fallback?.url ?? ''));
      setBrowserModeOpen(nextTabs.length > 0);
      setBookmarkBarVisible(Boolean(fallback && !fallbackIsSettings && !fallback.url));
      if (fallback) {
        if (fallbackIsSettings) {
          void window.electronEmbeddedBrowser.deactivate();
        } else {
          void window.electronEmbeddedBrowser.activateTab(fallback.id);
        }
      } else {
        void window.electronEmbeddedBrowser.deactivate();
      }
    }
    setPendingBrowserFileOpenByTabId((prev) => {
      if (!prev[tabId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    if (!isBrowserSettingsTab(closingTab)) {
      void window.electronEmbeddedBrowser.closeTab(tabId);
    }
  }, [activeBrowserTabId, browserTabs]);

  const clearPendingBrowserFileOpen = React.useCallback((tabId: string) => {
    setPendingBrowserFileOpenByTabId((prev) => {
      if (!prev[tabId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const reorderBrowserTabList = React.useCallback((
    draggedTabId: string,
    targetTabId: string,
    position: 'before' | 'after',
  ) => {
    setBrowserTabs((prev) => reorderBrowserTabs(prev, draggedTabId, targetTabId, position));
  }, []);

  const submitBrowserInput = React.useCallback((rawValue: string, targetTabId?: string | null) => {
    const resolvedTabId = targetTabId ?? getPreferredBrowserPageTabId();
    if (!resolvedTabId) {
      return;
    }
    const nextUrl = normalizeBrowserUrl(rawValue);
    if (!nextUrl) {
      return;
    }
    setBrowserInput(nextUrl);
    setBrowserModeOpen(true);
    setBookmarkBarVisible(false);
    setWorkspaceDisplayMode('browser');
    applyBrowserTabUpdate(resolvedTabId, (tab) => ({
      ...tab,
      kind: 'page',
      url: nextUrl,
      title: tab.title || nextUrl,
    }));
    browserRef.current?.navigate(resolvedTabId, nextUrl);
  }, [applyBrowserTabUpdate, getPreferredBrowserPageTabId, normalizeBrowserUrl]);

  const handleSearchWorkspaceSubmit = React.useCallback(async (rawValue: string) => {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) {
      return;
    }
    if (searchMode === 'web') {
      setBrowserInput(trimmed);
      setSearchDraft(trimmed);
      const existingTabId = getPreferredBrowserPageTabId();
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
    createAndActivateBrowserTab,
    getPreferredBrowserPageTabId,
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

  const handleOpenFileInBrowser = React.useCallback(async (payload: {
    fileExt: string;
    fileName: string;
    nodeId: number;
  }) => {
    const normalizedExt = String(payload.fileExt || '').trim().replace(/^\./, '').toLowerCase();
    if (!normalizedExt) {
      Toast.warning('当前文件缺少后缀映射信息');
      return;
    }

    try {
      const mapping = await resolveBrowserFileMapping(normalizedExt);
      let sourceUrl = '';
      try {
        sourceUrl = await getFileLink(payload.nodeId, libraryId, 300);
      } catch (error: any) {
        Toast.error(error?.message || '获取文件链接失败，请刷新后重试');
        return;
      }
      const next = createEmptyBrowserTab();

      setBrowserTabs((prev) => [
        ...prev,
        {
          ...next.tab,
          title: payload.fileName,
          url: mapping.siteUrl,
        },
      ]);
      setPendingBrowserFileOpenByTabId((prev) => ({
        ...prev,
        [next.id]: {
          fileName: payload.fileName,
          sourceUrl,
        },
      }));
      setActiveBrowserTabId(next.id);
      setBrowserModeOpen(true);
      setWorkspaceDisplayMode('browser');
      setSearchMode('web');
      setBrowserInput(mapping.siteUrl);
    } catch (error: any) {
      if (String(error?.message || '').includes('resource not found')) {
        Toast.warning(`未找到 .${normalizedExt} 的浏览器打开映射，请先到设置中配置`);
        return;
      }
      Toast.error(error?.message || '在浏览器打开失败');
    }
  }, [libraryId]);

  const handleToolbarRefresh = React.useCallback(() => {
    if (browserModeOpen) {
      if (!activeBrowserTab?.url) {
        setBrowserInput('');
        setBookmarkBarVisible(true);
      }
      browserRef.current?.reload();
      return;
    }
    reloadActiveTab();
  }, [activeBrowserTab?.url, browserModeOpen, reloadActiveTab]);

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
    void reloadBookmarks();
  }, [reloadBookmarks]);

  React.useEffect(() => {
    const candidates = collectURLBookmarkItems(bookmarks)
      .filter((item) => {
        return Boolean(item.url) && bookmarkIconDisplayUrls[item.id]?.signature !== getBookmarkIconDisplaySignature(item);
      })
      .slice(0, 24);
    if (!candidates.length) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let updated = false;
      for (const item of candidates) {
        const cacheKey = `${item.id}:${item.url || ''}:${item.iconUrl || ''}`;
        if (bookmarkIconHydrateKeysRef.current.has(cacheKey)) {
          continue;
        }
        bookmarkIconHydrateKeysRef.current.add(cacheKey);
        try {
          const result = await window.electronEmbeddedBrowser.resolveFavicon({
            iconUrl: item.iconUrl || undefined,
            pageUrl: item.url || undefined,
          });
          if (cancelled || !result?.dataUrl) {
            continue;
          }
          cacheResolvedFaviconDataUrl({
            ownerKey: faviconCacheOwnerKey,
            dataUrl: result.dataUrl,
            iconUrl: result.iconUrl || item.iconUrl,
            pageUrl: item.url,
          });
          setBookmarkIconDisplayUrls((current) => ({
            ...current,
            [item.id]: {
              dataUrl: result.dataUrl,
              signature: getBookmarkIconDisplaySignature(item),
            },
          }));
          const sourceIconUrl = getPersistableBookmarkIconUrl(result.iconUrl);
          if (!sourceIconUrl || sourceIconUrl === item.iconUrl) {
            continue;
          }
          await updateBrowserBookmark(item.id, { iconUrl: sourceIconUrl });
          if (cancelled) {
            return;
          }
          updated = true;
          setBookmarkIconDisplayUrls((current) => ({
            ...current,
            [item.id]: {
              dataUrl: result.dataUrl,
              signature: getBookmarkIconDisplaySignature({
                iconUrl: sourceIconUrl,
                url: item.url,
              }),
            },
          }));
          setBookmarks((current) => replaceBookmarkIconInTree(current, item.id, sourceIconUrl));
          setBookmarkMatch((current) => {
            if (!current.bookmark || current.bookmark.id !== item.id) {
              return current;
            }
            return {
              ...current,
              bookmark: {
                ...current.bookmark,
                iconUrl: sourceIconUrl,
              },
            };
          });
        } catch {
          // Keep the old value visible for troubleshooting; the next URL/icon change will retry.
          bookmarkIconHydrateKeysRef.current.delete(cacheKey);
        }
      }
      if (updated && !cancelled) {
        void reloadBookmarks();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookmarkIconDisplayUrls, bookmarks, faviconCacheOwnerKey, reloadBookmarks]);

  React.useEffect(() => {
    void refreshBookmarkMatch(activeBrowserTab?.url || '');
  }, [activeBrowserTab?.url, refreshBookmarkMatch]);

  React.useEffect(() => {
    if (browserModeOpen && activeBrowserTab?.url && bookmarkBarVisible) {
      setBookmarkBarVisible(false);
    }
  }, [activeBrowserTab?.url, bookmarkBarVisible, browserModeOpen]);

  React.useEffect(() => {
    const displayIconUrl = String(activeBrowserTab?.iconUrl || '').trim();
    const sourceIconUrl = getPersistableBookmarkIconUrl(activeBrowserTab?.iconSourceUrl);
    const bookmark = bookmarkMatch.bookmark;
    if (displayIconUrl) {
      cacheResolvedFaviconDataUrl({
        ownerKey: faviconCacheOwnerKey,
        dataUrl: displayIconUrl,
        iconUrl: sourceIconUrl,
        pageUrl: activeBrowserTab?.url,
      });
    }
    if (!bookmarkMatch.matched || !bookmark?.id || (!displayIconUrl && !sourceIconUrl)) {
      return;
    }
    if (displayIconUrl) {
      setBookmarkIconDisplayUrls((current) => (
        current[bookmark.id]?.dataUrl === displayIconUrl
        && current[bookmark.id]?.signature === getBookmarkIconDisplaySignature(bookmark)
          ? current
          : {
            ...current,
            [bookmark.id]: {
              dataUrl: displayIconUrl,
              signature: getBookmarkIconDisplaySignature(bookmark),
            },
          }
      ));
    }
    if (!sourceIconUrl || bookmark.iconUrl === sourceIconUrl) {
      return;
    }
    const syncKey = `${bookmark.id}:${sourceIconUrl}`;
    if (bookmarkIconSyncKeyRef.current === syncKey) {
      return;
    }
    bookmarkIconSyncKeyRef.current = syncKey;
    void updateBrowserBookmark(bookmark.id, { iconUrl: sourceIconUrl })
      .then(() => {
        setBookmarkIconDisplayUrls((current) => {
          const nextSignature = getBookmarkIconDisplaySignature({
            iconUrl: sourceIconUrl,
            url: bookmark.url,
          });
          const currentEntry = current[bookmark.id];
          if (!currentEntry?.dataUrl || currentEntry.signature === nextSignature) {
            return current;
          }
          return {
            ...current,
            [bookmark.id]: {
              ...currentEntry,
              signature: nextSignature,
            },
          };
        });
        setBookmarkMatch((current) => {
          if (!current.bookmark || current.bookmark.id !== bookmark.id) {
            return current;
          }
          return {
            ...current,
            bookmark: {
              ...current.bookmark,
              iconUrl: sourceIconUrl,
            },
          };
        });
        void reloadBookmarks();
      })
      .catch(() => undefined);
  }, [activeBrowserTab?.iconSourceUrl, activeBrowserTab?.iconUrl, activeBrowserTab?.url, bookmarkMatch, faviconCacheOwnerKey, reloadBookmarks]);

  React.useEffect(() => {
    const toolbar = bookmarkToolbarRef.current;
    const container = bookmarkBarListRef.current;
    if (!toolbar && !container) {
      return;
    }
    const syncVisibleCount = () => {
      const availableWidth = Math.max(
        0,
        Number((toolbar ?? container)?.clientWidth || 0) - BOOKMARK_TOOLBAR_HORIZONTAL_PADDING,
      );
      setVisibleBookmarkCount(resolveVisibleBookmarkCount(bookmarks, availableWidth));
    };
    const resizeObserver = new ResizeObserver(syncVisibleCount);
    if (toolbar) {
      resizeObserver.observe(toolbar);
    }
    if (container) {
      resizeObserver.observe(container);
    }
    syncVisibleCount();
    window.addEventListener('resize', syncVisibleCount);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncVisibleCount);
    };
  }, [
    activeBrowserTab?.url,
    bookmarkBarVisible,
    bookmarks,
    browserModeOpen,
    browserResourcePanelVisible,
    browserResourcePanelWidth,
  ]);

  React.useEffect(() => {
    const container = bookmarkBarListRef.current;
    if (!container) {
      return;
    }
    if (container.scrollWidth <= container.clientWidth + 1) {
      return;
    }
    setVisibleBookmarkCount((current) => {
      const renderedCount = Math.min(current, bookmarks.length);
      return Math.max(0, renderedCount - 1);
    });
  }, [
    bookmarks,
    visibleBookmarkCount,
    bookmarkBarVisible,
    browserModeOpen,
    browserResourcePanelVisible,
    browserResourcePanelWidth,
  ]);

  React.useEffect(() => {
    if (!bookmarkContextMenu) {
      return;
    }
    const close = () => setBookmarkContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [bookmarkContextMenu]);

  React.useEffect(() => {
    if (!browserModeOpen) {
      return;
    }
    if (!activeBrowserTab?.url) {
      return;
    }
    window.requestAnimationFrame(() => {
      browserInputRef.current?.focus();
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
      clearBookmarkDragState();
      clearBookmarkMenuDragState();
      saveLibraryDetailWorkspaceState(workspaceCacheKey, latestWorkspaceStateRef.current);
      void window.electronEmbeddedBrowser.deactivate();
    };
  }, [clearBookmarkDragState, clearBookmarkMenuDragState, clearBrowserTabDragState, workspaceCacheKey]);

  const visibleBookmarks = bookmarks.slice(0, Math.min(visibleBookmarkCount, bookmarks.length));
  const overflowBookmarks = bookmarks.slice(visibleBookmarks.length);

  const renderBookmarkButton = (item: BrowserBookmarkItem) => {
    const isFolder = item.kind === 'folder';
    const dropClass = bookmarkDropTarget?.bookmarkId === item.id && draggingBookmarkId !== item.id
      ? ` drop-${bookmarkDropTarget.position}`
      : '';
    const button = (
      <button
        key={item.id}
        ref={(element) => {
          if (element) {
            bookmarkButtonRefMap.current.set(item.id, element);
          } else {
            bookmarkButtonRefMap.current.delete(item.id);
          }
        }}
        type="button"
        className={`bookmark-item${draggingBookmarkId === item.id ? ' dragging' : ''}${dropClass}`}
        title={item.title}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setBookmarkContextMenu({ item, x: event.clientX, y: event.clientY });
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          pendingBookmarkDragRef.current = {
            bookmarkId: item.id,
            started: false,
          };
          setBookmarkDropTarget(null);
          detachBookmarkDragListeners();

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const pending = pendingBookmarkDragRef.current;
            if (!pending || pending.bookmarkId !== item.id) {
              return;
            }
            if (!pending.started) {
              if (Math.abs(moveEvent.clientX - event.clientX) < 6) {
                return;
              }
              pending.started = true;
              setDraggingBookmarkId(item.id);
              bookmarkClickBlockUntilRef.current = Date.now() + 180;
            }
            setBookmarkDropTarget(resolveBookmarkDropTarget(moveEvent.clientX, item.id));
          };

          const handleMouseUp = (upEvent: MouseEvent) => {
            const pending = pendingBookmarkDragRef.current;
            if (pending?.started) {
              const finalDropTarget = resolveBookmarkDropTarget(upEvent.clientX, item.id);
              if (finalDropTarget) {
                void moveRootBookmark(item.id, finalDropTarget);
              }
            }
            clearBookmarkDragState();
          };

          bookmarkMouseMoveListenerRef.current = handleMouseMove;
          bookmarkMouseUpListenerRef.current = handleMouseUp;
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
        }}
        onClick={() => {
          if (Date.now() < bookmarkClickBlockUntilRef.current) {
            return;
          }
          if (!isFolder) {
            openBookmarkURL(item);
          }
        }}
      >
        <BookmarkVisual cacheOwnerKey={faviconCacheOwnerKey} displayIcon={getResolvedBookmarkDisplayIcon(item)} item={item} />
        <span className="bookmark-title">{item.title || item.url || '未命名'}</span>
      </button>
    );

    if (!isFolder) {
      return button;
    }
    return (
      <Popover
        key={item.id}
        trigger="click"
        showArrow={false}
        position="bottomLeft"
        spacing={6}
        getPopupContainer={getAppPopupContainer}
          content={
            <ContextMenu
              items={buildBookmarkFolderMenuItems(item.children || [], item.id)}
              className="directory-context-menu bookmark-folder-context-menu"
            />
          }
        >
        {button}
      </Popover>
    );
  };

  const moveBookmarkInManager = async (
    item: BrowserBookmarkItem,
    siblings: BrowserBookmarkItem[],
    index: number,
    direction: 'up' | 'down',
    parentId: number | null,
  ) => {
    const target = direction === 'up' ? siblings[index - 1] : siblings[index + 1];
    if (!target) {
      return;
    }
    try {
      await moveBrowserBookmark(item.id, {
        parentId,
        beforeId: direction === 'up' ? target.id : null,
        afterId: direction === 'down' ? target.id : null,
      });
      await reloadBookmarks();
    } catch (error: any) {
      Toast.error(error?.message || '书签移动失败');
    }
  };

  const renderBookmarkManagerRows = (
    items: BrowserBookmarkItem[],
    depth = 0,
    parentId: number | null = null,
  ): React.ReactNode => {
    if (!items.length && depth === 0) {
      return <div className="bookmark-manager-empty">暂无书签</div>;
    }
    return items.map((item, index) => (
      <React.Fragment key={item.id}>
        <div className="bookmark-manager-row" style={{ paddingLeft: 8 + depth * 18 }}>
          {item.kind === 'folder' ? (
            <button
              type="button"
              className="bookmark-manager-disclosure"
              onClick={() => toggleBookmarkFolderCollapsed(item.id)}
              title={collapsedBookmarkFolderIds.includes(item.id) ? '展开文件夹' : '收起文件夹'}
            >
              <span className={`bookmark-manager-disclosure-icon ${collapsedBookmarkFolderIds.includes(item.id) ? '' : 'expanded'}`}>
                <IconArrowRight size="small" />
              </span>
            </button>
          ) : (
            <span className="bookmark-manager-disclosure placeholder" aria-hidden="true" />
          )}
          <BookmarkVisual cacheOwnerKey={faviconCacheOwnerKey} displayIcon={getResolvedBookmarkDisplayIcon(item)} item={item} />
          <div className="bookmark-manager-body">
            <span className="bookmark-manager-title" title={item.title || item.url || ''}>
              {item.title || item.url || '未命名'}
            </span>
            <span className="bookmark-manager-meta" title={item.kind === 'folder' ? '' : item.url || ''}>
              {getBookmarkManagerMeta(item)}
            </span>
          </div>
          <span className="bookmark-manager-actions">
            {item.kind === 'folder' ? (
              <>
                <button
                  type="button"
                  className="bookmark-manager-action"
                  onClick={() => openBookmarkCreate('url', item.id)}
                >
                  新建书签
                </button>
                <button
                  type="button"
                  className="bookmark-manager-action"
                  onClick={() => openBookmarkCreate('folder', item.id)}
                >
                  新建文件夹
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="bookmark-manager-action"
              disabled={index === 0}
              onClick={() => {
                void moveBookmarkInManager(item, items, index, 'up', parentId);
              }}
            >
              上移
            </button>
            <button
              type="button"
              className="bookmark-manager-action"
              disabled={index >= items.length - 1}
              onClick={() => {
                void moveBookmarkInManager(item, items, index, 'down', parentId);
              }}
            >
              下移
            </button>
            <button
              type="button"
              className="bookmark-manager-action"
              onClick={() => openBookmarkEdit(item)}
            >
              编辑
            </button>
            <button
              type="button"
              className="bookmark-manager-action danger"
              onClick={() => {
                void removeBookmark(item);
              }}
            >
              删除
            </button>
          </span>
        </div>
        {item.children?.length && !collapsedBookmarkFolderIds.includes(item.id)
          ? renderBookmarkManagerRows(item.children, depth + 1, item.id)
          : null}
      </React.Fragment>
    ));
  };

  const detailWrapperStyle = {
    '--side-panel-visual-width': `${sidePanelVisualWidth}px`,
  } as React.CSSProperties;

  return (
    <>
      <LibraryWorkspaceControlsContext.Provider value={libraryWorkspaceControls}>
        <SidePanelMotionProperty />
        <DetailWrapper
          className={sidePanelResizing ? 'is-side-panel-resizing' : ''}
          style={detailWrapperStyle}
        >
      <TitlebarSidePanelToggleHost>
        <TitlebarSidePanelToggleButton
          type="button"
          className={sidePanelCollapsed ? 'is-active' : ''}
          disabled={videoWideModeActive}
          onClick={toggleSidePanelCollapsed}
          title={videoWideModeActive ? '宽屏模式下请在播放器内退出宽屏' : (sidePanelCollapsed ? '展开目录树' : '折叠目录树')}
          aria-label={videoWideModeActive ? '宽屏模式下目录树按钮暂不可用' : (sidePanelCollapsed ? '展开目录树' : '折叠目录树')}
          aria-pressed={sidePanelCollapsed}
        >
          <SidebarCollapseIcon />
        </TitlebarSidePanelToggleButton>
      </TitlebarSidePanelToggleHost>
      <SidePanel ref={sidePanelRef}>
        <SidePanelHeader />

        <SidePanelTree>
          <DirectorySidebar
            ref={directorySidebarRef}
            libraryId={libraryId}
            onFileOpen={handleFileOpen}
            onSelectionChange={(payload) => {
              setSelectedTreeNode(payload.primaryNode);
              setTreeRootNodeId(payload.rootNodeId);
            }}
            onOpenFileInBrowser={handleOpenFileInBrowser}
            browserModeOpen={browserModeOpen}
          />
        </SidePanelTree>

        <SidePanelFooter>
          <div className="footer-left">
            <button
              className="footer-btn"
              onClick={() => navigate("/libraries")}
              title="返回库列表"
            >
              <IconHome />
            </button>
            <button
              className="footer-btn"
              onClick={() => navigate("/upload-center")}
              title="上传中心"
            >
              <IconUpload />
            </button>
            <button
              className="footer-btn"
              onClick={() => navigate(`/libraries/${libraryId}/recycle-bin`)}
              title="回收站"
            >
              <IconDelete />
            </button>
            <button
              className="footer-btn"
              onClick={() => navigate("/settings")}
              title="设置"
            >
              <IconSetting />
            </button>
          </div>
        </SidePanelFooter>
        {sidePanelVisualWidth > 0 ? <ResizeHandle onMouseDown={handleResizeMouseDown} /> : null}
      </SidePanel>

      <ContentArea>
        <ContentToolbar>
          <div className="toolbar-left">
            <button
              type="button"
              className={`toolbar-action-btn ${workspaceDisplayMode === 'search-home' ? 'is-active' : ''}`}
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
                title={activeTabId ? '打开文件模式' : '暂无打开的文件'}
                disabled={!activeTabId}
              >
                <IconFolder />
              </button>
            ) : workspaceDisplayMode === 'file-viewer' && showBackToArchive && archiveReturnTarget ? (
              <button
                type="button"
                className="toolbar-action-btn is-archive-return"
                onClick={handleArchiveReturn}
                title="返回上一级"
              >
                <ArchiveReturnIconSlot>
                  <IconArrowLeft />
                </ArchiveReturnIconSlot>
              </button>
            ) : (
              <button
                type="button"
                className={`toolbar-action-btn ${workspaceDisplayMode === 'file-viewer' ? 'is-active' : ''}`}
                onClick={openFileWorkspace}
                title={activeTabId ? '打开文件模式' : '暂无打开的文件'}
                disabled={!activeTabId}
              >
                <IconFolder />
              </button>
            )}
            <button
              type="button"
              className={`toolbar-action-btn ${workspaceDisplayMode === 'tools' ? 'is-active' : ''}`}
              onClick={openToolsWorkspace}
              title="打开工具区"
            >
              <IconWrench />
            </button>
            {!browserModeOpen ? (
              <button
                type="button"
                className={`toolbar-action-btn ${workspaceDisplayMode === 'browser' ? 'is-active' : ''}`}
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
                    <BrowserTabVisual cacheOwnerKey={faviconCacheOwnerKey} tab={tab} />
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
                <button
                  type="button"
                  className="browser-tabs-add"
                  onClick={createAndActivateBrowserTab}
                  title="新建浏览器标签"
                >
                  <IconPlus />
                </button>
              </div>
            ) : null}
          </div>
          <div className="toolbar-right">
            {mediaEntries.length > 0 ? (
              <Popover
                trigger="click"
                showArrow={false}
                position="bottomRight"
                spacing={6}
                getPopupContainer={getAppPopupContainer}
                content={
                  <MediaHubPopover
                    entries={mediaEntries}
                    onActivate={(tabId) => {
                      activateTab(tabId);
                      openFileWorkspace();
                    }}
                    onToggle={(entry) => {
                      if (entry.isPlaying) {
                        mediaRegistry.pause(entry.entryId);
                      } else {
                        void mediaRegistry.play(entry.entryId);
                      }
                    }}
                    onSeek={(entry, time) => {
                      mediaRegistry.seek(entry.entryId, time);
                    }}
                    onDismiss={(entry) => {
                      mediaRegistry.dismiss(entry.entryId);
                    }}
                  />
                }
              >
                <button
                  type="button"
                  className="toolbar-action-btn"
                  title="正在播放的媒体"
                >
                  <IconMusic />
                </button>
              </Popover>
            ) : null}
            {browserModeOpen ? null : (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={handleToolbarRefresh}
                title="刷新当前标签页"
                disabled={!activeTabId || workspaceDisplayMode === 'tools'}
              >
                <IconRefresh />
              </button>
            )}
          </div>
        </ContentToolbar>
        {browserModeOpen && !activeBrowserTabIsSettings ? (
          <>
            <ContentToolbar className="browser-url-toolbar">
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
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </form>
              </div>
              <div className="toolbar-right">
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={toggleActiveBookmark}
                  title={bookmarkMatch.matched ? '取消收藏' : '加入书签栏'}
                  disabled={!String(activeBrowserTab?.url || '').trim()}
                >
                  {bookmarkMatch.matched ? <IconStar /> : <IconStarStroked />}
                </button>
                <button
                  type="button"
                  className={`toolbar-action-btn ${browserResourcePanelVisible ? 'is-active' : ''}`}
                  onClick={toggleBrowserResourcePanel}
                  title={browserResourcePanelVisible ? '折叠资源捕获面板' : '展开资源捕获面板'}
                  aria-label={browserResourcePanelVisible ? '折叠资源捕获面板' : '展开资源捕获面板'}
                >
                  <IconPulse />
                </button>
                <button
                  type="button"
                  className="toolbar-action-btn"
                  onClick={openBrowserSettings}
                  title="浏览器设置"
                  aria-label="浏览器设置"
                >
                  <IconSetting size="large" />
                </button>
              </div>
            </ContentToolbar>
            {bookmarkBarVisible && !activeBrowserTab?.url ? (
              <BookmarkToolbar
                ref={bookmarkToolbarRef}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setBookmarkContextMenu({ item: null, x: event.clientX, y: event.clientY });
                }}
              >
                <div ref={bookmarkBarListRef} className="bookmark-bar-list">
                  {visibleBookmarks.map((item) => renderBookmarkButton(item))}
                </div>
                {overflowBookmarks.length ? (
                  <Popover
                    trigger="click"
                    showArrow={false}
                    position="bottomRight"
                    spacing={6}
                    getPopupContainer={getAppPopupContainer}
                    content={
                      <ContextMenu
                        items={buildBookmarkFolderMenuItems(overflowBookmarks)}
                        className="directory-context-menu bookmark-folder-context-menu"
                      />
                    }
                  >
                    <button type="button" className="bookmark-more-btn" title="更多书签">
                      <IconMore />
                    </button>
                  </Popover>
                ) : null}
              </BookmarkToolbar>
            ) : null}
          </>
        ) : null}
        {pendingCredential && workspaceDisplayMode === 'browser' && !activeBrowserTabIsSettings ? (
          <EmbeddedBrowserPasswordSaveBar
            credentialRequestId={pendingCredential.credentialRequestId}
            domain={pendingCredential.domain}
            username={pendingCredential.username}
            onDismiss={() => setPendingCredential(null)}
          />
        ) : !pendingCredential && autoFilledCredential && workspaceDisplayMode === 'browser' && !activeBrowserTabIsSettings ? (
          <EmbeddedBrowserAutoFillBar
            tabId={autoFilledCredential.tabId}
            filledUsername={autoFilledCredential.filledUsername}
            alternatives={autoFilledCredential.alternatives}
            onDismiss={() => setAutoFilledCredential(null)}
            onUsernameFilled={(username) => setAutoFilledCredential((prev) =>
              prev ? { ...prev, filledUsername: username } : null
            )}
          />
        ) : null}
        <ContentBody>
          <div
            className={`workspace-pane ${workspaceDisplayMode === 'file-viewer' ? 'active' : 'inactive'}`}
            aria-hidden={workspaceDisplayMode !== 'file-viewer'}
          >
            <AppMain hideTabsBar={false} workspaceActive={workspaceDisplayMode === 'file-viewer'} />
          </div>
          {workspaceDisplayMode === 'browser' ? (
            <div className="workspace-pane active">
              <BrowserWorkspace>
                <BrowserWorkspaceMain>
                  {activeBrowserTabIsSettings ? (
                    <BrowserSettingsWorkspace
                      section={browserSettingsSection}
                      onSectionChange={setBrowserSettingsSection}
                    />
                  ) : (
                    <EmbeddedBrowserPanel
                      ref={browserRef}
                      activeTabId={activeBrowserTabId}
                      boundsSyncDurationMs={SIDE_PANEL_COLLAPSE_ANIMATION_MS}
                      boundsSyncSignal={sidePanelMotionSyncSignal}
                      currentUrl={
                        activeBrowserTab?.url ?? ''
                      }
                      pendingFileOpen={
                        activeBrowserTabId
                          ? pendingBrowserFileOpenByTabId[activeBrowserTabId] ?? null
                          : null
                      }
                      onPendingFileOpenHandled={(tabId) => {
                        clearPendingBrowserFileOpen(tabId);
                      }}
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
                  )}
                </BrowserWorkspaceMain>
                {browserResourcePanelVisible && !activeBrowserTabIsSettings ? (
                  <BrowserWorkspaceAside
                    ref={browserResourcePanelRef}
                    style={{ width: `${browserResourcePanelWidth}px` }}
                  >
                    <BrowserWorkspaceAsideResizeHandle
                      onMouseDown={handleBrowserResourcePanelResizeMouseDown}
                    />
                    <EmbeddedBrowserResourcePanel
                      activeTabId={activeBrowserTabId}
                      currentPageUrl={activeBrowserTab?.url ?? ''}
                      onOpenHlsDownloadWorkspace={openHlsDownloadWorkspace}
                      onOpenMpdDownloadWorkspace={openMpdDownloadWorkspace}
                      onOpenMediaProcessing={openMediaProcessingWorkspace}
                    />
                  </BrowserWorkspaceAside>
                ) : null}
              </BrowserWorkspace>
            </div>
          ) : workspaceDisplayMode === 'search-home' ? (
            <div className="workspace-pane active">
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
            </div>
          ) : workspaceDisplayMode === 'tools' ? (
            <div className="workspace-pane active">
              <ToolWorkspace
                libraryId={libraryId}
                mediaProcessingRequest={mediaProcessingRequest}
                onRefreshDirectory={(directoryId) => (
                  directorySidebarRef.current?.refreshNodeSubtree(directoryId)
                )}
                rootNodeId={treeRootNodeId}
                selectedTreeNode={selectedTreeNode}
              />
            </div>
          ) : null}
        </ContentBody>
      </ContentArea>
      {bookmarkContextMenu ? (
        <BookmarkContextMenuLayer
          style={{ left: bookmarkContextMenu.x, top: bookmarkContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <ContextMenu
            items={buildBookmarkContextMenuItems(bookmarkContextMenu.item)}
            className="directory-context-menu"
            onItemClick={closeBookmarkContextMenu}
          />
        </BookmarkContextMenuLayer>
      ) : null}
      <Modal
        title={
          bookmarkEditDraft?.item
            ? (bookmarkEditDraft.kind === 'folder' ? '编辑文件夹' : '编辑书签')
            : (bookmarkEditDraft?.kind === 'folder' ? '新建文件夹' : '新建书签')
        }
        visible={Boolean(bookmarkEditDraft)}
        onCancel={() => setBookmarkEditDraft(null)}
        onOk={() => {
          void saveBookmarkEditDraft();
        }}
        okText="保存"
        cancelText="取消"
      >
        {bookmarkEditDraft ? (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={(event) => {
              event.preventDefault();
              void saveBookmarkEditDraft();
            }}
          >
            <Input
              value={bookmarkEditDraft.title}
              placeholder="名称"
              onChange={(value) => setBookmarkEditDraft((draft) => draft ? { ...draft, title: value } : draft)}
            />
            <Select
              value={bookmarkEditDraft.parentId == null ? ROOT_BOOKMARK_PARENT_VALUE : String(bookmarkEditDraft.parentId)}
              onChange={(value) => {
                const nextValue = String(value);
                setBookmarkEditDraft((draft) => draft ? {
                  ...draft,
                  parentId: nextValue === ROOT_BOOKMARK_PARENT_VALUE ? null : Number(nextValue),
                } : draft);
              }}
            >
              {bookmarkParentOptions.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
            {bookmarkEditDraft.kind === 'url' ? (
              <>
                <Input
                  value={bookmarkEditDraft.url}
                  placeholder="网址"
                  onChange={(value) => setBookmarkEditDraft((draft) => draft ? { ...draft, url: value } : draft)}
                />
                <Input
                  value={bookmarkEditDraft.iconUrl}
                  placeholder="图标地址"
                  onChange={(value) => setBookmarkEditDraft((draft) => draft ? { ...draft, iconUrl: value } : draft)}
                />
              </>
            ) : null}
          </form>
        ) : null}
      </Modal>
      <Modal
        title="书签管理"
        visible={bookmarkManagerOpen}
        onCancel={() => setBookmarkManagerOpen(false)}
        footer={null}
        width={860}
      >
        <BookmarkManagerContent>
          <div className="bookmark-manager-toolbar">
            <div className="bookmark-manager-toolbar-actions">
              <button
                type="button"
                className="bookmark-manager-action"
                onClick={() => openBookmarkCreate('url')}
              >
                新建书签
              </button>
              <button
                type="button"
                className="bookmark-manager-action"
                onClick={() => openBookmarkCreate('folder')}
              >
                新建文件夹
              </button>
            </div>
            <div className="bookmark-manager-toolbar-right">
              <button
                type="button"
                className="bookmark-manager-action"
                onClick={expandAllBookmarkFolders}
                disabled={!bookmarkFolderIds.length || collapsedBookmarkFolderIds.length === 0}
              >
                展开全部
              </button>
              <button
                type="button"
                className="bookmark-manager-action"
                onClick={collapseAllBookmarkFolders}
                disabled={!bookmarkFolderIds.length || collapsedBookmarkFolderIds.length === bookmarkFolderIds.length}
              >
                收起全部
              </button>
            </div>
          </div>
          {renderBookmarkManagerRows(bookmarks)}
        </BookmarkManagerContent>
      </Modal>
      <EmbeddedBrowserDownloadImportModal
        download={activeBrowserDownload}
        importLoading={importingBrowserDownload}
        savingLoading={savingBrowserDownload}
        libraryId={libraryId}
        onCancel={() => {
          void closeActiveDownload({ discardFile: true });
        }}
        onConfirm={(targetFolder) => {
          void importActiveDownload(targetFolder);
        }}
        onSaveToDesktop={() => {
          void saveActiveDownloadToDesktop();
        }}
      />
        </DetailWrapper>
      </LibraryWorkspaceControlsContext.Provider>
    </>
  );
};

const LibraryDetail: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const libraryId = Number(id);
  const cacheKey = `library:${id}`;

  return (
    <FileViewerProvider key={cacheKey} cacheKey={cacheKey}>
      <MediaRegistryProvider>
        <LibraryDetailContent key={id} libraryId={libraryId} />
      </MediaRegistryProvider>
    </FileViewerProvider>
  );
};

export default LibraryDetail;

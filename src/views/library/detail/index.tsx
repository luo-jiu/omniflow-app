import AppMain from "@/components/business/app-main";
import { DirectorySidebar } from "@/features/file-explorer";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileViewerProvider } from "@/contexts/FileViewerContext";
import { useFileViewer } from "@/hooks/useFileViewer";
import { IconHome, IconUpload, IconDelete, IconChevronLeft, IconRefresh, IconPlus, IconClose } from "@douyinfe/semi-icons";
import styled from "styled-components";
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
  }

  .toolbar-back-btn .semi-icon {
    font-size: 16px;
  }

  .toolbar-back-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }

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

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { setFileUrl, tabs, activeTabId, fileState, reloadActiveTab } = useFileViewer();
  const navigate = useNavigate();
  const sidePanelRef = React.useRef<HTMLDivElement>(null);
  const browserRef = React.useRef<EmbeddedBrowserHandle | null>(null);
  const [sidePanelWidth, setSidePanelWidth] = React.useState<number>(() => loadSidePanelWidth(libraryId));
  const [browserModeOpen, setBrowserModeOpen] = React.useState(false);
  const [browserUrl, setBrowserUrl] = React.useState('');
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

  const normalizeBrowserUrl = React.useCallback((input: string) => {
    const trimmed = String(input || '').trim();
    if (!trimmed) {
      return '';
    }
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }, []);

  const openEmbeddedBrowser = React.useCallback(() => {
    setBrowserModeOpen(true);
    setBrowserInput((prev) => prev || browserUrl);
  }, [browserUrl]);

  const closeEmbeddedBrowser = React.useCallback(() => {
    setBrowserModeOpen(false);
  }, []);

  const handleBrowserSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(browserInput);
    if (!nextUrl) {
      return;
    }
    setBrowserUrl(nextUrl);
    setBrowserInput(nextUrl);
    setBrowserModeOpen(true);
    browserRef.current?.navigate(nextUrl);
  }, [browserInput, normalizeBrowserUrl]);

  const handleToolbarRefresh = React.useCallback(() => {
    if (browserModeOpen) {
      browserRef.current?.reload();
      return;
    }
    reloadActiveTab();
  }, [browserModeOpen, reloadActiveTab]);

  React.useEffect(() => {
    if (!browserModeOpen) {
      return;
    }
    window.requestAnimationFrame(() => {
      browserInputRef.current?.focus();
      browserInputRef.current?.select();
    });
  }, [browserModeOpen]);

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
        <ContentToolbar>
          <div className="toolbar-left">
            {showBackToArchive && archiveReturnTarget ? (
              <button
                type="button"
                className="toolbar-back-btn"
                onClick={() => {
                  setFileUrl(
                    archiveReturnTarget.fileUrl,
                    archiveReturnTarget.fileName,
                    archiveReturnTarget.fileType,
                    archiveReturnTarget.nodeId,
                    { tabTypeLabel: archiveReturnTarget.tabTypeLabel ?? null },
                  );
                }}
                title="返回"
              >
                <IconChevronLeft />
                返回
              </button>
            ) : null}
          </div>
          <div className="toolbar-spacer">
            {browserModeOpen ? (
              <form className="toolbar-browser-form" onSubmit={handleBrowserSubmit}>
                <input
                  ref={browserInputRef}
                  className="toolbar-browser-input"
                  value={browserInput}
                  onChange={(event) => setBrowserInput(event.target.value)}
                  placeholder="输入网址后回车"
                />
              </form>
            ) : null}
          </div>
          <div className="toolbar-right">
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={openEmbeddedBrowser}
              title="打开内置浏览器"
            >
              <IconPlus />
            </button>
            {browserModeOpen ? (
              <button
                type="button"
                className="toolbar-action-btn"
                onClick={closeEmbeddedBrowser}
                title="关闭内置浏览器"
              >
                <IconClose />
              </button>
            ) : null}
            <button
              type="button"
              className="toolbar-action-btn"
              onClick={handleToolbarRefresh}
              title={browserModeOpen ? "刷新网页" : "刷新当前标签页"}
              disabled={!browserModeOpen && !activeTabId}
            >
              <IconRefresh />
            </button>
          </div>
        </ContentToolbar>
        <ContentBody>
          {browserModeOpen ? (
            <EmbeddedBrowserPanel
              ref={browserRef}
              url={browserUrl}
              onUrlChange={(nextUrl) => {
                setBrowserUrl(nextUrl);
                setBrowserInput(nextUrl);
              }}
            />
          ) : (
            <AppMain />
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

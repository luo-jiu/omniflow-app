import AppMain from "@/components/business/app-main";
import {
  DirectorySidebar,
  type DirectorySidebarHandle,
  type SelectedTreeNode,
} from "@/features/file-explorer";
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileViewerProvider } from "@/contexts/FileViewerContext";
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
} from "@douyinfe/semi-icons";
import { Input, Modal, Popover, Select, Toast } from '@douyinfe/semi-ui';
import styled, { css } from "styled-components";
import ContextMenu, { type ContextMenuItem } from "@/components/ui/context-menu";
import EmbeddedBrowserPanel, { type EmbeddedBrowserHandle } from "@/features/embedded-browser/components/EmbeddedBrowserPanel";
import EmbeddedBrowserDownloadImportModal from "@/features/embedded-browser/downloads/components/EmbeddedBrowserDownloadImportModal";
import { useEmbeddedBrowserDownloadImport } from "@/features/embedded-browser/downloads/hooks/useEmbeddedBrowserDownloadImport";
import EmbeddedBrowserResourcePanel from "@/features/embedded-browser/resources/components/EmbeddedBrowserResourcePanel";
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
  getURLHost,
  isURLBookmark,
  replaceBookmarkIconInTree,
  resolveVisibleBookmarkCount,
  ROOT_BOOKMARK_PARENT_VALUE,
} from "@/features/embedded-browser/bookmarks/tree";
import {
  cacheResolvedFaviconDataUrl,
  getCachedFaviconDataUrl,
} from "@/features/embedded-browser/services/favicon-cache";
import { getFileLink } from '@/features/file-explorer/services/file.api';
import { resolveBrowserFileMapping } from '@/features/browser-file-mappings/services/browser-file-mapping.api';
import { getAppPopupContainer } from '@/utils/popup-container';
import { useAuth } from '@/hooks/useAuth';
import SearchWorkspace, { type SearchWorkspaceMode } from "./SearchWorkspace";
import ToolWorkspace from "@/features/tool-workspace";
import {
  loadLibraryDetailWorkspaceState,
  saveLibraryDetailWorkspaceState,
  type BrowserTab,
  type LibraryDetailWorkspaceState,
  type WorkspaceDisplayMode,
} from "./workspace-state";
import type { FileViewerFileType } from '@/shared/file-viewer-types';

const DEFAULT_SIDE_PANEL_WIDTH = 300;
const MIN_SIDE_PANEL_WIDTH = 220;
const DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH = 360;
const MIN_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
const MAX_BROWSER_RESOURCE_PANEL_WIDTH = DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH * 2;
const SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT = 37;
const SIDE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:side-panel-width:';
const BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX = 'library-detail:browser-resource-panel-width:';
const CONTENT_TOOLBAR_HEIGHT = 46;
const TOOLBAR_ACTION_BUTTON_SIZE = 36;
const TOOLBAR_ACTION_ICON_SIZE = 18;
const BROWSER_TAB_ICON_SIZE = 20;
const BROWSER_TAB_FONT_SIZE = 16;
const BOOKMARK_ICON_SIZE = 20;
const BOOKMARK_FONT_SIZE = 17;
const BROWSER_INPUT_FONT_SIZE = 18;
const BROWSER_TAB_HEIGHT = 38;
const BOOKMARK_TOOLBAR_HEIGHT = 42;
const BOOKMARK_ITEM_HEIGHT = 38;
const BROWSER_INPUT_HEIGHT = 38;
const BOOKMARK_TOOLBAR_HORIZONTAL_PADDING = 20;

function getSidePanelWidthStorageKey(libraryId: number) {
  return `${SIDE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
}

function getBrowserResourcePanelWidthStorageKey(libraryId: number) {
  return `${BROWSER_RESOURCE_PANEL_WIDTH_STORAGE_PREFIX}${libraryId}`;
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

function loadBrowserResourcePanelWidth(libraryId: number): number {
  const raw = localStorage.getItem(getBrowserResourcePanelWidthStorageKey(libraryId));
  if (!raw) return DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_BROWSER_RESOURCE_PANEL_WIDTH;
  return Math.max(
    MIN_BROWSER_RESOURCE_PANEL_WIDTH,
    Math.min(MAX_BROWSER_RESOURCE_PANEL_WIDTH, Math.floor(parsed)),
  );
}

function saveBrowserResourcePanelWidth(libraryId: number, width: number) {
  localStorage.setItem(
    getBrowserResourcePanelWidthStorageKey(libraryId),
    String(
      Math.max(
        MIN_BROWSER_RESOURCE_PANEL_WIDTH,
        Math.min(MAX_BROWSER_RESOURCE_PANEL_WIDTH, Math.floor(width)),
      ),
    ),
  );
}

const ArchiveReturnIconSlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;

  svg,
  svg path {
    fill: #16a34a;
    stroke: #16a34a;
  }

  body[theme-mode="dark"] & svg,
  body[theme-mode="dark"] & svg path {
    fill: #4ade80;
    stroke: #4ade80;
  }
`;

const DetailWrapper = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
`;

const SidePanel = styled.div`
  position: relative;
  width: ${DEFAULT_SIDE_PANEL_WIDTH}px;
  min-width: ${MIN_SIDE_PANEL_WIDTH}px;
  max-width: 80vw;
  display: flex;
  flex-direction: column;
  background: var(--app-sidebar-vibrancy);
  flex-shrink: 0;
  height: 100%;

  body[theme-mode="dark"] & {
    background: var(--app-sidebar-vibrancy);
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
  background: transparent;
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

  .toolbar-action-btn.is-active {
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
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

  .browser-tabs-add {
    position: sticky;
    right: 0;
    z-index: 1;
    width: 34px;
    height: 34px;
    margin-left: 4px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg) 92%, transparent);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    -webkit-app-region: no-drag;
    backdrop-filter: blur(8px);
  }

  .browser-tabs-add .semi-icon {
    font-size: 18px;
  }

  .browser-tabs-add:hover {
    background: var(--app-bg-elevated);
    color: var(--app-text);
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

  .browser-tab-favicon {
    width: ${BROWSER_TAB_ICON_SIZE}px;
    height: ${BROWSER_TAB_ICON_SIZE}px;
    flex-shrink: 0;
  }

  .browser-tab-favicon {
    border-radius: 4px;
    object-fit: contain;
  }

  .browser-tab-favicon.favicon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8c9099;
    background: rgba(140, 144, 153, 0.08);
  }

  .browser-tab-favicon.favicon-fallback .semi-icon {
    font-size: 15px;
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
    font-size: ${BROWSER_TAB_FONT_SIZE}px;
    line-height: 1.2;
    font-weight: 500;
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

  .browser-tab-close .semi-icon {
    font-size: 15px;
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
    font-size: ${BROWSER_INPUT_FONT_SIZE}px;
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

const BookmarkToolbar = styled.div`
  height: ${BOOKMARK_TOOLBAR_HEIGHT}px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-bg) 94%, var(--semi-color-fill-0) 6%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  -webkit-app-region: no-drag;

  .bookmark-bar-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .bookmark-item {
    height: ${BOOKMARK_ITEM_HEIGHT}px;
    min-width: 0;
    max-width: 180px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 11px;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
  }

  .bookmark-item:hover,
  .bookmark-more-btn:hover {
    background: var(--semi-color-fill-0);
    border-color: var(--app-border);
  }

  .bookmark-item.dragging {
    opacity: 0.62;
  }

  .bookmark-item.drop-before {
    box-shadow: inset 2px 0 0 var(--semi-color-primary);
  }

  .bookmark-item.drop-after {
    box-shadow: inset -2px 0 0 var(--semi-color-primary);
  }

  .bookmark-item.drop-inside {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .bookmark-favicon {
    width: ${BOOKMARK_ICON_SIZE}px;
    height: ${BOOKMARK_ICON_SIZE}px;
    border-radius: 4px;
    flex-shrink: 0;
    object-fit: contain;
    display: block;
    align-self: center;
  }

  .bookmark-favicon.favicon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8c9099;
    background: rgba(140, 144, 153, 0.08);
  }

  .bookmark-favicon.favicon-fallback .semi-icon {
    font-size: 15px;
  }

  .bookmark-folder-glyph {
    width: ${BOOKMARK_ICON_SIZE}px;
    height: ${BOOKMARK_ICON_SIZE}px;
    flex-shrink: 0;
    position: relative;
    display: inline-block;
  }

  .bookmark-folder-glyph::before {
    content: "";
    position: absolute;
    left: 1px;
    top: 7px;
    width: 17px;
    height: 11px;
    border-radius: 3px;
    border: 1.5px solid currentColor;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-folder-glyph::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    width: 10px;
    height: 6px;
    border: 1.5px solid currentColor;
    border-bottom: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: ${BOOKMARK_FONT_SIZE}px;
    line-height: 1.2;
    font-weight: 500;
  }

  .bookmark-more-btn {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .bookmark-more-btn .semi-icon {
    font-size: 18px;
  }
`;

const BookmarkContextMenuLayer = styled.div`
  position: fixed;
  z-index: 3000;

  .bookmark-favicon,
  .bookmark-folder-glyph {
    width: ${BOOKMARK_ICON_SIZE}px;
    height: ${BOOKMARK_ICON_SIZE}px;
    flex-shrink: 0;
    position: relative;
    display: inline-block;
    color: var(--app-text-muted);
  }

  .bookmark-favicon {
    border-radius: 4px;
    object-fit: contain;
    display: block;
    align-self: center;
  }

  .bookmark-favicon.favicon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8c9099;
    background: rgba(140, 144, 153, 0.08);
  }

  .bookmark-favicon.favicon-fallback .semi-icon {
    font-size: 15px;
  }

  .bookmark-folder-glyph::before {
    content: "";
    position: absolute;
    left: 1px;
    top: 7px;
    width: 17px;
    height: 11px;
    border-radius: 3px;
    border: 1.5px solid currentColor;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-folder-glyph::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    width: 10px;
    height: 6px;
    border: 1.5px solid currentColor;
    border-bottom: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    box-sizing: border-box;
  }
`;

const BookmarkManagerContent = styled.div`
  min-height: 460px;
  max-height: 520px;
  overflow: auto;
  padding: 2px 0;

  .bookmark-manager-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 4px 12px;
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--app-bg);
  }

  .bookmark-manager-toolbar-actions,
  .bookmark-manager-toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .bookmark-manager-empty {
    color: var(--app-text-muted);
    padding: 18px 4px;
    text-align: center;
  }

  .bookmark-manager-row {
    min-height: 42px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
  }

  .bookmark-manager-row:hover {
    background: var(--semi-color-fill-0);
  }

  .bookmark-manager-disclosure {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }

  .bookmark-manager-disclosure.placeholder {
    cursor: default;
    opacity: 0;
  }

  .bookmark-manager-disclosure:hover {
    background: var(--semi-color-fill-1);
  }

  .bookmark-manager-disclosure-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .bookmark-manager-disclosure-icon.expanded {
    transform: rotate(90deg);
  }

  .bookmark-favicon,
  .bookmark-folder-glyph {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .bookmark-favicon {
    border-radius: 4px;
    object-fit: contain;
  }

  .bookmark-favicon.favicon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8c9099;
    background: rgba(140, 144, 153, 0.08);
  }

  .bookmark-favicon.favicon-fallback .semi-icon {
    font-size: 12px;
  }

  .bookmark-folder-glyph {
    position: relative;
    display: inline-block;
    color: var(--app-text-muted);
  }

  .bookmark-folder-glyph::before {
    content: "";
    position: absolute;
    left: 1px;
    top: 5px;
    width: 13px;
    height: 9px;
    border-radius: 3px;
    border: 1.5px solid currentColor;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-folder-glyph::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    width: 8px;
    height: 4px;
    border: 1.5px solid currentColor;
    border-bottom: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-manager-title {
    font-size: 13px;
    line-height: 1.2;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bookmark-manager-body {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .bookmark-manager-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .bookmark-manager-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .bookmark-manager-action {
    height: 26px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    cursor: pointer;
    padding: 0 8px;
  }

  .bookmark-manager-action.danger {
    color: var(--semi-color-danger);
  }

  .bookmark-manager-action:disabled {
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

const BrowserWorkspace = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

const BrowserWorkspaceMain = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
`;

const BrowserWorkspaceAside = styled.div`
  position: relative;
  flex-shrink: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  background: var(--app-bg-elevated);
`;

const BrowserWorkspaceAsideResizeHandle = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
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

type BookmarkIconDisplayEntry = {
  dataUrl: string;
  signature: string;
};

function countBookmarkChildren(item: BrowserBookmarkItem) {
  let count = 0;
  const visit = (nodes: BrowserBookmarkItem[]) => {
    nodes.forEach((node) => {
      count += 1;
      if (node.children?.length) {
        visit(node.children);
      }
    });
  };
  visit(item.children || []);
  return count;
}

function getBookmarkManagerMeta(item: BrowserBookmarkItem) {
  if (item.kind === 'folder') {
    const childCount = countBookmarkChildren(item);
    return childCount > 0 ? `${childCount} 项` : '空文件夹';
  }
  return getURLHost(item.url || '') || item.url || '未设置网址';
}

const FaviconImage: React.FC<{
  alt?: string;
  className: string;
  src?: string | null;
  style?: React.CSSProperties;
}> = ({ alt = '', className, src, style }) => {
  const normalizedSrc = String(src || '').trim();
  const [loadState, setLoadState] = React.useState<'idle' | 'loaded' | 'error'>(() => (
    normalizedSrc ? 'idle' : 'error'
  ));

  React.useEffect(() => {
    setLoadState(normalizedSrc ? 'idle' : 'error');
  }, [normalizedSrc]);

  const showFallback = !normalizedSrc || loadState !== 'loaded';

  if (showFallback && !normalizedSrc) {
    return (
      <span
        aria-hidden="true"
        className={`${className} favicon-fallback`}
        style={style}
      >
        <IconGlobeStroke size="small" />
      </span>
    );
  }

  return (
    <>
      {showFallback ? (
        <span
          aria-hidden="true"
          className={`${className} favicon-fallback`}
          style={style}
        >
          <IconGlobeStroke size="small" />
        </span>
      ) : null}
      {normalizedSrc ? (
        <img
          alt={alt}
          className={className}
          draggable={false}
          src={normalizedSrc}
          style={{
            ...style,
            display: loadState === 'loaded' ? undefined : 'none',
          }}
          onLoad={() => setLoadState('loaded')}
          onError={() => setLoadState('error')}
        />
      ) : null}
    </>
  );
};

function getBookmarkIconDisplaySignature(input: { iconUrl?: string | null; url?: string | null }) {
  return `${String(input.url || '').trim()}::${getPersistableBookmarkIconUrl(input.iconUrl)}`;
}

const BookmarkVisual: React.FC<{
  cacheOwnerKey?: string;
  displayIcon?: BookmarkIconDisplayEntry;
  item: BrowserBookmarkItem;
}> = ({ cacheOwnerKey, displayIcon, item }) => {
  if (item.kind === 'folder') {
    return <span className="bookmark-folder-glyph" aria-hidden="true" />;
  }
  const displayIconUrl = displayIcon?.dataUrl || '';
  const iconUrl = displayIconUrl
    || getCachedFaviconDataUrl({
      ownerKey: cacheOwnerKey,
      iconUrl: item.iconUrl,
      pageUrl: item.url,
    })
    || getPersistableBookmarkIconUrl(item.iconUrl);
  return (
    <FaviconImage
      className="bookmark-favicon"
      src={iconUrl}
      style={{ height: 16, width: 16 }}
    />
  );
};

const BrowserTabVisual: React.FC<{ cacheOwnerKey?: string; tab: BrowserTab }> = ({ cacheOwnerKey, tab }) => {
  const iconUrl = tab.iconUrl || getCachedFaviconDataUrl({
    ownerKey: cacheOwnerKey,
    iconUrl: tab.iconSourceUrl,
    pageUrl: tab.url,
  });
  return (
    <FaviconImage
      className="browser-tab-favicon"
      src={iconUrl}
    />
  );
};

const LibraryDetailContent: React.FC<{ libraryId: number }> = ({ libraryId }) => {
  const { user } = useAuth();
  const { setFileUrl, tabs, activeTabId, fileState, reloadActiveTab } = useFileViewer();
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
  const browserInputRef = React.useRef<HTMLInputElement | null>(null);
  const latestWorkspaceStateRef = React.useRef<LibraryDetailWorkspaceState>(initialWorkspaceState);
  const latestPanelWidthRef = React.useRef<number>(sidePanelWidth);
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

  React.useEffect(() => {
    const restored = loadSidePanelWidth(libraryId);
    latestPanelWidthRef.current = restored;
    setSidePanelWidth(restored);
  }, [libraryId]);

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
    options?: {
      tabTypeLabel?: string | null;
      returnTarget?: {
        fileUrl: string;
        fileName: string | null;
        fileType: FileViewerFileType;
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
    || (fileState.fileType === 'video' && archiveReturnTarget?.fileType === 'video_archive')
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
    const existingTabId = activeBrowserTabId ?? browserTabs[browserTabs.length - 1]?.id ?? null;
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
  }, [activeBrowserTabId, browserTabs, normalizeBrowserUrl]);

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
      setBrowserModeOpen(true);
      setBookmarkBarVisible(!fallbackTab?.url);
      setWorkspaceDisplayMode('browser');
      setActiveBrowserTabId(fallbackTabId);
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

  const openToolsWorkspace = React.useCallback(() => {
    setBrowserModeOpen(false);
    setWorkspaceDisplayMode('tools');
    void window.electronEmbeddedBrowser.deactivate();
  }, []);

  const activateBrowserTab = React.useCallback((tabId: string) => {
    setActiveBrowserTabId(tabId);
    setBrowserModeOpen(true);
    setWorkspaceDisplayMode('browser');
    const targetTab = browserTabs.find((tab) => tab.id === tabId) ?? null;
    setBookmarkBarVisible(!targetTab?.url);
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
      setBookmarkBarVisible(!fallback?.url);
      if (fallback) {
        void window.electronEmbeddedBrowser.activateTab(fallback.id);
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
    void window.electronEmbeddedBrowser.closeTab(tabId);
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
    setBookmarkBarVisible(false);
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
              className="directory-context-menu"
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

  return (
    <DetailWrapper>
      <SidePanel ref={sidePanelRef} style={{ width: `${sidePanelWidth}px` }}>
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
            <button
              className="footer-btn"
              onClick={() => navigate("/settings")}
              title="设置"
            >
              <IconSetting size="large" />
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
            <button
              type="button"
              className={`toolbar-action-btn ${workspaceDisplayMode === 'tools' ? 'is-active' : ''}`}
              onClick={openToolsWorkspace}
              title="打开工具区"
            >
              <IconPulse />
            </button>
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
                        className="directory-context-menu"
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
        <ContentBody>
          {workspaceDisplayMode === 'browser' ? (
            <BrowserWorkspace>
              <BrowserWorkspaceMain>
                <EmbeddedBrowserPanel
                  ref={browserRef}
                  activeTabId={activeBrowserTabId}
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
              </BrowserWorkspaceMain>
              {browserResourcePanelVisible ? (
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
                  />
                </BrowserWorkspaceAside>
              ) : null}
            </BrowserWorkspace>
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
          ) : workspaceDisplayMode === 'tools' ? (
            <ToolWorkspace
              libraryId={libraryId}
              onOpenFileWorkspace={openFileWorkspace}
              rootNodeId={treeRootNodeId}
              selectedTreeNode={selectedTreeNode}
            />
          ) : (
            <AppMain hideTabsBar={false} />
          )}
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

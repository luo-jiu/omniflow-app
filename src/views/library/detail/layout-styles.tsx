import React from 'react';
import styled, { createGlobalStyle, css } from 'styled-components';
import {
  BOOKMARK_FONT_SIZE,
  BOOKMARK_ICON_SIZE,
  BOOKMARK_ITEM_HEIGHT,
  BOOKMARK_TOOLBAR_HEIGHT,
  BROWSER_INPUT_FONT_SIZE,
  BROWSER_INPUT_HEIGHT,
  BROWSER_TAB_FONT_SIZE,
  BROWSER_TAB_HEIGHT,
  BROWSER_TAB_ICON_SIZE,
  CONTENT_TOOLBAR_COLLAPSED_SAFE_SPACE,
  CONTENT_TOOLBAR_HEIGHT,
  DEFAULT_SIDE_PANEL_WIDTH,
  SIDE_PANEL_COLLAPSE_ANIMATION_MS,
  SIDE_PANEL_TOGGLE_LEFT,
  SIDE_PANEL_TOGGLE_SIZE,
  SIDE_PANEL_TOGGLE_TOP,
  SIDE_PANEL_TOGGLE_VISUAL_LEFT,
  SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT,
  TOOLBAR_ACTION_BUTTON_SIZE,
  TOOLBAR_ACTION_ICON_SIZE,
} from './layout-constants';
import {
  sidePanelCompactIconButtonStyles,
  sidePanelIconButtonBaseStyles,
} from './icon-button-styles';

export const SidePanelMotionProperty = createGlobalStyle`
  @property --side-panel-visual-width {
    syntax: '<length>';
    inherits: true;
    initial-value: ${DEFAULT_SIDE_PANEL_WIDTH}px;
  }
`;

export const ArchiveReturnIconSlot = styled.span`
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

export const DetailWrapper = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  position: relative;
  --side-panel-visual-width: ${DEFAULT_SIDE_PANEL_WIDTH}px;
  --content-toolbar-collapsed-safe-space: ${CONTENT_TOOLBAR_COLLAPSED_SAFE_SPACE}px;
  --side-panel-transition-duration: ${SIDE_PANEL_COLLAPSE_ANIMATION_MS}ms;
  --side-panel-transition-easing: cubic-bezier(0.22, 1, 0.36, 1);
  transition: --side-panel-visual-width var(--side-panel-transition-duration) var(--side-panel-transition-easing);

  &.is-side-panel-resizing {
    --side-panel-transition-duration: 0ms;
  }
`;

export const TitlebarSidePanelToggleHost = styled.div`
  position: absolute;
  left: ${SIDE_PANEL_TOGGLE_VISUAL_LEFT}px;
  top: ${SIDE_PANEL_TOGGLE_TOP}px;
  z-index: 3200;
  width: ${SIDE_PANEL_TOGGLE_SIZE}px;
  height: ${SIDE_PANEL_TOGGLE_SIZE}px;
  pointer-events: auto;
  -webkit-app-region: no-drag !important;

  &,
  * {
    -webkit-app-region: no-drag !important;
  }
`;

export const TitlebarSidePanelToggleButton = styled.button`
  ${sidePanelIconButtonBaseStyles}
  width: 100%;
  height: 100%;
  pointer-events: auto;
  -webkit-app-region: no-drag !important;

  &.is-active {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  &.is-active:hover {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  body[theme-mode="dark"] &.is-active {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  body[theme-mode="dark"] &.is-active:hover {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  &.is-active,
  &.is-active *,
  body[theme-mode="dark"] &.is-active,
  body[theme-mode="dark"] &.is-active * {
    color: #22d3ee;
  }

  &:disabled {
    cursor: default;
    opacity: 0.46;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
`;

export const SidePanel = styled.div`
  position: relative;
  width: var(--side-panel-visual-width);
  min-width: 0;
  max-width: 80vw;
  display: flex;
  flex-direction: column;
  background: var(--app-sidebar-vibrancy);
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;

  body[theme-mode="dark"] & {
    background: var(--app-sidebar-vibrancy);
  }
`;

export const ResizeHandle = styled.div`
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

export const SidePanelHeader = styled.div`
  height: ${SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT}px;
  min-height: ${SIDE_PANEL_TRAFFIC_LIGHT_SAFE_HEIGHT}px;
  padding: 0 11px;
  padding-left: 68px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: transparent;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  position: relative;
  z-index: 2;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    width: ${SIDE_PANEL_TOGGLE_LEFT - 8}px;
    height: 100%;
    -webkit-app-region: drag;
  }

  &::after {
    content: "";
    position: absolute;
    left: ${SIDE_PANEL_TOGGLE_LEFT + SIDE_PANEL_TOGGLE_SIZE + 8}px;
    right: 0;
    top: 0;
    height: 100%;
    -webkit-app-region: drag;
  }

  h1 {
    position: relative;
    z-index: 1;
    -webkit-app-region: no-drag;
    font-size: 11px;
    font-weight: 600;
    color: var(--app-text);
    margin: 0;
  }
`;

export const SidePanelTree = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 5px 7px 4px;
`;

export const SidePanelFooter = styled.div`
  padding: 7px 9px;
  border-top: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  .footer-left {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .footer-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
  }

  .footer-btn {
    ${sidePanelCompactIconButtonStyles}
  }

  .footer-avatar-btn {
    border-radius: 999px;
    padding: 0;
    overflow: hidden;
  }

  .footer-avatar-btn .semi-avatar {
    flex-shrink: 0;
  }
`;

export const ContentArea = styled.div`
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  border-top-left-radius: clamp(0px, var(--side-panel-visual-width), 12px);
  border-bottom-left-radius: clamp(0px, var(--side-panel-visual-width), 12px);
`;

const toolbarActionButtonStyles = css`
  .toolbar-action-btn {
    width: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
    height: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
    border-radius: 6px;
    border: 1px solid transparent;
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
    width: ${TOOLBAR_ACTION_ICON_SIZE}px;
    height: ${TOOLBAR_ACTION_ICON_SIZE}px;
    font-size: ${TOOLBAR_ACTION_ICON_SIZE}px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .toolbar-action-btn .semi-icon > svg,
  .toolbar-action-btn svg {
    width: ${TOOLBAR_ACTION_ICON_SIZE}px;
    height: ${TOOLBAR_ACTION_ICON_SIZE}px;
    display: block;
  }

  .toolbar-action-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
    color: var(--app-text);
  }

  .toolbar-action-btn.is-active {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  .toolbar-action-btn.is-active:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  body[theme-mode="dark"] & .toolbar-action-btn.is-active {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  body[theme-mode="dark"] & .toolbar-action-btn.is-active:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .toolbar-action-btn.is-active,
  .toolbar-action-btn.is-active *,
  body[theme-mode="dark"] & .toolbar-action-btn.is-active,
  body[theme-mode="dark"] & .toolbar-action-btn.is-active * {
    color: #22d3ee;
  }

  .toolbar-action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const toolbarBackButtonStyles = css`
  .toolbar-back-btn {
    height: ${TOOLBAR_ACTION_BUTTON_SIZE}px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    cursor: pointer;
    font-size: 10px;
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

export const ContentToolbar = styled.div`
  height: ${CONTENT_TOOLBAR_HEIGHT}px;
  flex-shrink: 0;
  background: var(--app-bg);
  border-bottom: 3px solid var(--app-border);
  border-top-left-radius: clamp(0px, var(--side-panel-visual-width), 12px);
  -webkit-app-region: drag;
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 7px;
  padding-left: max(
    7px,
    calc(var(--content-toolbar-collapsed-safe-space) - var(--side-panel-visual-width))
  );

  &::before {
    content: "";
    position: absolute;
    left: ${SIDE_PANEL_TOGGLE_LEFT - 6}px;
    top: 0;
    width: ${SIDE_PANEL_TOGGLE_SIZE + 12}px;
    height: 100%;
    -webkit-app-region: no-drag;
    pointer-events: none;
  }

  &.browser-url-toolbar {
    padding-left: 7px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 3px;
    -webkit-app-region: no-drag;
    transform: translate(-1px, 1px);
  }

  .toolbar-spacer {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    -webkit-app-region: drag;
  }

  .browser-tabs-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-left: 3px;
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
    width: 26px;
    height: 26px;
    margin-left: 3px;
    border-radius: 6px;
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
    font-size: 13px;
  }

  .browser-tabs-add:hover {
    background: var(--app-bg-elevated);
    color: var(--app-text);
  }

  .browser-tab-btn {
    min-width: 94px;
    max-width: 174px;
    height: ${BROWSER_TAB_HEIGHT}px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
    border-radius: 3px;
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
    font-size: 11px;
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
    width: 18px;
    height: 18px;
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
    font-size: 11px;
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
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 8px;
    outline: none;
    font-size: ${BROWSER_INPUT_FONT_SIZE}px;
  }

  .toolbar-browser-input:focus {
    border-color: var(--semi-color-primary);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 4px;
    -webkit-app-region: no-drag;
  }
  ${toolbarBackButtonStyles}
  ${toolbarActionButtonStyles}
`;

export const BookmarkToolbar = styled.div`
  height: ${BOOKMARK_TOOLBAR_HEIGHT}px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-bg) 94%, var(--semi-color-fill-0) 6%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  -webkit-app-region: no-drag;

  .bookmark-bar-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .bookmark-item {
    height: ${BOOKMARK_ITEM_HEIGHT}px;
    min-width: 0;
    max-width: 120px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
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
    border-radius: 3px;
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
    font-size: 11px;
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
    top: 5px;
    width: 12px;
    height: 8px;
    border-radius: 2px;
    border: 1px solid currentColor;
    background: transparent;
    box-sizing: border-box;
  }

  .bookmark-folder-glyph::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    width: 7px;
    height: 4px;
    border: 1px solid currentColor;
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
    width: 26px;
    height: 26px;
    border-radius: 6px;
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
    font-size: 13px;
  }
`;

export const BookmarkContextMenuLayer = styled.div`
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

export const SidebarCollapseIcon: React.FC = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
    <rect
      x="3.25"
      y="4.25"
      width="13.5"
      height="11.5"
      rx="2.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
    />
    <path
      d="M7.5 4.75V15.25"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
    />
  </svg>
);

export const BookmarkManagerContent = styled.div`
  min-height: 310px;
  max-height: 350px;
  overflow: auto;
  padding: 2px 0;

  .bookmark-manager-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 3px 8px;
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
    padding: 12px 3px;
    text-align: center;
  }

  .bookmark-manager-row {
    min-height: 30px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
  }

  .bookmark-manager-row:hover {
    background: var(--semi-color-fill-0);
  }

  .bookmark-manager-disclosure {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 4px;
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
    gap: 3px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .bookmark-manager-action {
    height: 20px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    cursor: pointer;
    padding: 0 6px;
  }

  .bookmark-manager-action.danger {
    color: var(--semi-color-danger);
  }

  .bookmark-manager-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

export const BrowserSettingsContent = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 21px 24px;
  background: var(--app-bg);

  .browser-settings-hero {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 3px;
  }

  .browser-settings-intro {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .browser-settings-eyebrow {
    font-size: 11px;
    line-height: 1.45;
    font-weight: 700;
    color: var(--semi-color-primary);
  }

  .browser-settings-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .browser-settings-description {
    max-width: 480px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .browser-settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .browser-settings-card {
    min-height: 115px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-bg-elevated);
    padding: 12px 12px 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    &.browser-settings-card-clickable {
      cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;

      &:hover {
        border-color: var(--semi-color-primary);
        box-shadow: 0 0 0 1px var(--semi-color-primary);
      }
    }
  }

  .browser-settings-card-title {
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--app-text);
  }

  .browser-settings-card-body {
    font-size: 11px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  .browser-settings-chip {
    width: fit-content;
    max-width: 100%;
    min-height: 20px;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg-elevated) 82%, var(--semi-color-fill-0) 18%);
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    line-height: 1.4;
    font-weight: 600;
  }

  .browser-settings-footer {
    padding-top: 2px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--app-text-muted);
  }

  @media (max-width: 1040px) {
    padding: 16px 16px 20px;

    .browser-settings-grid {
      grid-template-columns: 1fr;
    }

    .browser-settings-title {
      font-size: 19px;
    }

    .browser-settings-description,
    .browser-settings-card-body,
    .browser-settings-footer {
      font-size: 11px;
    }

    .browser-settings-card-title {
      font-size: 12px;
    }
  }
`;

export const ContentBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  -webkit-app-region: no-drag;

  & > * {
    grid-area: 1 / 1;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .workspace-pane {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .workspace-pane.inactive {
    visibility: hidden;
    pointer-events: none;
  }

  .workspace-pane.active {
    visibility: visible;
    pointer-events: auto;
    z-index: 1;
  }
`;

export const BrowserWorkspace = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

export const BrowserWorkspaceMain = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
`;

export const BrowserWorkspaceAside = styled.div`
  position: relative;
  flex-shrink: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  background: var(--app-bg-elevated);
`;

export const BrowserWorkspaceAsideResizeHandle = styled.div`
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

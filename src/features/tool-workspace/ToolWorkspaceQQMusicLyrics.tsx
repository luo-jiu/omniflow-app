import React from 'react';
import {
  IconAlertCircle,
  IconFile,
  IconList,
  IconMusic,
  IconPause,
  IconPlay,
  IconRefresh,
  IconSaveStroked,
  IconSearch,
  IconTickCircle,
} from '@douyinfe/semi-icons';
import { Button, Input, Modal, Select, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { xml } from '@codemirror/lang-xml';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import styled, { createGlobalStyle } from 'styled-components';

import { beginDocumentDragSession } from '@/components/ui/document-drag-session';
import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
  type SelectedTreeNode,
} from '@/features/file-explorer';
import {
  parseTimedText,
  resolveFocusedTimedTextCueIndex,
  resolveTimedTextCueSweepPercent,
  type TimedTextCue,
} from '@/features/file-viewer/timed-text/subtitle';
import { useTheme } from '@/hooks/useTheme';
import type {
  QQMusicLyricsPreview,
  QQMusicLyricsSong,
  QQMusicLyricsStatus,
} from '@/shared/qqmusic-lyrics/qqmusic-lyrics.types';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

import {
  fetchQQMusicLyricsStatus,
  fetchQQMusicStorageProviders,
  loadLocalQQMusicLyricsPreview,
  saveQQMusicLyricsToLibrary,
  searchLocalQQMusicLyrics,
  validateQQMusicLyricsSaveDirectory,
  type QQMusicStorageProviderOption,
} from './qqmusic-lyrics.service';
import { WorkspaceHeader } from './styles';
import {
  getQQMusicLyricsListKeyboardWidth,
  getQQMusicLyricsListWidthBounds,
  getQQMusicLyricsCenteredScrollTop,
  getQQMusicLyricsStageHeightBounds,
  getQQMusicLyricsStageKeyboardHeight,
  shouldAnimateQQMusicLyricsFollow,
  clampQQMusicLyricsListWidth,
  clampQQMusicLyricsStageHeight,
  type QQMusicLyricsListWidthBounds,
  type QQMusicLyricsStageHeightBounds,
} from './qqmusic-lyrics.layout';
import {
  clearQQMusicLyricsSaveDirectory,
  loadQQMusicLyricsSaveDirectory,
  saveQQMusicLyricsSaveDirectory,
  type QQMusicLyricsSaveDirectory,
} from './qqmusic-lyrics.preferences';

const QQMusicLyricsWorkspace = styled.div`
  container-name: qqmusic-lyrics-workspace;
  container-type: inline-size;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--app-text);

  .header-desc {
    font-size: 12px;
  }

  .qq-status {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .qq-status svg {
    flex: none;
  }

  .qq-status-path {
    max-width: 430px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qq-icon-button.semi-button {
    width: 30px;
    height: 30px;
    min-width: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--app-radius-medium);
    color: var(--app-text-muted);
    background: transparent;
    box-shadow: none;
    transition:
      color 0.14s ease,
      background-color 0.14s ease;
  }

  .qq-icon-button.semi-button:not(:disabled):hover {
    color: var(--app-text);
    background: var(--semi-color-fill-0);
    box-shadow: none;
  }

  .qq-icon-button.semi-button:not(:disabled):active {
    background: var(--semi-color-fill-1);
    box-shadow: none;
  }

  .qq-icon-button.semi-button:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: 1px;
  }

  .qq-layout {
    --qq-list-default-width: 34%;
    --qq-list-min-width: 260px;
    --qq-list-effective-width: max(
      var(--qq-list-min-width),
      min(var(--qq-list-width, var(--qq-list-default-width)), var(--qq-list-default-width))
    );

    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--qq-list-effective-width) minmax(0, 1fr);
    position: relative;
  }

  .qq-search-pane,
  .qq-preview-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .qq-search-pane {
    border-right: 1px solid var(--app-border);
    container-name: qqmusic-song-list;
    container-type: inline-size;
  }

  .qq-list-resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--qq-list-effective-width);
    width: 6px;
    transform: translateX(-3px);
    cursor: col-resize;
    touch-action: none;
    z-index: 2;
    -webkit-app-region: no-drag;
  }

  .qq-list-resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
    background: transparent;
  }

  .qq-list-resize-handle:hover::after,
  .qq-list-resize-handle:focus-visible::after,
  .qq-list-resize-handle[data-resizing='true']::after {
    background: var(--semi-color-primary);
  }

  .qq-list-resize-handle:focus-visible {
    outline: none;
  }

  .qq-search-scope {
    min-height: 38px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .qq-search-scope-tabs {
    min-width: 0;
    padding: 2px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 7px;
    display: flex;
    align-items: center;
    gap: 2px;
    background: color-mix(in srgb, var(--app-bg-elevated) 78%, transparent);
  }

  .qq-search-scope-tabs button {
    min-width: 66px;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .qq-search-scope-tabs button:hover,
  .qq-search-scope-tabs button:focus-visible {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text-muted) 11%, transparent);
  }

  .qq-search-scope-tabs button:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: -1px;
  }

  .qq-search-scope-tabs button.is-active {
    color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary) 15%, var(--app-bg-elevated));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 18%, transparent);
  }

  .qq-search-scope-count {
    flex: none;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .qq-search-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(100px, 36%) 32px;
    gap: 7px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border);
  }

  .qq-search-form .semi-input-wrapper {
    height: 32px;
  }

  .qq-search-form .semi-button {
    width: 32px;
    height: 32px;
    padding: 0;
  }

  .qq-results {
    flex: 1;
    min-height: 0;
    overflow: auto;
    ${workspaceScrollbarStyles}
  }

  .qq-load-more {
    display: flex;
    justify-content: center;
    padding: 10px 12px 14px;
  }

  .qq-result {
    appearance: none;
    width: 100%;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
    background: transparent;
    color: inherit;
    padding: 11px 12px;
    text-align: left;
    cursor: pointer;
  }

  .qq-result:hover,
  .qq-result:focus-visible {
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 62%, transparent);
  }

  .qq-result:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: -1px;
  }

  .qq-result.is-selected {
    background: var(--semi-color-primary-light-default);
    box-shadow: inset 3px 0 0 var(--semi-color-primary);
  }

  .qq-result-title,
  .qq-result-meta,
  .qq-result-cache {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .qq-result-title {
    gap: 7px;
    font-size: 13px;
    font-weight: 700;
  }

  .qq-result-title > span:first-child,
  .qq-result-meta > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qq-result-meta {
    justify-content: space-between;
    gap: 8px;
    margin-top: 5px;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .qq-result-cache {
    flex: none;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .qq-result-cache .semi-tag {
    font-size: 12px;
  }

  .qq-empty,
  .qq-error,
  .qq-loading,
  .qq-unsupported {
    flex: 1;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    padding: 20px;
    text-align: center;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.55;
  }

  .qq-error {
    color: var(--semi-color-danger);
  }

  .qq-preview-toolbar {
    min-height: 54px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qq-preview-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qq-preview-icon-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .qq-save-trigger {
    flex: none;
  }

  .qq-preview-identity {
    flex: 1;
    min-width: 0;
  }

  .qq-preview-title,
  .qq-preview-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qq-preview-title {
    font-size: 13px;
    font-weight: 700;
  }

  .qq-preview-meta {
    margin-top: 3px;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .qq-preview-content {
    --qq-stage-default-height: max(156px, 42%);
    --qq-stage-effective-height: min(
      var(--qq-stage-height, var(--qq-stage-default-height)),
      var(--qq-stage-default-height)
    );

    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-rows: var(--qq-stage-effective-height) minmax(0, 1fr) auto;
    position: relative;
  }

  .qq-preview-content[data-mode='xml'] {
    display: flex;
    flex-direction: column;
  }

  .qq-stage {
    position: relative;
    overflow: hidden;
    background: color-mix(in srgb, var(--app-bg-elevated) 72%, var(--app-bg));
    border-bottom: 1px solid var(--app-border);
  }

  .qq-stage-resize-handle {
    position: absolute;
    top: var(--qq-stage-effective-height);
    left: 3px;
    right: 0;
    height: 6px;
    transform: translateY(-3px);
    cursor: row-resize;
    touch-action: none;
    z-index: 2;
    -webkit-app-region: no-drag;
  }

  .qq-stage-resize-handle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 0;
    right: 0;
    height: 1px;
    background: transparent;
  }

  .qq-stage-resize-handle:hover::after,
  .qq-stage-resize-handle:focus-visible::after,
  .qq-stage-resize-handle[data-resizing='true']::after {
    background: var(--semi-color-primary);
  }

  .qq-stage-resize-handle:focus-visible {
    outline: none;
  }

  .qq-stage-scroll {
    width: 100%;
    height: 100%;
    overflow: hidden;
    scrollbar-width: none;
    mask-image: linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%);
  }

  .qq-stage-scroll::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .qq-stage-roller {
    width: 100%;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: max(54px, calc((var(--qq-stage-effective-height) - 42px) / 2)) 30px;
    text-align: center;
  }

  .qq-stage-line {
    flex: none;
    width: min(780px, 100%);
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 19px;
    line-height: 1.45;
    color: var(--app-text-muted);
    opacity: 0.38;
    transition:
      color 0.22s ease,
      opacity 0.22s ease;
  }

  .qq-stage-line-content {
    display: inline-block;
    max-width: 100%;
    transform: scale(0.84);
    transition: transform 0.22s ease;
  }

  .qq-stage-line.is-active {
    font-weight: 700;
    color: color-mix(in srgb, var(--app-text) 62%, var(--app-text-muted));
    opacity: 1;
  }

  .qq-stage-line.is-active .qq-stage-line-content {
    transform: scale(1.08);
  }

  .qq-lyric-sweep {
    display: inline;
    color: transparent;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--semi-color-primary) 74%, var(--semi-color-text-0)) 0%,
        color-mix(in srgb, var(--semi-color-primary) 74%, var(--semi-color-text-0)) var(--qq-lyric-progress, 0%),
        var(--semi-color-text-0) var(--qq-lyric-progress, 0%),
        var(--semi-color-text-0) 100%
      );
    background-clip: text;
    -webkit-background-clip: text;
    will-change: background;
  }

  .qq-timeline-list {
    min-height: 0;
    overflow: auto;
    padding: 7px 12px 12px;
    ${workspaceScrollbarStyles}
  }

  .qq-timeline-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 10px;
    min-height: 40px;
    align-items: center;
    padding: 7px 8px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .qq-timeline-row:nth-child(even) {
    background: color-mix(in srgb, var(--app-bg-elevated) 64%, transparent);
  }

  .qq-timeline-row.is-active {
    color: var(--app-text);
    background: color-mix(in srgb, var(--semi-color-primary) 10%, var(--app-bg-elevated));
    box-shadow: inset 2px 0 0 var(--semi-color-primary);
  }

  .qq-timeline-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .qq-xml-preview {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--semi-color-bg-0);
  }

  .qq-xml-preview > div {
    flex: 1;
    min-height: 0;
  }

  .qq-xml-preview .cm-editor {
    height: 100%;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.65;
  }

  .qq-xml-preview .cm-editor.cm-focused {
    outline: none;
  }

  .qq-xml-preview .cm-scroller {
    overflow: auto !important;
    padding-block: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .qq-xml-preview .cm-scroller::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .qq-xml-preview .cm-scroller::-webkit-scrollbar-track,
  .qq-xml-preview .cm-scroller::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  .qq-xml-preview .cm-scroller::-webkit-scrollbar-thumb {
    min-width: 28px;
    min-height: 28px;
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--app-scrollbar-thumb);
    background-clip: padding-box;
  }

  .qq-xml-preview .cm-scroller::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
    background-clip: padding-box;
  }

  .qq-xml-preview .cm-gutters {
    border-right: 1px solid var(--app-border);
    background: var(--semi-color-bg-1);
    font-size: 12px;
  }

  .qq-transport {
    display: grid;
    grid-template-columns: 30px 72px minmax(120px, 1fr) 72px;
    gap: 7px;
    align-items: center;
    min-height: 52px;
    padding: 8px 12px;
    border-top: 1px solid var(--app-border);
    background: var(--app-bg);
  }

  .qq-transport .semi-button {
    width: 30px;
    height: 30px;
    padding: 0;
  }

  .qq-progress {
    position: relative;
    height: 30px;
    min-width: 0;
  }

  .qq-progress input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    appearance: none;
    background: transparent;
    opacity: 0;
    cursor: pointer;
  }

  .qq-progress input::-webkit-slider-runnable-track {
    height: 11px;
    background: transparent;
  }

  .qq-progress input::-webkit-slider-thumb {
    width: 1px;
    height: 11px;
    appearance: none;
    border: 0;
    background: transparent;
  }

  .qq-progress input::-moz-range-track {
    height: 11px;
    border: 0;
    background: transparent;
  }

  .qq-progress input::-moz-range-thumb {
    width: 1px;
    height: 11px;
    border: 0;
    background: transparent;
  }

  .qq-progress input:disabled {
    cursor: default;
  }

  .qq-progress-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 13px;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--semi-color-fill-0);
    pointer-events: none;
    transition: box-shadow 0.14s ease;
  }

  .qq-progress input:focus-visible + .qq-progress-track {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--semi-color-primary) 28%, transparent);
  }

  .qq-progress-track > span {
    display: block;
    height: 100%;
    border-radius: 0 999px 999px 0;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--semi-color-primary) 68%, var(--semi-color-text-0)) 0%,
      var(--semi-color-primary) 100%
    );
  }

  .qq-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--app-text-muted);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .qq-stage-line,
    .qq-stage-line-content {
      transition-duration: 0.01ms;
    }
  }

  @container qqmusic-lyrics-workspace (max-width: 760px) {
    .qq-layout {
      --qq-list-default-width: 40%;
      --qq-list-min-width: 220px;
    }

    .qq-search-form {
      grid-template-columns: minmax(0, 1fr) 32px;
    }

    .qq-search-form .qq-singer-input {
      grid-column: 1 / -1;
      grid-row: 2;
    }

  }

  @container qqmusic-lyrics-workspace (max-width: 620px) {
    .qq-transport {
      grid-template-columns: 30px 60px minmax(64px, 1fr) 60px;
      gap: 4px;
      padding-inline: 8px;
    }
  }

  @container qqmusic-song-list (max-width: 360px) {
    .qq-search-form {
      grid-template-columns: minmax(0, 1fr) 32px;
    }

    .qq-search-form .qq-song-input {
      grid-column: 1 / -1;
      grid-row: 1;
    }

    .qq-search-form .qq-singer-input {
      grid-column: 1;
      grid-row: 2;
    }

    .qq-search-form .semi-button {
      grid-column: 2;
      grid-row: 2;
    }
  }

  @container qqmusic-song-list (max-width: 280px) {
    .qq-search-scope,
    .qq-search-form,
    .qq-result {
      padding-inline: 10px;
    }

    .qq-search-scope-tabs button {
      min-width: 58px;
      padding-inline: 6px;
    }

    .qq-result-meta {
      align-items: stretch;
      flex-direction: column;
      gap: 4px;
    }

    .qq-result-cache {
      width: 100%;
      justify-content: space-between;
    }
  }
`;

const QQMusicLyricsSaveModalStyle = createGlobalStyle`
  .qqmusic-lyrics-save-modal {
    width: min(440px, calc(100vw - 32px)) !important;
  }

  .qqmusic-lyrics-save-modal .semi-modal-content {
    overflow: hidden;
    padding: 0 !important;
    border: 1px solid var(--app-border-strong);
    border-radius: 10px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .qqmusic-lyrics-save-modal .semi-modal-header {
    margin: 0;
    padding: 14px 16px 8px !important;
  }

  .qqmusic-lyrics-save-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .qqmusic-lyrics-save-modal .semi-modal-close {
    top: 13px;
    right: 14px;
    color: var(--app-text-muted);
  }

  .qqmusic-lyrics-save-modal .semi-modal-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .qqmusic-lyrics-save-modal .semi-modal-body {
    padding: 2px 16px 16px !important;
  }

  .qqmusic-lyrics-save-modal .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .qqmusic-lyrics-save-modal .semi-modal-footer .semi-button {
    height: 28px;
    min-width: 56px;
    margin: 0;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
`;

const QQMusicLyricsSaveDialogContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  .qq-save-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .qq-save-label {
    font-size: 12px;
    line-height: 1.35;
    color: var(--semi-color-text-2);
  }

  .qq-save-directory {
    appearance: none;
    width: 100%;
    min-width: 0;
    min-height: 30px;
    padding: 6px 9px;
    border: 1px solid var(--app-border-strong);
    border-radius: 7px;
    background: var(--semi-color-fill-0);
    color: var(--semi-color-text-0);
    font-size: 12px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.14s ease,
      background-color 0.14s ease;
  }

  .qq-save-directory:hover,
  .qq-save-directory:focus-visible {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-fill-1);
  }

  .qq-save-directory:focus-visible {
    outline: 1px solid var(--semi-color-primary);
    outline-offset: 1px;
  }

  .semi-input-wrapper,
  .semi-select {
    width: 100%;
    min-height: 30px;
    border-radius: 7px;
  }

  .semi-input,
  .semi-select-selection-text,
  .semi-select-selection-placeholder {
    font-size: 13px;
  }
`;

type ToolWorkspaceQQMusicLyricsProps = {
  libraryId: number;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
};

type QQMusicLyricsSearchScope = 'cached' | 'library';
type QQMusicLyricsPreviewMode = 'timeline' | 'xml';

const SEARCH_PAGE_SIZE = 50;
const QQ_MUSIC_LYRICS_XML_EXTENSIONS = [
  xml(),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({
    'aria-label': 'QRC XML 文件预览',
    'aria-readonly': 'true',
  }),
];
const QQ_MUSIC_LYRICS_XML_BASIC_SETUP = {
  bracketMatching: true,
  closeBrackets: false,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  indentOnInput: false,
  lineNumbers: true,
} as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}

function contextualSaveDirectory(
  selectedTreeNode: SelectedTreeNode | null,
  rootNodeId: number | null,
): QQMusicLyricsSaveDirectory | null {
  if (selectedTreeNode?.type === 'dir') {
    return { parentId: selectedTreeNode.id, pathLabel: `当前目录 / ${selectedTreeNode.name}` };
  }
  if (selectedTreeNode?.type === 'file') {
    return {
      parentId: selectedTreeNode.parentId,
      pathLabel: `当前文件所在目录 / ${selectedTreeNode.parentId}`,
    };
  }
  if (rootNodeId && rootNodeId > 0) {
    return { parentId: rootNodeId, pathLabel: '资料库根目录 /' };
  }
  return null;
}

function fallbackSaveDirectory(
  contextualTarget: QQMusicLyricsSaveDirectory | null,
  rootNodeId: number | null,
  excludedParentId: number,
): QQMusicLyricsSaveDirectory | null {
  if (contextualTarget && contextualTarget.parentId !== excludedParentId) {
    return contextualTarget;
  }
  if (rootNodeId && rootNodeId > 0 && rootNodeId !== excludedParentId) {
    return { parentId: rootNodeId, pathLabel: '资料库根目录 /' };
  }
  return null;
}

function cueSweepText(
  cue: TimedTextCue,
  activeSweepRef: React.RefObject<HTMLSpanElement>,
) {
  return (
    <span ref={activeSweepRef} className="qq-lyric-sweep">
      {cue.lines.join(' ')}
    </span>
  );
}

function scrollLyricsRowToCenter(
  container: HTMLElement,
  row: HTMLElement,
  behavior: ScrollBehavior,
) {
  if (container.clientHeight <= 0) return;
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  container.scrollTo({
    behavior,
    top: getQQMusicLyricsCenteredScrollTop({
      itemHeight: rowRect.height,
      itemTop: rowRect.top - containerRect.top,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
    }),
  });
}

type QQMusicLyricsSongListProps = {
  onPreview: (song: QQMusicLyricsSong) => void;
  selectedSongId: number | null;
  songs: QQMusicLyricsSong[];
};

const QQMusicLyricsSongList = React.memo(function QQMusicLyricsSongList({
  onPreview,
  selectedSongId,
  songs,
}: QQMusicLyricsSongListProps) {
  return songs.map(song => (
    <button
      key={song.songId}
      className={`qq-result ${selectedSongId === song.songId ? 'is-selected' : ''}`}
      type="button"
      onClick={() => onPreview(song)}
    >
      <span className="qq-result-title"><span>{song.name}</span></span>
      <span className="qq-result-meta">
        <span>{song.singer}</span>
        <span className="qq-result-cache">
          <Tag color={song.cachedKinds.includes('qrc') ? 'green' : 'grey'} size="small">
            {song.cachedKinds.includes('qrc') ? 'QRC' : '无 QRC'}
          </Tag>
          <span>{song.songId}</span>
        </span>
      </span>
    </button>
  ));
});

type QQMusicLyricsStageLineProps = {
  activeLineRef: React.RefObject<HTMLDivElement>;
  activeSweepRef: React.RefObject<HTMLSpanElement>;
  cue: TimedTextCue;
  focused: boolean;
};

const QQMusicLyricsStageLine = React.memo(function QQMusicLyricsStageLine({
  activeLineRef,
  activeSweepRef,
  cue,
  focused,
}: QQMusicLyricsStageLineProps) {
  return (
    <div
      ref={focused ? activeLineRef : undefined}
      aria-current={focused ? 'true' : undefined}
      className={`qq-stage-line ${focused ? 'is-active' : ''}`}
      role="listitem"
    >
      <span className="qq-stage-line-content">
        {focused ? cueSweepText(cue, activeSweepRef) : cue.lines.join(' ')}
      </span>
    </div>
  );
});

type QQMusicLyricsTimelineRowProps = {
  activeRowRef: React.RefObject<HTMLDivElement>;
  activeSweepRef: React.RefObject<HTMLSpanElement>;
  cue: TimedTextCue;
  focused: boolean;
};

const QQMusicLyricsTimelineRow = React.memo(function QQMusicLyricsTimelineRow({
  activeRowRef,
  activeSweepRef,
  cue,
  focused,
}: QQMusicLyricsTimelineRowProps) {
  return (
    <div
      ref={focused ? activeRowRef : undefined}
      className={`qq-timeline-row ${focused ? 'is-active' : ''}`}
    >
      <span className="qq-timeline-time">{formatTime(cue.start)}</span>
      <span>{focused ? cueSweepText(cue, activeSweepRef) : cue.lines.join(' ')}</span>
    </div>
  );
});

type QQMusicLyricsCueListProps = {
  activeCueRef: React.RefObject<HTMLDivElement>;
  activeSweepRef: React.RefObject<HTMLSpanElement>;
  cues: TimedTextCue[];
  focusedCueIndex: number;
};

const QQMusicLyricsStageCueList = React.memo(function QQMusicLyricsStageCueList({
  activeCueRef,
  activeSweepRef,
  cues,
  focusedCueIndex,
}: QQMusicLyricsCueListProps) {
  return cues.map((cue, cueIndex) => (
    <QQMusicLyricsStageLine
      key={cue.id}
      activeLineRef={activeCueRef}
      activeSweepRef={activeSweepRef}
      cue={cue}
      focused={cueIndex === focusedCueIndex}
    />
  ));
});

const QQMusicLyricsTimelineCueList = React.memo(function QQMusicLyricsTimelineCueList({
  activeCueRef,
  activeSweepRef,
  cues,
  focusedCueIndex,
}: QQMusicLyricsCueListProps) {
  return cues.map((cue, cueIndex) => (
    <QQMusicLyricsTimelineRow
      key={cue.id}
      activeRowRef={activeCueRef}
      activeSweepRef={activeSweepRef}
      cue={cue}
      focused={cueIndex === focusedCueIndex}
    />
  ));
});

const QQMusicLyricsXmlPreview = React.memo(function QQMusicLyricsXmlPreview({
  content,
}: {
  content: string;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <div className="qq-xml-preview">
      <CodeMirror
        basicSetup={QQ_MUSIC_LYRICS_XML_BASIC_SETUP}
        extensions={QQ_MUSIC_LYRICS_XML_EXTENSIONS}
        height="100%"
        readOnly
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        value={content}
      />
    </div>
  );
});

const ToolWorkspaceQQMusicLyrics: React.FC<ToolWorkspaceQQMusicLyricsProps> = ({
  libraryId,
  onRefreshDirectory,
  rootNodeId,
  selectedTreeNode,
}) => {
  const [status, setStatus] = React.useState<QQMusicLyricsStatus | null>(null);
  const [statusError, setStatusError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [singer, setSinger] = React.useState('');
  const [searchScope, setSearchScope] = React.useState<QQMusicLyricsSearchScope>('cached');
  const [songs, setSongs] = React.useState<QQMusicLyricsSong[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [hasSearched, setHasSearched] = React.useState(false);
  const [selectedSongId, setSelectedSongId] = React.useState<number | null>(null);
  const [preview, setPreview] = React.useState<QQMusicLyricsPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [saveDialogVisible, setSaveDialogVisible] = React.useState(false);
  const [saveDraftName, setSaveDraftName] = React.useState('');
  const [saveDraftStorageProvider, setSaveDraftStorageProvider] = React.useState('');
  const [directoryPickerVisible, setDirectoryPickerVisible] = React.useState(false);
  const [selectedSaveDirectory, setSelectedSaveDirectory] = React.useState<QQMusicLyricsSaveDirectory | null>(
    () => loadQQMusicLyricsSaveDirectory(libraryId),
  );
  const [saveDraftDirectory, setSaveDraftDirectory] = React.useState<QQMusicLyricsSaveDirectory | null>(null);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<QQMusicLyricsPreviewMode>('timeline');
  const [saving, setSaving] = React.useState(false);
  const [lyricsListBounds, setLyricsListBounds] = React.useState<QQMusicLyricsListWidthBounds>(() => (
    getQQMusicLyricsListWidthBounds(1000)
  ));
  const [lyricsListWidth, setLyricsListWidth] = React.useState<number | null>(null);
  const [lyricsListResizing, setLyricsListResizing] = React.useState(false);
  const [lyricsStageBounds, setLyricsStageBounds] = React.useState<QQMusicLyricsStageHeightBounds>(() => (
    getQQMusicLyricsStageHeightBounds(900)
  ));
  const [lyricsStageHeight, setLyricsStageHeight] = React.useState<number | null>(null);
  const [lyricsStageResizing, setLyricsStageResizing] = React.useState(false);
  const [lyricsViewportRevision, setLyricsViewportRevision] = React.useState(0);
  const [storageProviders, setStorageProviders] = React.useState<QQMusicStorageProviderOption[]>([]);
  const [defaultStorageProvider, setDefaultStorageProvider] = React.useState('');
  const playbackRef = React.useRef({ startedAt: 0, startingTime: 0 });
  const activeRowRef = React.useRef<HTMLDivElement | null>(null);
  const activeStageLineRef = React.useRef<HTMLDivElement | null>(null);
  const activeTimelineSweepRef = React.useRef<HTMLSpanElement | null>(null);
  const activeStageSweepRef = React.useRef<HTMLSpanElement | null>(null);
  const timelineListRef = React.useRef<HTMLDivElement | null>(null);
  const stageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastFollowedCueRef = React.useRef<{ cueIndex: number; songId: number } | null>(null);
  const initialListRequestedRef = React.useRef(false);
  const lastSearchRef = React.useRef({ query: '', scope: 'cached' as QQMusicLyricsSearchScope, singer: '' });
  const previewRequestRef = React.useRef(0);
  const searchRequestRef = React.useRef(0);
  const lyricsLayoutRef = React.useRef<HTMLDivElement>(null);
  const lyricsSearchPaneRef = React.useRef<HTMLElement>(null);
  const lyricsListWidthRef = React.useRef<number | null>(null);
  const lyricsListResizeRef = React.useRef<{
    bounds: QQMusicLyricsListWidthBounds;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const lyricsListPreviewFrameRef = React.useRef<number | null>(null);
  const pendingLyricsListWidthRef = React.useRef(0);
  const lyricsListDocumentDragReleaseRef = React.useRef<(() => void) | null>(null);
  const lyricsPreviewContentRef = React.useRef<HTMLDivElement>(null);
  const lyricsStageRef = React.useRef<HTMLDivElement>(null);
  const lyricsStageHeightRef = React.useRef<number | null>(null);
  const lyricsStageResizeRef = React.useRef<{
    bounds: QQMusicLyricsStageHeightBounds;
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const lyricsStagePreviewFrameRef = React.useRef<number | null>(null);
  const pendingLyricsStageHeightRef = React.useRef(0);
  const lyricsStageDocumentDragReleaseRef = React.useRef<(() => void) | null>(null);
  const lyricsViewportResizeTimerRef = React.useRef<number | null>(null);
  const lastLyricsViewportSizeRef = React.useRef<{ height: number; width: number } | null>(null);

  const timeline = React.useMemo(() => {
    const cues = preview ? parseTimedText(preview.qrcXml) : [];
    return {
      cues,
      duration: cues.reduce((maximum, cue) => Math.max(maximum, cue.end), 0),
      segmentCount: cues.reduce(
        (sum, cue) => sum + (cue.segmentLines?.[0]?.length || 0),
        0,
      ),
    };
  }, [preview]);
  const { cues, duration, segmentCount } = timeline;
  const focusedCueIndex = resolveFocusedTimedTextCueIndex(cues, currentTime);
  const previewSongId = preview?.song.songId ?? null;
  const contextualTarget = React.useMemo(
    () => contextualSaveDirectory(selectedTreeNode, rootNodeId),
    [rootNodeId, selectedTreeNode],
  );
  const statusReady = status?.supported && status.libraryDatabaseFound && status.cacheDatabaseFound;

  const syncLyricsListBounds = React.useCallback(() => {
    if (!lyricsLayoutRef.current) return;
    const nextBounds = getQQMusicLyricsListWidthBounds(
      lyricsLayoutRef.current.getBoundingClientRect().width,
    );
    setLyricsListBounds((currentBounds) => (
      currentBounds.min === nextBounds.min && currentBounds.max === nextBounds.max
        ? currentBounds
        : nextBounds
    ));
  }, []);

  const applyLyricsListWidthPreview = React.useCallback((width: number) => {
    lyricsLayoutRef.current?.style.setProperty('--qq-list-width', `${width}px`);
  }, []);

  const flushLyricsListWidthPreview = React.useCallback(() => {
    if (lyricsListPreviewFrameRef.current !== null) {
      cancelAnimationFrame(lyricsListPreviewFrameRef.current);
      lyricsListPreviewFrameRef.current = null;
    }
    applyLyricsListWidthPreview(pendingLyricsListWidthRef.current);
  }, [applyLyricsListWidthPreview]);

  const previewLyricsListWidth = React.useCallback((
    width: number,
    bounds: QQMusicLyricsListWidthBounds,
  ) => {
    const nextWidth = clampQQMusicLyricsListWidth(width, bounds);
    lyricsListWidthRef.current = nextWidth;
    pendingLyricsListWidthRef.current = nextWidth;
    if (lyricsListPreviewFrameRef.current === null) {
      lyricsListPreviewFrameRef.current = requestAnimationFrame(() => {
        lyricsListPreviewFrameRef.current = null;
        applyLyricsListWidthPreview(pendingLyricsListWidthRef.current);
      });
    }
    return nextWidth;
  }, [applyLyricsListWidthPreview]);

  const finishLyricsListResize = React.useCallback((target?: HTMLElement, pointerId?: number) => {
    const resize = lyricsListResizeRef.current;
    if (!resize) return;
    flushLyricsListWidthPreview();
    lyricsListResizeRef.current = null;
    setLyricsListResizing(false);
    lyricsListDocumentDragReleaseRef.current?.();
    lyricsListDocumentDragReleaseRef.current = null;
    if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    setLyricsListWidth(lyricsListWidthRef.current);
  }, [flushLyricsListWidthPreview]);

  const handleLyricsListResizePointerDown = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      event.button !== 0
      || lyricsListResizeRef.current
      || !lyricsLayoutRef.current
      || !lyricsSearchPaneRef.current
    ) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const bounds = getQQMusicLyricsListWidthBounds(lyricsLayoutRef.current.getBoundingClientRect().width);
    const startWidth = clampQQMusicLyricsListWidth(
      lyricsSearchPaneRef.current.getBoundingClientRect().width,
      bounds,
    );
    lyricsListWidthRef.current = startWidth;
    pendingLyricsListWidthRef.current = startWidth;
    applyLyricsListWidthPreview(startWidth);
    lyricsListResizeRef.current = {
      bounds,
      pointerId: event.pointerId,
      startWidth,
      startX: event.clientX,
    };
    setLyricsListBounds(bounds);
    setLyricsListWidth(startWidth);
    setLyricsListResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    lyricsListDocumentDragReleaseRef.current?.();
    lyricsListDocumentDragReleaseRef.current = beginDocumentDragSession('col-resize');
  }, [applyLyricsListWidthPreview]);

  const handleLyricsListResizePointerMove = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const resize = lyricsListResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    previewLyricsListWidth(
      resize.startWidth + event.clientX - resize.startX,
      resize.bounds,
    );
  }, [previewLyricsListWidth]);

  const handleLyricsListResizePointerUp = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (lyricsListResizeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishLyricsListResize(event.currentTarget, event.pointerId);
  }, [finishLyricsListResize]);

  const handleLyricsListResizeKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!lyricsLayoutRef.current || !lyricsSearchPaneRef.current) return;
    const bounds = getQQMusicLyricsListWidthBounds(lyricsLayoutRef.current.getBoundingClientRect().width);
    const currentWidth = clampQQMusicLyricsListWidth(
      lyricsSearchPaneRef.current.getBoundingClientRect().width,
      bounds,
    );
    const nextWidth = getQQMusicLyricsListKeyboardWidth(currentWidth, event.key, bounds);
    if (nextWidth === null) return;
    event.preventDefault();
    event.stopPropagation();
    setLyricsListBounds(bounds);
    lyricsListWidthRef.current = nextWidth;
    pendingLyricsListWidthRef.current = nextWidth;
    applyLyricsListWidthPreview(nextWidth);
    setLyricsListWidth(nextWidth);
  }, [applyLyricsListWidthPreview]);

  const applyLyricsStageHeightPreview = React.useCallback((height: number) => {
    lyricsPreviewContentRef.current?.style.setProperty('--qq-stage-height', `${height}px`);
  }, []);

  const syncLyricsStageBounds = React.useCallback(() => {
    if (!lyricsPreviewContentRef.current) return;
    const nextBounds = getQQMusicLyricsStageHeightBounds(
      lyricsPreviewContentRef.current.getBoundingClientRect().height,
    );
    setLyricsStageBounds((currentBounds) => (
      currentBounds.min === nextBounds.min && currentBounds.max === nextBounds.max
        ? currentBounds
        : nextBounds
    ));
    if (lyricsStageHeightRef.current === null) return;
    const nextHeight = clampQQMusicLyricsStageHeight(
      lyricsStageHeightRef.current,
      nextBounds,
    );
    lyricsStageHeightRef.current = nextHeight;
    pendingLyricsStageHeightRef.current = nextHeight;
    applyLyricsStageHeightPreview(nextHeight);
    setLyricsStageHeight(currentHeight => (
      currentHeight === nextHeight ? currentHeight : nextHeight
    ));
  }, [applyLyricsStageHeightPreview]);

  const flushLyricsStageHeightPreview = React.useCallback(() => {
    if (lyricsStagePreviewFrameRef.current !== null) {
      cancelAnimationFrame(lyricsStagePreviewFrameRef.current);
      lyricsStagePreviewFrameRef.current = null;
    }
    applyLyricsStageHeightPreview(pendingLyricsStageHeightRef.current);
  }, [applyLyricsStageHeightPreview]);

  const previewLyricsStageHeight = React.useCallback((
    height: number,
    bounds: QQMusicLyricsStageHeightBounds,
  ) => {
    const nextHeight = clampQQMusicLyricsStageHeight(height, bounds);
    lyricsStageHeightRef.current = nextHeight;
    pendingLyricsStageHeightRef.current = nextHeight;
    if (lyricsStagePreviewFrameRef.current === null) {
      lyricsStagePreviewFrameRef.current = requestAnimationFrame(() => {
        lyricsStagePreviewFrameRef.current = null;
        applyLyricsStageHeightPreview(pendingLyricsStageHeightRef.current);
      });
    }
    return nextHeight;
  }, [applyLyricsStageHeightPreview]);

  const cancelLyricsStageResizeSession = React.useCallback(() => {
    if (lyricsStagePreviewFrameRef.current !== null) {
      cancelAnimationFrame(lyricsStagePreviewFrameRef.current);
      lyricsStagePreviewFrameRef.current = null;
    }
    lyricsStageResizeRef.current = null;
    lyricsStageDocumentDragReleaseRef.current?.();
    lyricsStageDocumentDragReleaseRef.current = null;
  }, []);

  const finishLyricsStageResize = React.useCallback((target?: HTMLElement, pointerId?: number) => {
    const resize = lyricsStageResizeRef.current;
    if (!resize) return;
    flushLyricsStageHeightPreview();
    cancelLyricsStageResizeSession();
    setLyricsStageResizing(false);
    if (target && pointerId !== undefined && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    setLyricsStageHeight(lyricsStageHeightRef.current);
  }, [cancelLyricsStageResizeSession, flushLyricsStageHeightPreview]);

  const handleLyricsStageResizePointerDown = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      event.button !== 0
      || lyricsStageResizeRef.current
      || !lyricsPreviewContentRef.current
      || !lyricsStageRef.current
    ) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const bounds = getQQMusicLyricsStageHeightBounds(
      lyricsPreviewContentRef.current.getBoundingClientRect().height,
    );
    const startHeight = clampQQMusicLyricsStageHeight(
      lyricsStageRef.current.getBoundingClientRect().height,
      bounds,
    );
    lyricsStageHeightRef.current = startHeight;
    pendingLyricsStageHeightRef.current = startHeight;
    applyLyricsStageHeightPreview(startHeight);
    lyricsStageResizeRef.current = {
      bounds,
      pointerId: event.pointerId,
      startHeight,
      startY: event.clientY,
    };
    setLyricsStageBounds(bounds);
    setLyricsStageHeight(startHeight);
    setLyricsStageResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    lyricsStageDocumentDragReleaseRef.current?.();
    lyricsStageDocumentDragReleaseRef.current = beginDocumentDragSession('row-resize');
  }, [applyLyricsStageHeightPreview]);

  const handleLyricsStageResizePointerMove = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const resize = lyricsStageResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.stopPropagation();
    previewLyricsStageHeight(
      resize.startHeight + event.clientY - resize.startY,
      resize.bounds,
    );
  }, [previewLyricsStageHeight]);

  const handleLyricsStageResizePointerUp = React.useCallback((
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (lyricsStageResizeRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    finishLyricsStageResize(event.currentTarget, event.pointerId);
  }, [finishLyricsStageResize]);

  const handleLyricsStageResizeKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!lyricsPreviewContentRef.current || !lyricsStageRef.current) return;
    const bounds = getQQMusicLyricsStageHeightBounds(
      lyricsPreviewContentRef.current.getBoundingClientRect().height,
    );
    const currentHeight = clampQQMusicLyricsStageHeight(
      lyricsStageRef.current.getBoundingClientRect().height,
      bounds,
    );
    const nextHeight = getQQMusicLyricsStageKeyboardHeight(currentHeight, event.key, bounds);
    if (nextHeight === null) return;
    event.preventDefault();
    event.stopPropagation();
    setLyricsStageBounds(bounds);
    lyricsStageHeightRef.current = nextHeight;
    pendingLyricsStageHeightRef.current = nextHeight;
    applyLyricsStageHeightPreview(nextHeight);
    setLyricsStageHeight(nextHeight);
  }, [applyLyricsStageHeightPreview]);

  const togglePreviewMode = React.useCallback(() => {
    if (previewMode === 'timeline') {
      finishLyricsStageResize();
      setPlaying(false);
      setPreviewMode('xml');
      return;
    }
    setPreviewMode('timeline');
  }, [finishLyricsStageResize, previewMode]);

  const loadStatus = React.useCallback(async () => {
    setStatusError('');
    try {
      setStatus(await fetchQQMusicLyricsStatus());
    } catch (error) {
      setStatusError(errorMessage(error));
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    setSelectedSaveDirectory(loadQQMusicLyricsSaveDirectory(libraryId));
    setSaveDraftDirectory(null);
    setSaveDialogVisible(false);
    setDirectoryPickerVisible(false);
  }, [libraryId]);

  React.useLayoutEffect(() => {
    if (statusReady) syncLyricsListBounds();
  }, [statusReady, syncLyricsListBounds]);

  React.useLayoutEffect(() => {
    if (
      !statusReady
      || !preview
      || previewMode !== 'timeline'
      || !lyricsPreviewContentRef.current
    ) {
      return undefined;
    }
    const previewContent = lyricsPreviewContentRef.current;
    const handlePreviewContentResize = () => {
      syncLyricsStageBounds();
      const { height, width } = previewContent.getBoundingClientRect();
      const nextSize = {
        height: Math.round(height),
        width: Math.round(width),
      };
      const previousSize = lastLyricsViewportSizeRef.current;
      lastLyricsViewportSizeRef.current = nextSize;
      if (
        !previousSize
        || (previousSize.height === nextSize.height && previousSize.width === nextSize.width)
        || lyricsListResizeRef.current
        || lyricsStageResizeRef.current
      ) {
        return;
      }
      if (lyricsViewportResizeTimerRef.current !== null) {
        window.clearTimeout(lyricsViewportResizeTimerRef.current);
      }
      lyricsViewportResizeTimerRef.current = window.setTimeout(() => {
        lyricsViewportResizeTimerRef.current = null;
        setLyricsViewportRevision(currentRevision => currentRevision + 1);
      }, 80);
    };
    handlePreviewContentResize();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handlePreviewContentResize);
    resizeObserver?.observe(previewContent);
    return () => {
      resizeObserver?.disconnect();
      if (lyricsViewportResizeTimerRef.current !== null) {
        window.clearTimeout(lyricsViewportResizeTimerRef.current);
        lyricsViewportResizeTimerRef.current = null;
      }
      lastLyricsViewportSizeRef.current = null;
      cancelLyricsStageResizeSession();
    };
  }, [
    cancelLyricsStageResizeSession,
    preview,
    previewMode,
    statusReady,
    syncLyricsStageBounds,
  ]);

  React.useEffect(() => {
    if (statusReady) return;
    finishLyricsListResize();
    cancelLyricsStageResizeSession();
    setLyricsListResizing(false);
    setLyricsStageResizing(false);
  }, [cancelLyricsStageResizeSession, finishLyricsListResize, statusReady]);

  React.useEffect(() => {
    let active = true;
    void fetchQQMusicStorageProviders()
      .then((result) => {
        if (!active) return;
        setStorageProviders(result.providers);
        setDefaultStorageProvider(result.defaultProvider);
      })
      .catch(() => {
        if (!active) return;
        setStorageProviders([]);
        setDefaultStorageProvider('');
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => () => {
    previewRequestRef.current += 1;
    searchRequestRef.current += 1;
    if (lyricsListPreviewFrameRef.current !== null) {
      cancelAnimationFrame(lyricsListPreviewFrameRef.current);
      lyricsListPreviewFrameRef.current = null;
    }
    if (lyricsStagePreviewFrameRef.current !== null) {
      cancelAnimationFrame(lyricsStagePreviewFrameRef.current);
      lyricsStagePreviewFrameRef.current = null;
    }
    if (lyricsViewportResizeTimerRef.current !== null) {
      window.clearTimeout(lyricsViewportResizeTimerRef.current);
      lyricsViewportResizeTimerRef.current = null;
    }
    lyricsListResizeRef.current = null;
    lyricsStageResizeRef.current = null;
    lyricsListDocumentDragReleaseRef.current?.();
    lyricsListDocumentDragReleaseRef.current = null;
    lyricsStageDocumentDragReleaseRef.current?.();
    lyricsStageDocumentDragReleaseRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = (now: number) => {
      const nextTime = playbackRef.current.startingTime + (now - playbackRef.current.startedAt) / 1000;
      if (nextTime >= duration) {
        setCurrentTime(duration);
        setPlaying(false);
        return;
      }
      setCurrentTime(nextTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing]);

  React.useLayoutEffect(() => {
    const cue = cues[focusedCueIndex];
    const sweepPercent = cue
      ? resolveTimedTextCueSweepPercent(cue, 0, currentTime)
      : 0;
    const progress = `${sweepPercent}%`;
    activeStageSweepRef.current?.style.setProperty('--qq-lyric-progress', progress);
    activeTimelineSweepRef.current?.style.setProperty('--qq-lyric-progress', progress);
  }, [cues, currentTime, focusedCueIndex, previewMode, statusReady]);

  React.useEffect(() => {
    if (previewSongId === null) {
      lastFollowedCueRef.current = null;
      return undefined;
    }
    if (!statusReady || previewMode !== 'timeline' || focusedCueIndex < 0) {
      return undefined;
    }
    const previousCue = lastFollowedCueRef.current;
    const nextCue = {
      cueIndex: focusedCueIndex,
      songId: previewSongId,
    };
    const shouldAnimate = shouldAnimateQQMusicLyricsFollow(
      previousCue,
      nextCue,
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    );
    const frame = requestAnimationFrame(() => {
      const behavior: ScrollBehavior = shouldAnimate ? 'smooth' : 'auto';
      let followed = false;
      if (stageScrollRef.current && activeStageLineRef.current) {
        scrollLyricsRowToCenter(stageScrollRef.current, activeStageLineRef.current, behavior);
        followed = true;
      }
      if (timelineListRef.current && activeRowRef.current) {
        scrollLyricsRowToCenter(timelineListRef.current, activeRowRef.current, behavior);
        followed = true;
      }
      if (followed) lastFollowedCueRef.current = nextCue;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    focusedCueIndex,
    lyricsListWidth,
    lyricsStageHeight,
    lyricsViewportRevision,
    previewMode,
    previewSongId,
    statusReady,
  ]);

  const handleSearch = React.useCallback(async (
    scope: QQMusicLyricsSearchScope = searchScope,
    append = false,
  ) => {
    const requestId = ++searchRequestRef.current;
    const searchInput = append
      ? lastSearchRef.current
      : { query, scope, singer };
    if (append) {
      setLoadingMore(true);
    } else {
      finishLyricsStageResize();
      lastSearchRef.current = searchInput;
      previewRequestRef.current += 1;
      setSearching(true);
      setLoadingMore(false);
      setHasMore(false);
      setSelectedSongId(null);
      setPreview(null);
      setPreviewError('');
      setFileName('');
      setSaveDialogVisible(false);
      setCurrentTime(0);
      setPlaying(false);
    }
    setSearchError('');
    setHasSearched(true);
    try {
      const nextSongs = await searchLocalQQMusicLyrics({
        cachedOnly: searchInput.scope === 'cached',
        limit: SEARCH_PAGE_SIZE,
        offset: append ? songs.length : 0,
        query: searchInput.query,
        singer: searchInput.singer,
      });
      if (requestId !== searchRequestRef.current) return;
      setSongs((currentSongs) => {
        if (!append) return nextSongs;
        const knownSongIds = new Set(currentSongs.map(song => song.songId));
        return [...currentSongs, ...nextSongs.filter(song => !knownSongIds.has(song.songId))];
      });
      setHasMore(nextSongs.length === SEARCH_PAGE_SIZE);
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      if (!append) setSongs([]);
      setSearchError(errorMessage(error));
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, [finishLyricsStageResize, query, searchScope, singer, songs.length]);

  React.useEffect(() => {
    if (!statusReady || initialListRequestedRef.current) return;
    initialListRequestedRef.current = true;
    void handleSearch('cached');
  }, [handleSearch, statusReady]);

  const handleScopeChange = React.useCallback((scope: QQMusicLyricsSearchScope) => {
    if (scope === searchScope) return;
    setSearchScope(scope);
    void handleSearch(scope);
  }, [handleSearch, searchScope]);

  const handlePreview = React.useCallback(async (song: QQMusicLyricsSong) => {
    finishLyricsStageResize();
    const requestId = ++previewRequestRef.current;
    setSelectedSongId(song.songId);
    setPreviewError('');
    setPlaying(false);
    if (!song.cachedKinds.includes('qrc')) {
      setPreviewing(false);
      setPreview(null);
      setFileName('');
      setCurrentTime(0);
      setPreviewError('这首歌没有本地 QRC 缓存');
      return;
    }
    setPreviewing(true);
    try {
      const nextPreview = await loadLocalQQMusicLyricsPreview(song.songId);
      const nextCues = parseTimedText(nextPreview.qrcXml);
      if (requestId !== previewRequestRef.current) return;
      setPreview(nextPreview);
      setFileName(nextPreview.fileName);
      setCurrentTime(nextCues[0]?.start ?? 0);
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setPreview(null);
      setPreviewError(errorMessage(error));
    } finally {
      if (requestId === previewRequestRef.current) setPreviewing(false);
    }
  }, [finishLyricsStageResize]);

  const togglePlayback = React.useCallback(() => {
    if (!preview || duration <= 0) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    const startingTime = currentTime >= duration ? cues[0]?.start ?? 0 : currentTime;
    setCurrentTime(startingTime);
    playbackRef.current = { startedAt: performance.now(), startingTime };
    setPlaying(true);
  }, [cues, currentTime, duration, playing, preview]);

  const handleSeek = React.useCallback((nextTime: number) => {
    setCurrentTime(nextTime);
    if (playing) {
      playbackRef.current = { startedAt: performance.now(), startingTime: nextTime };
    }
  }, [playing]);

  const handleSave = React.useCallback(async () => {
    if (!preview || !saveDraftDirectory || !saveDraftName.trim()) return;
    setSaving(true);
    try {
      const directoryIsValid = await validateQQMusicLyricsSaveDirectory(
        libraryId,
        saveDraftDirectory.parentId,
      );
      if (!directoryIsValid) {
        const invalidParentId = saveDraftDirectory.parentId;
        const fallbackDirectory = fallbackSaveDirectory(
          contextualTarget,
          rootNodeId,
          invalidParentId,
        );
        clearQQMusicLyricsSaveDirectory(libraryId);
        setSelectedSaveDirectory(null);
        setSaveDraftDirectory(fallbackDirectory);
        Toast.warning(
          fallbackDirectory
            ? '原保存目录已失效，已回退到可用目录，请确认后再次保存'
            : '原保存目录已失效，请重新选择保存目录',
        );
        return;
      }
      const normalizedName = saveDraftName.trim().toLowerCase().endsWith('.qrc.xml')
        ? saveDraftName.trim()
        : `${saveDraftName.trim()}.qrc.xml`;
      await saveQQMusicLyricsToLibrary({
        content: preview.qrcXml,
        fileName: normalizedName,
        libraryId,
        parentId: saveDraftDirectory.parentId,
        storageProvider: saveDraftStorageProvider || undefined,
      });
      await onRefreshDirectory?.(saveDraftDirectory.parentId);
      setFileName(normalizedName);
      setSelectedSaveDirectory(saveDraftDirectory);
      saveQQMusicLyricsSaveDirectory(libraryId, saveDraftDirectory);
      setSaveDialogVisible(false);
      Toast.success('QRC 歌词已保存到资料库');
    } catch (error) {
      Toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [
    contextualTarget,
    libraryId,
    onRefreshDirectory,
    preview,
    rootNodeId,
    saveDraftDirectory,
    saveDraftName,
    saveDraftStorageProvider,
  ]);

  const openSaveDialog = React.useCallback(() => {
    if (!preview) return;
    setSaveDraftName(fileName);
    setSaveDraftStorageProvider(defaultStorageProvider);
    setSaveDraftDirectory(selectedSaveDirectory || contextualTarget);
    setSaveDialogVisible(true);
  }, [contextualTarget, defaultStorageProvider, fileName, preview, selectedSaveDirectory]);

  const handleSaveDirectorySelection = React.useCallback((selection: LibraryNodePickerSelection) => {
    const directory = {
      parentId: selection.node.id,
      pathLabel: selection.pathLabel,
    };
    setSaveDraftDirectory(directory);
    setSelectedSaveDirectory(directory);
    saveQQMusicLyricsSaveDirectory(libraryId, directory);
    setDirectoryPickerVisible(false);
  }, [libraryId]);

  return (
    <QQMusicLyricsWorkspace>
      <QQMusicLyricsSaveModalStyle />
      <WorkspaceHeader>
        <div className="header-copy">
          <div className="header-title">QQ 音乐歌词</div>
          <div className="header-desc">本机曲库与 QRC 逐字时间轴</div>
        </div>
        <div className="qq-status">
          {statusReady ? <IconTickCircle aria-hidden="true" /> : <IconAlertCircle aria-hidden="true" />}
          <span className="qq-status-path" title={status?.cacheDatabasePath || statusError}>
            {statusError || (statusReady ? 'QQMusicMac 本地缓存可用' : '本地缓存不可用')}
          </span>
          <Button
            aria-label="刷新本地状态"
            className="qq-icon-button"
            icon={<IconRefresh />}
            theme="borderless"
            title="刷新本地状态"
            onClick={loadStatus}
          />
        </div>
      </WorkspaceHeader>

      {!status && !statusError ? <div className="qq-loading"><Spin /></div> : null}
      {status && !status.supported ? (
        <div className="qq-unsupported"><IconAlertCircle size="large" />QQ 音乐本地歌词目前仅支持 macOS</div>
      ) : null}
      {(statusError || (status?.supported && !statusReady)) ? (
        <div className="qq-error">
          <IconAlertCircle size="large" />
          {statusError || (!status?.libraryDatabaseFound ? '未找到 QQMusicMac 本地曲库' : '未找到 QQMusicMac 歌词缓存')}
        </div>
      ) : null}

      {statusReady ? (
        <div
          ref={lyricsLayoutRef}
          className="qq-layout"
          data-resizing={lyricsListResizing ? 'true' : 'false'}
        >
          <section ref={lyricsSearchPaneRef} className="qq-search-pane" aria-label="本地歌曲搜索">
            <div className="qq-search-scope">
              <div className="qq-search-scope-tabs" role="tablist" aria-label="歌曲范围">
                <button
                  aria-selected={searchScope === 'cached'}
                  className={searchScope === 'cached' ? 'is-active' : ''}
                  onClick={() => handleScopeChange('cached')}
                  role="tab"
                  type="button"
                >本地已有</button>
                <button
                  aria-selected={searchScope === 'library'}
                  className={searchScope === 'library' ? 'is-active' : ''}
                  onClick={() => handleScopeChange('library')}
                  role="tab"
                  type="button"
                >全部曲库</button>
              </div>
              <span className="qq-search-scope-count">{searching ? '读取中' : `${songs.length} 首`}</span>
            </div>
            <form
              className="qq-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSearch();
              }}
            >
              <Input
                aria-label="歌曲名"
                className="qq-song-input"
                placeholder="歌曲名"
                value={query}
                onChange={setQuery}
              />
              <Input
                aria-label="歌手"
                className="qq-singer-input"
                placeholder="歌手"
                value={singer}
                onChange={setSinger}
              />
              <Button
                aria-label={searchScope === 'cached' ? '刷新本地已有歌词' : '搜索本地曲库'}
                className="qq-icon-button"
                htmlType="submit"
                icon={hasSearched ? <IconRefresh /> : <IconSearch />}
                loading={searching}
                theme="borderless"
                title={searchScope === 'cached' ? '刷新本地已有歌词' : '搜索本地曲库'}
              />
            </form>
            <div className="qq-results">
              {searching ? <div className="qq-loading"><Spin /></div> : null}
              {!searching && searchError ? <div className="qq-error"><IconAlertCircle />{searchError}</div> : null}
              {!searching && !searchError && hasSearched && songs.length === 0 ? (
                <div className="qq-empty">
                  {searchScope === 'cached'
                    ? (query.trim() || singer.trim() ? '本地已有歌词中没有匹配歌曲' : '本机还没有可用的 QRC 歌词缓存')
                    : '没有匹配的本地歌曲'}
                </div>
              ) : null}
              {!searching && !searchError && !hasSearched ? (
                <div className="qq-empty"><IconSearch size="large" />本地曲库</div>
              ) : null}
              {!searching ? (
                <QQMusicLyricsSongList
                  onPreview={handlePreview}
                  selectedSongId={selectedSongId}
                  songs={songs}
                />
              ) : null}
              {!searching && !searchError && hasMore ? (
                <div className="qq-load-more">
                  <Button
                    loading={loadingMore}
                    theme="borderless"
                    onClick={() => void handleSearch(searchScope, true)}
                  >加载更多</Button>
                </div>
              ) : null}
            </div>
          </section>

          <div
            aria-label="调整歌词列表宽度"
            aria-orientation="vertical"
            aria-valuemax={lyricsListBounds.max}
            aria-valuemin={lyricsListBounds.min}
            aria-valuenow={lyricsListWidth ?? lyricsListBounds.max}
            className="qq-list-resize-handle"
            data-resizing={lyricsListResizing ? 'true' : 'false'}
            role="separator"
            tabIndex={0}
            onFocus={syncLyricsListBounds}
            onKeyDown={handleLyricsListResizeKeyDown}
            onLostPointerCapture={() => finishLyricsListResize()}
            onPointerCancel={handleLyricsListResizePointerUp}
            onPointerDown={handleLyricsListResizePointerDown}
            onPointerMove={handleLyricsListResizePointerMove}
            onPointerUp={handleLyricsListResizePointerUp}
          />

          <section className="qq-preview-pane" aria-label="QRC 预览">
            {previewing ? <div className="qq-loading"><Spin /></div> : null}
            {!previewing && previewError ? <div className="qq-error"><IconAlertCircle />{previewError}</div> : null}
            {!previewing && !previewError && !preview ? (
              <div className="qq-empty"><IconMusic size="extra-large" />逐字时间轴预览</div>
            ) : null}
            {!previewing && preview ? (
              <>
                <div className="qq-preview-toolbar">
                  <div className="qq-preview-identity">
                    <div className="qq-preview-title">{preview.song.name}</div>
                    <div className="qq-preview-meta">
                      {preview.song.singer} · {cues.length} 行 · {segmentCount} 个时间片
                    </div>
                  </div>
                  <div className="qq-preview-actions">
                    <Tag color="green" size="small">QRC</Tag>
                    <div className="qq-preview-icon-actions">
                      <Button
                        aria-label={previewMode === 'timeline' ? '查看 XML 文件' : '返回歌词时间轴'}
                        className="qq-icon-button"
                        icon={previewMode === 'timeline' ? <IconFile /> : <IconList />}
                        theme="borderless"
                        title={previewMode === 'timeline' ? '查看 XML 文件' : '返回歌词时间轴'}
                        onClick={togglePreviewMode}
                      />
                      <Button
                        aria-label="保存到资料库"
                        className="qq-icon-button qq-save-trigger"
                        icon={<IconSaveStroked />}
                        theme="borderless"
                        title="保存到资料库"
                        onClick={openSaveDialog}
                      />
                    </div>
                  </div>
                </div>
                <div
                  ref={lyricsPreviewContentRef}
                  className="qq-preview-content"
                  data-mode={previewMode}
                >
                  {previewMode === 'xml' ? (
                    <QQMusicLyricsXmlPreview content={preview.qrcXml} />
                  ) : (
                    <>
                      <div ref={lyricsStageRef} className="qq-stage">
                        <div ref={stageScrollRef} className="qq-stage-scroll">
                          <div className="qq-stage-roller" role="list" aria-label="滚动歌词预览">
                            <QQMusicLyricsStageCueList
                              activeCueRef={activeStageLineRef}
                              activeSweepRef={activeStageSweepRef}
                              cues={cues}
                              focusedCueIndex={focusedCueIndex}
                            />
                          </div>
                        </div>
                      </div>
                      <div
                        aria-label="调整歌词预览高度"
                        aria-orientation="horizontal"
                        aria-valuemax={lyricsStageBounds.max}
                        aria-valuemin={lyricsStageBounds.min}
                        aria-valuenow={clampQQMusicLyricsStageHeight(
                          lyricsStageHeight ?? lyricsStageBounds.max,
                          lyricsStageBounds,
                        )}
                        className="qq-stage-resize-handle"
                        data-resizing={lyricsStageResizing ? 'true' : 'false'}
                        role="separator"
                        tabIndex={0}
                        onFocus={syncLyricsStageBounds}
                        onKeyDown={handleLyricsStageResizeKeyDown}
                        onLostPointerCapture={() => finishLyricsStageResize()}
                        onPointerCancel={handleLyricsStageResizePointerUp}
                        onPointerDown={handleLyricsStageResizePointerDown}
                        onPointerMove={handleLyricsStageResizePointerMove}
                        onPointerUp={handleLyricsStageResizePointerUp}
                      />
                      <div ref={timelineListRef} className="qq-timeline-list">
                        <QQMusicLyricsTimelineCueList
                          activeCueRef={activeRowRef}
                          activeSweepRef={activeTimelineSweepRef}
                          cues={cues}
                          focusedCueIndex={focusedCueIndex}
                        />
                      </div>
                      <div className="qq-transport">
                        <Button
                          aria-label={playing ? '暂停预览' : '播放预览'}
                          className="qq-icon-button"
                          icon={playing ? <IconPause /> : <IconPlay />}
                          theme="borderless"
                          title={playing ? '暂停预览' : '播放预览'}
                          onClick={togglePlayback}
                        />
                        <span className="qq-time">{formatTime(currentTime)}</span>
                        <div className="qq-progress">
                          <input
                            aria-label="预览进度"
                            disabled={duration <= 0}
                            max={Math.max(duration, 0)}
                            min={0}
                            step={0.01}
                            type="range"
                            value={Math.min(currentTime, Math.max(duration, 0))}
                            onChange={event => handleSeek(Number(event.currentTarget.value))}
                          />
                          <span className="qq-progress-track" aria-hidden="true">
                            <span style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }} />
                          </span>
                        </div>
                        <span className="qq-time">{formatTime(duration)}</span>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      <Modal
        cancelButtonProps={{ disabled: saving }}
        cancelText="取消"
        centered
        className="qqmusic-lyrics-save-modal"
        closable={!saving}
        confirmLoading={saving}
        maskClosable={false}
        okButtonProps={{ disabled: !saveDraftDirectory || !saveDraftName.trim() }}
        okText="保存"
        title="保存 QRC 歌词"
        visible={saveDialogVisible}
        width={440}
        onCancel={() => {
          if (!saving) {
            setDirectoryPickerVisible(false);
            setSaveDialogVisible(false);
          }
        }}
        onOk={() => void handleSave()}
      >
        <QQMusicLyricsSaveDialogContent>
          <label className="qq-save-field" htmlFor="qqmusic-save-file-name">
            <span className="qq-save-label">文件名称</span>
            <Input
              autoFocus
              id="qqmusic-save-file-name"
              value={saveDraftName}
              onChange={setSaveDraftName}
            />
          </label>
          <div className="qq-save-field">
            <span className="qq-save-label">保存目录</span>
            <button
              aria-label="选择保存目录"
              className="qq-save-directory"
              disabled={saving}
              title={saveDraftDirectory?.pathLabel || '选择保存目录'}
              type="button"
              onClick={() => setDirectoryPickerVisible(true)}
            >
              {saveDraftDirectory?.pathLabel || '选择保存目录'}
            </button>
          </div>
          <label className="qq-save-field">
            <span className="qq-save-label">存储位置</span>
            <Select
              aria-label="存储 Provider"
              disabled={storageProviders.length === 0}
              dropdownStyle={{ maxHeight: 180, overflowY: 'auto' }}
              emptyContent="没有可用 Provider"
              optionList={storageProviders.map(provider => ({
                label: `${provider.label || provider.alias}${provider.isDefault ? '（默认）' : ''}`,
                value: provider.alias,
              }))}
              placeholder="使用默认 Provider"
              position="bottomLeft"
              value={saveDraftStorageProvider || undefined}
              onChange={value => setSaveDraftStorageProvider(String(value || ''))}
            />
          </label>
        </QQMusicLyricsSaveDialogContent>
      </Modal>

      <LibraryNodePickerModal
        confirmText="保存到此目录"
        displayMode="folders"
        libraryId={libraryId}
        title="选择歌词保存目录"
        visible={directoryPickerVisible}
        onCancel={() => setDirectoryPickerVisible(false)}
        onConfirm={handleSaveDirectorySelection}
      />
    </QQMusicLyricsWorkspace>
  );
};

export default ToolWorkspaceQQMusicLyrics;

import React from 'react';
import styled from 'styled-components';
import {
  Empty,
  Button,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  TextArea,
  Toast,
} from '@douyinfe/semi-ui';
import { IconDownload, IconFolder, IconPlus } from '@douyinfe/semi-icons';

import {
  LibraryNodePickerModal,
  type LibraryNodePickerSelection,
  type SelectedTreeNode,
} from '@/features/file-explorer';
import type { EmbeddedBrowserCapturedResource } from '@/features/embedded-browser/resources/types';
import {
  createManualMergePair,
  formatBytes,
  formatResourceTitle,
  mergeCapturedResources,
  transcodeCapturedResource,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource-panel-actions';
import {
  downloadEmbeddedBrowserHlsManifest,
  downloadEmbeddedBrowserHlsPlan,
  subscribeEmbeddedBrowserHlsTask,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource.api';
import {
  withResourceRefererHeader,
} from '@/features/embedded-browser/resources/services/embedded-browser-resource-request';
import {
  uploadLocalPathAndCreateNode,
} from '@/features/file-explorer/services/file.api';
import {
  getDesktopDefaultDownloadDirectory,
  pickDownloadDirectoryFromDesktop,
} from '@/features/file-explorer/services/desktop-download.api';
import {
  findMergeableResourcePair,
} from '@/features/embedded-browser/resources/model/embedded-browser-resource.presentation';
import {
  normalizeHlsKeyCandidateValue,
} from '@/features/embedded-browser/resources/model/embedded-browser-hls-key-verifier';

import {
  fetchAvailableTranslationModels,
  loadSubtitleFromLibraryNode,
  loadSubtitleTranslationPreferences,
  pickLocalSubtitleFile,
  saveSubtitleToLibraryNode,
  saveSubtitleToLocalFile,
  saveSubtitleTranslationPreferences,
  translateSubtitleRow,
  unloadOllamaModel,
} from './subtitle-translation.service';
import {
  subtitleTranslationRunner,
  type RunnerSnapshot,
} from './subtitle-translation.runner';
import {
  buildTranslatedSubtitleFileName,
  isSupportedSubtitleExtension,
  mergeAdjacentDuplicateRows,
} from './subtitle-translation.utils';
import {
  loadToolWorkspaceState,
  saveToolWorkspaceState,
} from './tool-workspace.state';
import type {
  SubtitleTranslationConfig,
  SubtitleTranslationDraft,
  SubtitleTranslationRow,
  ToolWorkspaceMediaHlsRequest,
  ToolWorkspaceMediaMode,
  ToolWorkspaceMediaRequest,
  ToolWorkspaceState,
  ToolWorkspaceToolId,
} from './types';

const Wrapper = styled.div`
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--app-bg);
`;

const ToolNav = styled.aside`
  border-right: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-sidebar-vibrancy) 88%, var(--app-bg) 12%);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  .title {
    font-size: 20px;
    font-weight: 700;
    color: var(--app-text);
  }

  .tool-card {
    appearance: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    text-align: left;
    padding: 16px 12px;
    border-radius: 12px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg-elevated) 88%, transparent);
    cursor: pointer;
  }

  .tool-card.is-active {
    border-color: var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .tool-card:disabled {
    cursor: default;
  }

  .tool-card-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--semi-color-primary);
  }

  .semi-button {
    min-height: 42px;
    font-size: 15px;
  }
`;

const MediaResourceList = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  overflow: hidden;

  .media-row {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 112px 120px 144px;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
  }

  .media-row:last-child {
    border-bottom: none;
  }

  .media-title {
    min-width: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .media-meta {
    font-size: 14px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WorkspaceMain = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const WorkspaceHeader = styled.div`
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--app-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .header-title {
    font-size: clamp(30px, 2.2vw, 36px);
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .header-desc {
    font-size: 16px;
    line-height: 1.75;
    color: var(--app-text-muted);
  }

  .header-tags {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
`;

const WorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const Panel = styled.section`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
  padding: 18px;

  .panel-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--app-text);
    margin-bottom: 12px;
  }

  .panel-desc {
    font-size: 16px;
    line-height: 1.75;
    color: var(--app-text-muted);
    margin-bottom: 14px;
  }
`;

const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .field.full {
    grid-column: 1 / -1;
  }

  .label {
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text-muted);
  }

  .models-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .semi-input-wrapper,
  .semi-input,
  .semi-input-number,
  .semi-input-number-input {
    font-size: 15px;
  }

  .semi-input-wrapper,
  .semi-input-number {
    min-height: 42px;
  }
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .semi-button {
    min-height: 42px;
    font-size: 15px;
  }

  .semi-tag {
    font-size: 14px;
  }

  .merge-status {
    font-size: 14px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .merge-status.ok {
    color: var(--app-text);
  }

  .save-target-mode-btn {
    height: 40px;
    min-width: 164px;
    border: none;
    border-radius: 999px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .save-target-mode-btn.local {
    background: color-mix(in srgb, #2f6fed 14%, var(--app-bg-elevated));
    color: color-mix(in srgb, #2f6fed 88%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #2f6fed 28%, transparent);
  }

  .save-target-mode-btn.internal {
    background: color-mix(in srgb, #1f9d63 16%, var(--app-bg-elevated));
    color: color-mix(in srgb, #1f9d63 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #1f9d63 30%, transparent);
  }

  .save-target-mode-btn:hover {
    color: var(--app-text);
    transform: translateY(-1px);
  }

  .save-target-mode-btn:active {
    transform: translateY(0);
  }

  .save-target-mode-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 66%, transparent);
    outline-offset: 2px;
  }

  .save-target-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .save-target-mode-label .semi-icon {
    font-size: 17px;
    transition: transform 180ms ease, opacity 180ms ease;
  }

  .save-target-mode-btn.local .save-target-mode-label .semi-icon {
    transform: rotate(0deg) scale(1);
  }

  .save-target-mode-btn.internal .save-target-mode-label .semi-icon {
    transform: rotate(-8deg) scale(1.06);
  }

  .save-target-mode-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    opacity: 0.88;
    transition: transform 160ms ease, opacity 160ms ease;
  }

  .save-target-mode-btn:hover .save-target-mode-switch {
    opacity: 1;
    transform: translateX(1px);
  }

  .save-target-tip {
    max-width: min(560px, 95vw);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transcode-format-field {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid var(--app-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg) 92%, transparent);
  }

  .transcode-format-label {
    font-size: 13px;
    color: var(--app-text-muted);
    white-space: nowrap;
  }

  .transcode-format-input {
    width: 128px;
  }

  .transcode-presets {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
`;

const ToolModeSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  .mode-btn {
    min-height: 42px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg) 88%, var(--app-bg-elevated));
    color: var(--app-text-muted);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
  }

  .mode-btn.is-active {
    border-color: var(--semi-color-primary);
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 82%, var(--app-bg));
    color: var(--app-text);
  }

  .mode-btn:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const MediaActionComposer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;

  .save-lane,
  .operations-lane {
    display: grid;
    gap: 12px;
  }

  .save-lane {
    grid-template-columns: 1fr;
  }

  .operations-lane {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  }

  .action-cluster {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-height: 64px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--app-border) 86%, transparent);
    background: color-mix(in srgb, var(--app-bg) 84%, var(--app-bg-elevated));
  }

  .save-target-cluster {
    min-width: 0;
    background: color-mix(in srgb, #2f6fed 7%, var(--app-bg));
  }

  .merge-cluster {
    background: color-mix(in srgb, #f2a93a 8%, var(--app-bg));
  }

  .transcode-cluster {
    background: color-mix(in srgb, #2f6fed 8%, var(--app-bg));
    align-items: center;
  }

  .transcode-controls {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .cluster-label {
    display: inline-flex;
    align-items: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--app-text);
    white-space: nowrap;
  }

  .semi-button {
    min-height: 42px;
    font-size: 15px;
  }

  .semi-tag {
    font-size: 14px;
  }

  .save-target-mode-btn {
    height: 44px;
    min-width: 182px;
    border: none;
    border-radius: 999px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
    transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  }

  .save-target-mode-btn.local {
    background: color-mix(in srgb, #2f6fed 14%, var(--app-bg-elevated));
    color: color-mix(in srgb, #2f6fed 88%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #2f6fed 28%, transparent);
  }

  .save-target-mode-btn.internal {
    background: color-mix(in srgb, #1f9d63 16%, var(--app-bg-elevated));
    color: color-mix(in srgb, #1f9d63 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #1f9d63 30%, transparent);
  }

  .save-target-mode-btn:hover {
    color: var(--app-text);
    transform: translateY(-1px);
  }

  .save-target-mode-btn:active {
    transform: translateY(0);
  }

  .save-target-mode-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 66%, transparent);
    outline-offset: 2px;
  }

  .save-target-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .save-target-mode-icon {
    width: 19px;
    height: 19px;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .save-target-mode-icon .mode-icon {
    position: absolute;
    inset: 0;
    margin: auto;
    font-size: 19px;
    transition: transform 180ms ease, opacity 180ms ease;
    opacity: 0;
    transform: scale(0.74) rotate(-18deg);
  }

  .save-target-mode-icon .mode-icon.active {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  .save-target-mode-btn.internal .save-target-mode-icon .mode-icon.active {
    transform: scale(1) rotate(-12deg);
  }

  .save-target-mode-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    opacity: 0.92;
    transition: transform 180ms ease, opacity 180ms ease;
  }

  .save-target-mode-btn.local .save-target-mode-switch {
    transform: rotate(0deg);
  }

  .save-target-mode-btn.internal .save-target-mode-switch {
    transform: rotate(180deg);
  }

  .save-target-mode-btn:hover .save-target-mode-switch {
    opacity: 1;
  }

  .save-path-line {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 360px;
    min-width: 260px;
  }

  .save-path-trigger {
    flex: 1;
    min-width: 220px;
    height: 42px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-bg) 90%, var(--app-bg-elevated));
    color: var(--app-text);
    padding: 0 12px;
    text-align: left;
    cursor: pointer;
    transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
  }

  .save-path-trigger:hover {
    border-color: color-mix(in srgb, var(--semi-color-primary) 52%, var(--app-border));
  }

  .save-path-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--semi-color-primary) 66%, transparent);
    outline-offset: 2px;
  }

  .save-path-trigger.is-empty {
    color: var(--app-text-muted);
  }

  .save-path-trigger.is-error {
    border-color: color-mix(in srgb, #db4652 80%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #db4652 36%, transparent);
    background: color-mix(in srgb, #db4652 10%, var(--app-bg));
  }

  .save-path-value {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    line-height: 1.4;
  }

  .save-path-required {
    font-size: 13px;
    font-weight: 600;
    color: #db4652;
    white-space: nowrap;
  }

  .transcode-type-block {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .transcode-format-label {
    font-size: 14px;
    color: var(--app-text-muted);
    white-space: nowrap;
  }

  .transcode-format-input {
    width: 140px;
  }

  .transcode-presets {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .transcode-pill {
    height: 32px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    border-radius: 999px;
    padding: 0 12px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    background: color-mix(in srgb, var(--app-bg) 86%, var(--app-bg-elevated));
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
  }

  .transcode-pill:hover:not(:disabled) {
    color: var(--app-text);
    border-color: color-mix(in srgb, var(--semi-color-primary) 52%, var(--app-border));
  }

  .transcode-pill.active {
    background: color-mix(in srgb, var(--semi-color-primary) 20%, var(--app-bg-elevated));
    border-color: color-mix(in srgb, var(--semi-color-primary) 68%, transparent);
    color: color-mix(in srgb, var(--semi-color-primary) 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 38%, transparent);
  }

  .transcode-pill:disabled {
    cursor: not-allowed;
    opacity: 0.56;
  }

  @media (max-width: 1400px) {
    .operations-lane {
      grid-template-columns: 1fr;
    }
  }
`;

const ImportExportSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 6px;
`;

const SUBTITLE_TABLE_HEADER_HEIGHT = 49;
const SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT = 64;
const SUBTITLE_TABLE_OVERSCAN_PX = SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT * 6;

const SubtitleTable = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  overflow: hidden;
  min-height: 280px;
  display: flex;
  flex-direction: column;

  .table-scroll {
    overflow: auto;
    max-height: min(62vh, 820px);
    will-change: scroll-position;
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 252px minmax(220px, 1fr) minmax(260px, 1fr) 92px;
    gap: 0;
    min-width: 900px;
  }

  .table-head {
    background: color-mix(in srgb, var(--app-bg-elevated) 94%, transparent);
    border-bottom: 1px solid var(--app-border);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .table-row {
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 72%, transparent);
    contain: layout style;
  }

  .table-row:last-child {
    border-bottom: none;
  }

  .virtual-spacer {
    width: 100%;
    min-width: 900px;
    pointer-events: none;
  }

  .cell {
    padding: 8px 12px;
    min-width: 0;
    display: flex;
    align-items: stretch;
  }

  .head-cell {
    font-size: 13px;
    font-weight: 700;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .time-cell {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    white-space: nowrap;
  }

  .time-index {
    font-size: 13px;
    color: var(--app-text-muted);
    flex: none;
  }

  .time-range {
    font-size: 14px;
    line-height: 1.4;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .source-cell {
    font-size: 14px;
    line-height: 1.5;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .translation-cell .semi-input-textarea-wrapper {
    min-height: 100%;
  }

  .translation-cell textarea {
    font-size: 14px;
    line-height: 1.5;
    min-height: 40px;
  }

  .translation-preview {
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    background: color-mix(in srgb, var(--app-bg) 94%, transparent);
    font-size: 14px;
    line-height: 1.5;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
    display: flex;
    align-items: center;
  }

  .translation-preview.placeholder {
    color: var(--app-text-muted);
  }

  .row-actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 100%;
  }

  .row-actions .semi-button {
    min-height: 32px;
    font-size: 13px;
    width: 100%;
    min-width: 0;
  }
`;

type SubtitleTableRowProps = {
  isActive: boolean;
  isEditing: boolean;
  isRunnerActive: boolean;
  onToggleEditingRow: (rowId: string) => void;
  onTranslationChange: (rowId: string, value: string) => void;
  onTranslateSingle: (rowId: string) => void;
  registerRowElement: (rowId: string, element: HTMLDivElement | null) => void;
  row: SubtitleTranslationRow;
};

const SubtitleTableRow = React.memo(({
  isActive,
  isEditing,
  isRunnerActive,
  onToggleEditingRow,
  onTranslationChange,
  onTranslateSingle,
  registerRowElement,
  row,
}: SubtitleTableRowProps) => (
  <div
    ref={(element) => registerRowElement(row.id, element)}
    className="table-row"
    data-row-id={row.id}
  >
    <div className="cell time-cell">
      <div className="time-index">#{row.index}</div>
      <div className="time-range" title={`${row.startTimestamp} → ${row.endTimestamp}`}>
        {row.startTimestamp} → {row.endTimestamp}
      </div>
    </div>
    <div className="cell source-cell" title={row.sourceText}>{row.sourceText}</div>
    <div className="cell translation-cell">
      {isEditing ? (
        <TextArea
          autoFocus
          autosize={{ minRows: 1, maxRows: 6 }}
          value={row.translatedText}
          placeholder="译文会出现在这里，也可以手动修改"
          onBlur={() => onToggleEditingRow(row.id)}
          onChange={(value) => onTranslationChange(row.id, value)}
        />
      ) : (
        <div
          className={`translation-preview ${String(row.translatedText || '').trim() ? '' : 'placeholder'}`}
          onClick={() => onToggleEditingRow(row.id)}
          title={String(row.translatedText || '').trim() || '点击编辑译文'}
        >
          {String(row.translatedText || '').trim() || '点击编辑译文'}
        </div>
      )}
    </div>
    <div className="cell row-actions">
      <Button
        size="small"
        loading={isActive}
        disabled={isRunnerActive && !isActive}
        onClick={() => onTranslateSingle(row.id)}
      >
        翻译
      </Button>
    </div>
  </div>
), (prevProps, nextProps) => (
  prevProps.row === nextProps.row
  && prevProps.isActive === nextProps.isActive
  && prevProps.isEditing === nextProps.isEditing
  && prevProps.isRunnerActive === nextProps.isRunnerActive
));

/* ---------- Virtual Subtitle Table (isolated scroll state) ---------- */

type VirtualSubtitleTableProps = {
  activeRowId: string | null;
  editingRowId: string | null;
  isRunnerActive: boolean;
  onToggleEditingRow: (rowId: string) => void;
  onTranslationChange: (rowId: string, value: string) => void;
  onTranslateSingle: (rowId: string) => void;
  resetKey: string;
  rows: SubtitleTranslationRow[];
};

const VirtualSubtitleTable: React.FC<VirtualSubtitleTableProps> = React.memo(({
  activeRowId,
  editingRowId,
  isRunnerActive,
  onToggleEditingRow,
  onTranslationChange,
  onTranslateSingle,
  resetKey,
  rows,
}) => {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const rowElementsRef = React.useRef(new Map<string, HTMLDivElement>());
  const rowHeightsRef = React.useRef(new Map<string, number>());
  const rowResizeObserverRef = React.useRef<ResizeObserver | null>(null);
  const scrollRafRef = React.useRef(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [virtualLayoutRevision, bumpVirtualLayoutRevision] = React.useReducer((v: number) => v + 1, 0);

  const registerRowElement = React.useCallback((rowId: string, element: HTMLDivElement | null) => {
    const elements = rowElementsRef.current;
    const observer = rowResizeObserverRef.current;
    const previous = elements.get(rowId);

    if (previous === element) {
      return;
    }

    if (previous && observer) {
      observer.unobserve(previous);
    }

    if (!element) {
      elements.delete(rowId);
      return;
    }

    elements.set(rowId, element);
    const nextHeight = Math.ceil(element.getBoundingClientRect().height);
    if (nextHeight > 0 && rowHeightsRef.current.get(rowId) !== nextHeight) {
      rowHeightsRef.current.set(rowId, nextHeight);
      bumpVirtualLayoutRevision();
    }
    observer?.observe(element);
  }, []);

  // ResizeObserver for row height tracking
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      let changed = false;
      entries.forEach((entry) => {
        const target = entry.target as HTMLDivElement;
        const rowId = target.dataset.rowId;
        if (!rowId) {
          return;
        }
        const nextHeight = Math.ceil(entry.contentRect.height);
        if (nextHeight > 0 && rowHeightsRef.current.get(rowId) !== nextHeight) {
          rowHeightsRef.current.set(rowId, nextHeight);
          changed = true;
        }
      });
      if (changed) {
        bumpVirtualLayoutRevision();
      }
    });

    rowResizeObserverRef.current = observer;
    rowElementsRef.current.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      rowResizeObserverRef.current = null;
    };
  }, []);

  // Viewport height tracking
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const updateHeight = () => {
      setViewportHeight(viewport.clientHeight);
    };

    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [rows.length]);

  // Clean up stale row heights when rows change
  React.useEffect(() => {
    const activeRowIds = new Set(rows.map((row) => row.id));
    let changed = false;

    rowHeightsRef.current.forEach((_height, rowId) => {
      if (activeRowIds.has(rowId)) {
        return;
      }
      rowHeightsRef.current.delete(rowId);
      const element = rowElementsRef.current.get(rowId);
      if (element && rowResizeObserverRef.current) {
        rowResizeObserverRef.current.unobserve(element);
      }
      rowElementsRef.current.delete(rowId);
      changed = true;
    });

    if (changed) {
      bumpVirtualLayoutRevision();
    }
  }, [rows]);

  // Reset scroll when subtitle file changes
  React.useEffect(() => {
    setScrollTop(0);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ left: 0, top: 0 });
    }
  }, [resetKey]);

  // Cleanup RAF on unmount
  React.useEffect(() => () => {
    cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // RAF-throttled scroll handler — only updates state once per animation frame
  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(top);
    });
  }, []);

  // Virtual rows computation — single-pass, no redundant slices/reduces
  const virtualRows = React.useMemo(() => {
    // Explicitly depend on row measurement revisions so virtualization recomputes after height changes.
    void virtualLayoutRevision;
    if (rows.length === 0) {
      return {
        bottomSpacerHeight: 0,
        topSpacerHeight: 0,
        visibleRows: [] as SubtitleTranslationRow[],
      };
    }

    const vHeight = Math.max(
      viewportHeight - SUBTITLE_TABLE_HEADER_HEIGHT,
      SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT * 4,
    );
    const adjustedScrollTop = Math.max(0, scrollTop - SUBTITLE_TABLE_HEADER_HEIGHT);
    const startBoundary = Math.max(0, adjustedScrollTop - SUBTITLE_TABLE_OVERSCAN_PX);
    const endBoundary = adjustedScrollTop + vHeight + SUBTITLE_TABLE_OVERSCAN_PX;

    let cursor = 0;
    let startIndex = 0;
    let endIndex = rows.length - 1;
    let startFound = false;
    let topSpacerHeight = 0;
    let visibleEndOffset = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const rowHeight = rowHeightsRef.current.get(rows[index].id) ?? SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT;

      if (!startFound && cursor + rowHeight >= startBoundary) {
        startIndex = index;
        topSpacerHeight = cursor;
        startFound = true;
      }

      cursor += rowHeight;

      if (cursor - rowHeight <= endBoundary) {
        endIndex = index;
        visibleEndOffset = cursor;
      }
    }

    const totalHeight = cursor;

    return {
      bottomSpacerHeight: Math.max(0, totalHeight - visibleEndOffset),
      topSpacerHeight,
      visibleRows: rows.slice(startIndex, endIndex + 1),
    };
  }, [rows, scrollTop, viewportHeight, virtualLayoutRevision]);

  return (
    <SubtitleTable>
      <div
        ref={viewportRef}
        className="table-scroll"
        onScroll={handleScroll}
      >
        <div className="table-head">
          <div className="cell head-cell">时间戳</div>
          <div className="cell head-cell">原文</div>
          <div className="cell head-cell">译文</div>
          <div className="cell head-cell">操作</div>
        </div>
        {virtualRows.topSpacerHeight > 0 ? (
          <div className="virtual-spacer" style={{ height: `${virtualRows.topSpacerHeight}px` }} />
        ) : null}
        {virtualRows.visibleRows.map((row) => (
          <SubtitleTableRow
            key={row.id}
            isActive={activeRowId === row.id}
            isEditing={editingRowId === row.id}
            isRunnerActive={isRunnerActive}
            onToggleEditingRow={onToggleEditingRow}
            onTranslationChange={onTranslationChange}
            onTranslateSingle={onTranslateSingle}
            registerRowElement={registerRowElement}
            row={row}
          />
        ))}
        {virtualRows.bottomSpacerHeight > 0 ? (
          <div className="virtual-spacer" style={{ height: `${virtualRows.bottomSpacerHeight}px` }} />
        ) : null}
      </div>
    </SubtitleTable>
  );
});

/* ---------- Helper functions ---------- */

function normalizeModelOptions(models: string[]) {
  return models.map((modelId) => ({
    label: modelId,
    value: modelId,
  }));
}

function getLibrarySaveTarget(payload: {
  draft: SubtitleTranslationDraft;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
}) {
  const { draft, rootNodeId, selectedTreeNode } = payload;
  if (selectedTreeNode?.type === 'dir') {
    return {
      label: `当前选中目录：${selectedTreeNode.name}`,
      parentId: selectedTreeNode.id,
    };
  }
  if (selectedTreeNode?.type === 'file') {
    return {
      label: `当前选中文件所在目录：${selectedTreeNode.parentId}`,
      parentId: selectedTreeNode.parentId,
    };
  }
  if (draft.sourceNode?.parentId && draft.sourceNode.parentId > 0) {
    return {
      label: `源字幕所在目录：${draft.sourceNode.parentId}`,
      parentId: draft.sourceNode.parentId,
    };
  }
  if (rootNodeId && rootNodeId > 0) {
    return {
      label: '/',
      parentId: rootNodeId,
    };
  }
  return null;
}

/* ---------- ToolWorkspace ---------- */

type MediaProcessingToolProps = {
  activeMode: ToolWorkspaceMediaMode;
  hlsRequest: ToolWorkspaceMediaHlsRequest | null;
  libraryId: number;
  onModeChange: (mode: ToolWorkspaceMediaMode) => void;
  resources: EmbeddedBrowserCapturedResource[];
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
};

type HlsTaskStatus = {
  completedFragments: number;
  error?: string;
  lastOutputPath?: string;
  logs: string[];
  mode?: 'direct-manifest' | 'local-plan';
  requestId?: string;
  stage?: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error';
  state: 'idle' | 'running' | 'success' | 'error';
  totalFragments: number;
};

type MediaSaveTargetType = 'local' | 'internal';
type HlsVariantOption = {
  label: string;
  value: string;
};

function normalizeMediaTranscodeFormat(input: string) {
  const normalized = String(input || '').trim().replace(/^\.+/, '').toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function deriveHlsOutputFileName(url: string) {
  try {
    const fileName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '')
      .replace(/\.(m3u8|m3u)$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim();
    if (fileName) {
      return `${fileName}.mp4`;
    }
  } catch {
    // Fall through to a stable fallback.
  }
  return 'hls-media.mp4';
}

function formatHlsVariantLabel(variant: {
  bandwidth?: number;
  codecs?: string;
  resolution?: string;
  url: string;
}, index: number) {
  const parts: string[] = [];
  if (variant.resolution) {
    parts.push(variant.resolution);
  }
  if (variant.bandwidth && Number.isFinite(variant.bandwidth)) {
    const mbps = variant.bandwidth / 1000 / 1000;
    parts.push(`${mbps >= 1 ? mbps.toFixed(1) : (variant.bandwidth / 1000).toFixed(0)} ${mbps >= 1 ? 'Mbps' : 'Kbps'}`);
  }
  if (variant.codecs) {
    parts.push(variant.codecs);
  }
  const title = parts.length ? parts.join(' · ') : `变体 ${index + 1}`;
  return `${title} · ${deriveHlsOutputFileName(variant.url)}`;
}

const MediaProcessingTool: React.FC<MediaProcessingToolProps> = ({
  activeMode,
  hlsRequest,
  libraryId,
  onModeChange,
  onRefreshDirectory,
  resources,
}) => {
  const [merging, setMerging] = React.useState(false);
  const [transcoding, setTranscoding] = React.useState(false);
  const [savingHls, setSavingHls] = React.useState(false);
  const [hlsManualKeyDraft, setHlsManualKeyDraft] = React.useState('');
  const [selectedHlsVariantUrl, setSelectedHlsVariantUrl] = React.useState('');
  const [hlsTaskStatus, setHlsTaskStatus] = React.useState<HlsTaskStatus>({
    completedFragments: 0,
    logs: [],
    state: 'idle',
    totalFragments: 0,
  });
  const activeHlsTaskRequestIdRef = React.useRef('');
  const activeHlsTaskManifestUrlRef = React.useRef('');
  const [transcodeFormatDraft, setTranscodeFormatDraft] = React.useState('m4a');
  const [saveTargetType, setSaveTargetType] = React.useState<MediaSaveTargetType>('local');
  const [localOutputDirectory, setLocalOutputDirectory] = React.useState('');
  const [defaultLocalOutputDirectory, setDefaultLocalOutputDirectory] = React.useState('');
  const [internalDirectory, setInternalDirectory] = React.useState<LibraryNodePickerSelection | null>(null);
  const [internalPickerVisible, setInternalPickerVisible] = React.useState(false);
  const [internalPathRequired, setInternalPathRequired] = React.useState(false);

  const mergePair = React.useMemo(() => (
    createManualMergePair(resources) || findMergeableResourcePair(resources)
  ), [resources]);

  const isLocalSaveTarget = saveTargetType === 'local';
  const internalTargetMissing = saveTargetType === 'internal' && !internalDirectory;
  const localOutputPathHint = localOutputDirectory || defaultLocalOutputDirectory || '默认下载目录';
  const normalizedHlsManualKey = React.useMemo(() => (
    normalizeHlsKeyCandidateValue(hlsManualKeyDraft) || ''
  ), [hlsManualKeyDraft]);
  const hlsManualKeyInputMode = React.useMemo(() => {
    const normalizedDraft = String(hlsManualKeyDraft || '').trim();
    if (!normalizedDraft) {
      return '';
    }
    return /^(?:0x)?[0-9a-f]{32}$/i.test(normalizedDraft) ? 'hex' : 'base64';
  }, [hlsManualKeyDraft]);
  const hlsManualKeyInvalid = Boolean(String(hlsManualKeyDraft || '').trim()) && !normalizedHlsManualKey;
  const hlsAes128KeyCount = React.useMemo(() => (
    hlsRequest?.plan.keys.filter((key) => String(key.method || '').toUpperCase() === 'AES-128').length || 0
  ), [hlsRequest]);
  const hlsNonAesKeyCount = React.useMemo(() => (
    hlsRequest?.plan.keys.filter((key) => String(key.method || '').toUpperCase() !== 'AES-128').length || 0
  ), [hlsRequest]);
  const hlsVariantOptions = React.useMemo<HlsVariantOption[]>(() => {
    if (!hlsRequest?.plan.variants.length) {
      return [];
    }
    return hlsRequest.plan.variants.map((variant, index) => ({
      label: formatHlsVariantLabel(variant, index),
      value: variant.url,
    }));
  }, [hlsRequest]);
  const hlsSelectedVariantLabel = React.useMemo(() => {
    if (!selectedHlsVariantUrl) {
      return '';
    }
    return hlsVariantOptions.find((option) => option.value === selectedHlsVariantUrl)?.label || '';
  }, [hlsVariantOptions, selectedHlsVariantUrl]);
  const hlsCanSelectVariant = Boolean(
    hlsRequest?.plan.isMaster
    && /^https?:\/\//i.test(hlsRequest?.plan.manifestUrl || '')
    && hlsVariantOptions.length > 0,
  );

  React.useEffect(() => {
    let cancelled = false;
    void getDesktopDefaultDownloadDirectory()
      .then((directoryPath) => {
        if (!cancelled && directoryPath) {
          setDefaultLocalOutputDirectory(directoryPath);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    setInternalDirectory(null);
    setInternalPickerVisible(false);
    setInternalPathRequired(false);
  }, [libraryId]);

  React.useEffect(() => {
    if (saveTargetType !== 'internal' || internalDirectory) {
      setInternalPathRequired(false);
    }
  }, [internalDirectory, saveTargetType]);

  React.useEffect(() => {
    setHlsManualKeyDraft('');
    setSelectedHlsVariantUrl('');
    activeHlsTaskRequestIdRef.current = '';
    activeHlsTaskManifestUrlRef.current = '';
    setHlsTaskStatus({
      completedFragments: 0,
      logs: [],
      state: 'idle',
      totalFragments: hlsRequest?.plan.fragmentCount || 0,
    });
  }, [hlsRequest?.id, hlsRequest?.plan.fragmentCount]);

  React.useEffect(() => {
    const unsubscribe = subscribeEmbeddedBrowserHlsTask((payload) => {
      if (!hlsRequest || payload.tabId !== hlsRequest.resource.tabId) {
        return;
      }
      if (payload.requestId && activeHlsTaskRequestIdRef.current && payload.requestId !== activeHlsTaskRequestIdRef.current) {
        return;
      }
      if (payload.manifestUrl !== (activeHlsTaskManifestUrlRef.current || hlsRequest.plan.manifestUrl)) {
        return;
      }
      setHlsTaskStatus((previous) => {
        const nextLog = payload.message
          ? [...previous.logs, payload.message].slice(-12)
          : previous.logs;
        return {
          completedFragments: payload.completedFragments ?? previous.completedFragments,
          error: payload.error,
          lastOutputPath: payload.outputPath || previous.lastOutputPath,
          logs: nextLog,
          mode: payload.mode,
          requestId: payload.requestId || previous.requestId,
          stage: payload.stage,
          state: payload.status === 'running'
            ? 'running'
            : payload.status === 'success'
              ? 'success'
              : 'error',
          totalFragments: payload.totalFragments ?? previous.totalFragments,
        };
      });
    });
    return unsubscribe;
  }, [hlsRequest]);

  const persistMediaOutputBySaveTarget = React.useCallback(async (
    outputPath: string,
    actionName: '合并' | '转格式' | 'HLS 下载',
  ) => {
    if (saveTargetType === 'local') {
      Toast.success(`已完成${actionName}，文件已保存到本地：${localOutputPathHint}`);
      return;
    }
    if (!internalDirectory) {
      throw new Error('请选择内部保存目录');
    }
    try {
      await uploadLocalPathAndCreateNode(outputPath, internalDirectory.node.id, libraryId, {
        conflictPolicy: 'auto_rename',
      });
      try {
        await onRefreshDirectory?.(internalDirectory.node.id);
      } catch (error: any) {
        Toast.warning(error?.message || '目录刷新失败，请稍后手动刷新目录树');
      }
      Toast.success(`已完成${actionName}，并保存到内部目录：${internalDirectory.pathLabel}`);
    } catch (error: any) {
      Toast.error(
        error?.message
          ? `已完成${actionName}，但上传到库内失败：${error.message}`
          : `已完成${actionName}，但上传到库内失败`,
      );
    }
  }, [internalDirectory, libraryId, localOutputPathHint, onRefreshDirectory, saveTargetType]);

  const handlePickLocalOutputDirectory = React.useCallback(async () => {
    try {
      const result = await pickDownloadDirectoryFromDesktop();
      if (result.canceled || !result.directoryPath) {
        return;
      }
      setLocalOutputDirectory(result.directoryPath);
      Toast.success('已选择本地保存目录');
    } catch (error: any) {
      Toast.error(error?.message || '选择本地目录失败');
    }
  }, []);

  const handleMerge = React.useCallback(async () => {
    if (!mergePair) {
      Toast.warning('需要一条视频和一条音频，或可识别的 MSE 音视频流');
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('内部保存路径必须选择');
      return;
    }
    setMerging(true);
    try {
      const result = await mergeCapturedResources(mergePair, {
        outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
          ? localOutputDirectory
          : undefined,
        suppressSuccessToast: true,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('合并已完成，但未返回输出路径');
      }
      await persistMediaOutputBySaveTarget(result.outputPath, '合并');
    } catch (error: any) {
      Toast.error(error?.message || '合并失败');
    } finally {
      setMerging(false);
    }
  }, [internalDirectory, localOutputDirectory, mergePair, persistMediaOutputBySaveTarget, saveTargetType]);

  const handleTranscode = React.useCallback(async () => {
    if (resources.length === 0) {
      Toast.warning('先从资源面板送入要处理的媒体');
      return;
    }
    if (resources.length > 1) {
      Toast.warning('转格式先支持单个媒体资源；多条资源请先只勾选一条');
      return;
    }
    const [resource] = resources;
    if (!resource) {
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('内部保存路径必须选择');
      return;
    }
    const outputFormat = normalizeMediaTranscodeFormat(transcodeFormatDraft);
    if (!outputFormat) {
      Toast.warning('请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4');
      return;
    }
    setTranscoding(true);
    try {
      const result = await transcodeCapturedResource(resource, outputFormat, {
        outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
          ? localOutputDirectory
          : undefined,
        suppressSuccessToast: true,
        useSystemSaveDialog: false,
      });
      if (result?.cancelled) {
        return;
      }
      if (!result?.outputPath) {
        throw new Error('转格式已完成，但未返回输出路径');
      }
      await persistMediaOutputBySaveTarget(result.outputPath, '转格式');
    } catch (error: any) {
      Toast.error(error?.message || '转格式失败');
    } finally {
      setTranscoding(false);
    }
  }, [
    internalDirectory,
    localOutputDirectory,
    persistMediaOutputBySaveTarget,
    resources,
    saveTargetType,
    transcodeFormatDraft,
  ]);

  const handleSaveHls = React.useCallback(async () => {
    if (!hlsRequest) {
      Toast.warning('先从资源面板解析 HLS，再送到工具页');
      return;
    }
    if (hlsManualKeyInvalid) {
      Toast.warning('自定义 key 需要是 16 字节 AES-128，支持 hex 或 base64');
      return;
    }
    if (saveTargetType === 'internal' && !internalDirectory) {
      setInternalPathRequired(true);
      Toast.warning('内部保存路径必须选择');
      return;
    }
    if (hlsRequest.plan.isMaster && normalizedHlsManualKey) {
      Toast.warning('当前 master playlist 的手动 key 仍需先收敛到具体媒体 playlist，先不要直接走本地主链');
      return;
    }
    setSavingHls(true);
    try {
      const requestId = `hls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const effectiveManifestUrl = selectedHlsVariantUrl || hlsRequest.plan.manifestUrl;
      activeHlsTaskRequestIdRef.current = requestId;
      activeHlsTaskManifestUrlRef.current = effectiveManifestUrl;
      setHlsTaskStatus({
        completedFragments: 0,
        logs: [
          '已创建 HLS 处理任务',
          selectedHlsVariantUrl ? `已选择变体：${hlsSelectedVariantLabel || selectedHlsVariantUrl}` : '当前使用自动变体策略',
        ],
        mode: /^https?:\/\//i.test(effectiveManifestUrl) && !normalizedHlsManualKey ? 'direct-manifest' : 'local-plan',
        requestId,
        stage: 'preparing',
        state: 'running',
        totalFragments: hlsRequest.plan.fragmentCount,
      });
      const shouldUseDirectManifestDownload = /^https?:\/\//i.test(effectiveManifestUrl) && !normalizedHlsManualKey;
      const result = shouldUseDirectManifestDownload
        ? await downloadEmbeddedBrowserHlsManifest(hlsRequest.resource.tabId, {
            headers: withResourceRefererHeader(hlsRequest.resource),
            manifestUrl: effectiveManifestUrl,
            outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
              ? localOutputDirectory
              : undefined,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          })
        : await downloadEmbeddedBrowserHlsPlan(hlsRequest.resource.tabId, {
            manualKeyBase64: normalizedHlsManualKey || undefined,
            outputDirectoryPath: saveTargetType === 'local' && localOutputDirectory
              ? localOutputDirectory
              : undefined,
            plan: hlsRequest.plan,
            requestId,
            suggestedFileName: deriveHlsOutputFileName(effectiveManifestUrl),
            useSystemSaveDialog: false,
          });
      if (result?.cancelled) {
        setHlsTaskStatus((previous) => ({
          ...previous,
          logs: [...previous.logs, '任务已取消'].slice(-12),
          state: 'idle',
        }));
        return;
      }
      if (!result?.outputPath) {
        throw new Error('HLS 下载已完成，但未返回输出路径');
      }
      await persistMediaOutputBySaveTarget(result.outputPath, 'HLS 下载');
    } catch (error: any) {
      setHlsTaskStatus((previous) => ({
        ...previous,
        error: error?.message || 'HLS 下载失败',
        logs: [...previous.logs, error?.message || 'HLS 下载失败'].slice(-12),
        stage: 'error',
        state: 'error',
      }));
      Toast.error(error?.message || 'HLS 下载失败');
    } finally {
      setSavingHls(false);
    }
  }, [
    hlsManualKeyInvalid,
    hlsSelectedVariantLabel,
    normalizedHlsManualKey,
    hlsRequest,
    internalDirectory,
    localOutputDirectory,
    persistMediaOutputBySaveTarget,
    saveTargetType,
    selectedHlsVariantUrl,
  ]);

  const handleTranscodeFormatChange = React.useCallback((value: string) => {
    setTranscodeFormatDraft(String(value || '').trimStart().replace(/^\.+/, '').slice(0, 12));
  }, []);

  const normalizedTranscodeFormat = React.useMemo(() => (
    normalizeMediaTranscodeFormat(transcodeFormatDraft) || ''
  ), [transcodeFormatDraft]);

  const toggleSaveTargetType = React.useCallback(() => {
    setSaveTargetType((current) => (current === 'local' ? 'internal' : 'local'));
  }, []);

  const handlePickSavePath = React.useCallback(() => {
    if (saveTargetType === 'local') {
      void handlePickLocalOutputDirectory();
      return;
    }
    setInternalPickerVisible(true);
  }, [handlePickLocalOutputDirectory, saveTargetType]);

  const savePathDisplay = saveTargetType === 'local'
    ? localOutputPathHint
    : (internalDirectory?.pathLabel || '');

  return (
    <>
      <WorkspaceHeader>
        <div className="header-copy">
          <div className="header-title">媒体处理</div>
          <div className="header-desc">
            侧边资源面板只负责发现和发起，真正的下载、合并、转格式这类重处理都收在这里。当前先接两条主线：
            直接资源处理，以及 HLS 计划处理。
          </div>
        </div>
        <div className="header-tags">
          <Tag color="blue">工作区模式</Tag>
          <Tag color="green">本地 ffmpeg</Tag>
          {activeMode === 'resources' ? (
            <Tag color="cyan">{resources.length} 条资源</Tag>
          ) : (
            <Tag color="cyan">{hlsRequest?.plan.fragmentCount || 0} 个分片</Tag>
          )}
        </div>
      </WorkspaceHeader>

      <WorkspaceBody>
        <Panel>
          <div className="panel-title">处理模式</div>
          <div className="panel-desc">
            同一个媒体处理壳里分两条路：直接资源保留现在的合并与转格式；HLS 计划承接 manifest 解析后的下载任务，
            后面 MPD 也会沿这条路继续长。
          </div>
          <ToolModeSwitch>
            <button
              type="button"
              className={`mode-btn ${activeMode === 'resources' ? 'is-active' : ''}`}
              disabled={resources.length === 0}
              onClick={() => onModeChange('resources')}
            >
              直接资源
            </button>
            <button
              type="button"
              className={`mode-btn ${activeMode === 'hls-download' ? 'is-active' : ''}`}
              disabled={!hlsRequest}
              onClick={() => onModeChange('hls-download')}
            >
              HLS 计划
            </button>
          </ToolModeSwitch>
        </Panel>

        <Panel>
          <div className="panel-title">保存目标</div>
          <div className="panel-desc">
            先切换保存目标：本地或内部。保存位置点击路径即可更改；内部保存未选目录时会提示“必须选择”，
            输出会自动上传到所选内部目录。
          </div>
          <MediaActionComposer>
            <div className="save-lane">
              <div className="action-cluster save-target-cluster">
                <span className="cluster-label">保存目标</span>
                <button
                  type="button"
                  className={`save-target-mode-btn ${isLocalSaveTarget ? 'local' : 'internal'}`}
                  onClick={toggleSaveTargetType}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      toggleSaveTargetType();
                    }
                  }}
                  aria-label="切换保存目标"
                  title="切换保存目标"
                >
                  <span className="save-target-mode-label">
                    <span className="save-target-mode-icon" aria-hidden>
                      <IconDownload className={`mode-icon ${isLocalSaveTarget ? 'active' : ''}`} />
                      <IconFolder className={`mode-icon ${isLocalSaveTarget ? '' : 'active'}`} />
                    </span>
                    {isLocalSaveTarget ? '保存到本地' : '保存到内部'}
                  </span>
                  <span className="save-target-mode-switch">⇄</span>
                </button>
                <div className="save-path-line">
                  <button
                    type="button"
                    className={`save-path-trigger ${saveTargetType === 'internal' && !internalDirectory ? 'is-empty' : ''} ${internalPathRequired && internalTargetMissing ? 'is-error' : ''}`}
                    onClick={handlePickSavePath}
                    title={savePathDisplay || '点击选择内部保存路径'}
                  >
                    <span className="save-path-value">{savePathDisplay || '\u00A0'}</span>
                  </button>
                  {internalPathRequired && internalTargetMissing ? (
                    <span className="save-path-required">必须选择</span>
                  ) : null}
                </div>
              </div>
            </div>
          </MediaActionComposer>
        </Panel>

        {activeMode === 'resources' ? (
          <>
        <Panel>
          <div className="panel-title">处理动作</div>
          <div className="panel-desc">
            这里先承接已经抓到的单个或成对媒体资源。类型输入仅支持 1-12 位字母或数字
            （例如 mp3、m4a、mp4）；ffmpeg 不支持时会直接报错。
          </div>
          <MediaActionComposer>
            <div className="operations-lane">
              <div className="action-cluster merge-cluster">
                <Button loading={merging} disabled={!mergePair} type="primary" onClick={() => void handleMerge()}>
                  合并&保存
                </Button>
                <span className={`merge-status ${mergePair ? 'ok' : ''}`}>
                  {mergePair ? '已识别可合并音视频' : '未识别到可合并组合'}
                </span>
              </div>
              <div className="action-cluster transcode-cluster">
                <span className="cluster-label">转格式</span>
                <div className="transcode-controls">
                  <div className="transcode-type-block">
                    <span className="transcode-format-label">类型</span>
                    <Input
                      className="transcode-format-input"
                      value={transcodeFormatDraft}
                      placeholder="mp3 / m4a / mp4"
                      onChange={handleTranscodeFormatChange}
                    />
                  </div>
                  <div className="transcode-presets">
                    {['m4a', 'mp3', 'mp4'].map((format) => (
                      <button
                        key={format}
                        type="button"
                        className={`transcode-pill ${normalizedTranscodeFormat === format ? 'active' : ''}`}
                        disabled={transcoding}
                        onClick={() => setTranscodeFormatDraft(format)}
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>
                <Button loading={transcoding} disabled={resources.length === 0} onClick={() => void handleTranscode()}>
                  转换&保存
                </Button>
              </div>
            </div>
          </MediaActionComposer>
        </Panel>

        <Panel>
          <div className="panel-title">已送入资源</div>
          <div className="panel-desc">
            这里不重新筛选、不改后缀、不替换资源，只展示从抓包面板送来的原始条目。
          </div>
          {resources.length === 0 ? (
            <Empty
              title="还没有媒体资源"
              description="回到浏览器资源面板，勾选资源后点击“处理已选”。"
            />
          ) : (
            <MediaResourceList>
              {resources.map((resource) => (
                <div className="media-row" key={resource.id}>
                  <div className="media-title" title={resource.url}>{formatResourceTitle(resource)}</div>
                  <div className="media-meta">{resource.streamType || resource.kind}</div>
                  <div className="media-meta">{resource.contentLength ? formatBytes(resource.contentLength) : '未知大小'}</div>
                  <div className="media-meta">{resource.source}{resource.ext ? ` · .${resource.ext}` : ''}</div>
                </div>
              ))}
            </MediaResourceList>
          )}
        </Panel>
          </>
        ) : (
          <>
            <Panel>
              <div className="panel-title">HLS 计划摘要</div>
              <div className="panel-desc">
                这里显示从资源面板解析后送来的 HLS 下载计划。网络 manifest 继续走 ffmpeg 主链；
                blob 或页内内存 manifest 现在会走本地 downloader + 本地 playlist + ffmpeg。
              </div>
              {hlsRequest ? (
                <>
                  <ActionRow>
                    <Tag color="light-blue">{hlsRequest.plan.isMaster ? 'Master playlist' : 'Media playlist'}</Tag>
                    <Tag color={hlsRequest.plan.isLive ? 'orange' : 'green'}>{hlsRequest.plan.isLive ? '直播' : '点播'}</Tag>
                    <Tag color="cyan">{hlsRequest.plan.fragmentCount} 个分片</Tag>
                    <Tag color="grey">keys {hlsRequest.plan.keys.length}</Tag>
                    <Tag color="grey">maps {hlsRequest.plan.maps.length}</Tag>
                    <Tag color="grey">parts {hlsRequest.plan.partCount}</Tag>
                    <Tag color="grey">建议线程 {hlsRequest.plan.suggestedThreadCount}</Tag>
                  </ActionRow>
                  <ActionRow>
                    <Tag color="white">来源：{formatResourceTitle(hlsRequest.resource)}</Tag>
                    <Tag color="white">{Math.round(hlsRequest.plan.durationSeconds)}s</Tag>
                  </ActionRow>
                  <ActionRow>
                    <Tag color={hlsAes128KeyCount > 0 ? 'orange' : 'green'}>
                      {hlsAes128KeyCount > 0 ? `AES-128 key ${hlsAes128KeyCount}` : '无 AES-128 key'}
                    </Tag>
                    <Tag color={hlsRequest.plan.maps.length > 0 ? 'blue' : 'grey'}>
                      {hlsRequest.plan.maps.length > 0 ? '含 init segment / map' : '无 map'}
                    </Tag>
                    {hlsNonAesKeyCount > 0 ? (
                      <Tag color="red">存在 {hlsNonAesKeyCount} 个非 AES-128 key，当前主链未完整覆盖</Tag>
                    ) : null}
                  </ActionRow>
                  {hlsCanSelectVariant ? (
                    <>
                      <div className="panel-desc" style={{ marginBottom: 10 }}>
                        这是一个网络 master playlist。默认保持“自动”让 ffmpeg 自己选；如果你想明确锁到某个清晰度，可以在这里指定变体。
                      </div>
                      <ActionRow>
                        <Select
                          value={selectedHlsVariantUrl || undefined}
                          placeholder="自动（沿用原始 manifest）"
                          onChange={(value) => setSelectedHlsVariantUrl(String(value || ''))}
                          style={{ minWidth: 320 }}
                        >
                          <Select.Option value="">自动（沿用原始 manifest）</Select.Option>
                          {hlsVariantOptions.map((option) => (
                            <Select.Option key={option.value} value={option.value}>
                              {option.label}
                            </Select.Option>
                          ))}
                        </Select>
                        {selectedHlsVariantUrl ? (
                          <Tag color="blue">已锁定变体</Tag>
                        ) : (
                          <Tag color="grey">自动选清晰度</Tag>
                        )}
                      </ActionRow>
                    </>
                  ) : null}
                  <div className="panel-desc" style={{ marginBottom: 10 }}>
                    如果站点的 AES-128 key 没被自动识别，可以在这里手动粘贴 16 字节 key。
                    支持 32 位 hex，或 16 字节 base64。填写后会自动切到本地 downloader 主链。
                    目前 master playlist 还不支持直接带手动 key 落本地主链，需要先收敛到具体媒体 playlist。
                  </div>
                  <ActionRow>
                    <Input
                      value={hlsManualKeyDraft}
                      placeholder="可选：输入 16 字节 AES-128 key（hex / base64）"
                      onChange={(value) => setHlsManualKeyDraft(value)}
                    />
                    {hlsManualKeyDraft ? (
                      <Button onClick={() => setHlsManualKeyDraft('')}>
                        清空 key
                      </Button>
                    ) : null}
                    {normalizedHlsManualKey ? (
                      <Tag color="green">已识别自定义 key（{hlsManualKeyInputMode || 'base64'}）</Tag>
                    ) : hlsManualKeyInvalid ? (
                      <Tag color="red">key 格式无效</Tag>
                    ) : null}
                  </ActionRow>
                  <ActionRow>
                    <Button loading={savingHls} type="primary" onClick={() => void handleSaveHls()}>
                      下载&保存
                    </Button>
                    <Button disabled={savingHls} onClick={() => void handleSaveHls()}>
                      重新执行
                    </Button>
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(JSON.stringify(hlsRequest.plan, null, 2)).then(() => {
                          Toast.success('HLS 计划 JSON 已复制');
                        });
                      }}
                    >
                      复制计划
                    </Button>
                    <Tag color={!/^https?:\/\//i.test(hlsRequest.plan.manifestUrl) || normalizedHlsManualKey ? 'orange' : 'green'}>
                      {!/^https?:\/\//i.test(selectedHlsVariantUrl || hlsRequest.plan.manifestUrl) || normalizedHlsManualKey ? '本地 downloader 主链' : '网络 manifest 主链'}
                    </Tag>
                    {selectedHlsVariantUrl ? (
                      <Tag color="white">
                        <span title={hlsSelectedVariantLabel || selectedHlsVariantUrl}>
                          变体：{hlsSelectedVariantLabel || selectedHlsVariantUrl}
                        </span>
                      </Tag>
                    ) : null}
                  </ActionRow>
                  <ActionRow>
                    <Tag color={hlsTaskStatus.state === 'success' ? 'green' : hlsTaskStatus.state === 'error' ? 'red' : hlsTaskStatus.state === 'running' ? 'blue' : 'grey'}>
                      {hlsTaskStatus.state === 'success'
                        ? '执行成功'
                        : hlsTaskStatus.state === 'error'
                          ? '执行失败'
                          : hlsTaskStatus.state === 'running'
                            ? '执行中'
                            : '尚未执行'}
                    </Tag>
                    {hlsTaskStatus.stage ? (
                      <Tag color="white">阶段：{hlsTaskStatus.stage}</Tag>
                    ) : null}
                    {hlsTaskStatus.totalFragments > 0 ? (
                      <Tag color="white">
                        分片：{Math.min(hlsTaskStatus.completedFragments, hlsTaskStatus.totalFragments)} / {hlsTaskStatus.totalFragments}
                      </Tag>
                    ) : null}
                  </ActionRow>
                  <MediaResourceList>
                    {(hlsTaskStatus.logs.length ? hlsTaskStatus.logs : ['等待执行 HLS 任务']).map((line, index) => (
                      <div className="media-row" key={`${index}-${line}`}>
                        <div className="media-title" title={line}>{line}</div>
                        <div className="media-meta">{hlsTaskStatus.mode === 'local-plan' ? 'local' : hlsTaskStatus.mode === 'direct-manifest' ? 'ffmpeg' : 'idle'}</div>
                        <div className="media-meta">{hlsTaskStatus.stage || '-'}</div>
                        <div className="media-meta">{index === hlsTaskStatus.logs.length - 1 ? 'latest' : ''}</div>
                      </div>
                    ))}
                  </MediaResourceList>
                  {hlsTaskStatus.error ? (
                    <div className="panel-desc" style={{ color: 'var(--semi-color-danger)' }}>
                      最近错误：{hlsTaskStatus.error}
                    </div>
                  ) : null}
                  {hlsTaskStatus.lastOutputPath ? (
                    <div className="panel-desc">
                      最近产物：{hlsTaskStatus.lastOutputPath}
                    </div>
                  ) : null}
                </>
              ) : (
                <Empty
                  title="还没有 HLS 计划"
                  description="先回到资源面板解析 HLS，然后点击“送到工具页”。"
                />
              )}
            </Panel>
          </>
        )}
      </WorkspaceBody>

      <LibraryNodePickerModal
        visible={internalPickerVisible}
        libraryId={libraryId}
        displayMode="folders"
        title="选择保存位置"
        confirmText="选择此位置"
        onCancel={() => setInternalPickerVisible(false)}
        onConfirm={(selection) => {
          setInternalDirectory(selection);
          setInternalPathRequired(false);
          setInternalPickerVisible(false);
        }}
      />
    </>
  );
};

type ToolWorkspaceProps = {
  libraryId: number;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
  mediaProcessingRequest?: ToolWorkspaceMediaRequest | null;
  onRefreshDirectory?: (directoryId: number) => Promise<void> | void;
};

const ToolWorkspace: React.FC<ToolWorkspaceProps> = ({
  libraryId,
  mediaProcessingRequest = null,
  onRefreshDirectory,
  rootNodeId,
  selectedTreeNode,
}) => {
  const [workspaceState, setWorkspaceState] = React.useState<ToolWorkspaceState>(() => (
    loadToolWorkspaceState(libraryId)
  ));
  const [mediaProcessingResources, setMediaProcessingResources] = React.useState<EmbeddedBrowserCapturedResource[]>([]);
  const [mediaProcessingHlsRequest, setMediaProcessingHlsRequest] = React.useState<ToolWorkspaceMediaHlsRequest | null>(null);
  const [mediaProcessingMode, setMediaProcessingMode] = React.useState<ToolWorkspaceMediaMode>('resources');
  const [config, setConfig] = React.useState<SubtitleTranslationConfig>(() => loadSubtitleTranslationPreferences());
  const [availableModels, setAvailableModels] = React.useState<string[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [savingLocal, setSavingLocal] = React.useState(false);
  const [savingLibrary, setSavingLibrary] = React.useState(false);
  const [runnerSnapshot, setRunnerSnapshot] = React.useState<RunnerSnapshot>(() => subtitleTranslationRunner.getSnapshot());
  const [activeRowId, setActiveRowId] = React.useState<string | null>(null);
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null);
  const [subtitleListScrollRequestId, requestSubtitleListScroll] = React.useReducer((value: number) => value + 1, 0);
  const [subtitleDatasetVersion, bumpSubtitleDatasetVersion] = React.useReducer((value: number) => value + 1, 0);
  const initializedLibraryIdRef = React.useRef(libraryId);
  const subtitleListPanelRef = React.useRef<HTMLElement | null>(null);
  const pendingSubtitleListScrollRef = React.useRef(false);

  const draft = workspaceState.subtitleTranslationDraft;
  const activeToolId = workspaceState.activeToolId;
  const deferredRows = React.useDeferredValue(draft.rows);
  const librarySaveTarget = React.useMemo(() => getLibrarySaveTarget({
    draft,
    rootNodeId,
    selectedTreeNode,
  }), [draft, rootNodeId, selectedTreeNode]);
  const loadedSubtitleIdentity = React.useMemo(() => (
    `${libraryId}:${draft.sourceType || 'unknown'}:${draft.fileName || 'empty'}:${subtitleDatasetVersion}`
  ), [draft.fileName, draft.sourceType, libraryId, subtitleDatasetVersion]);

  React.useEffect(() => {
    if (initializedLibraryIdRef.current === libraryId) {
      return;
    }
    initializedLibraryIdRef.current = libraryId;
    subtitleTranslationRunner.stop();
    setActiveRowId(null);
    setEditingRowId(null);
    bumpSubtitleDatasetVersion();
    setWorkspaceState(loadToolWorkspaceState(libraryId));
  }, [libraryId]);

  React.useEffect(() => {
    saveToolWorkspaceState(libraryId, workspaceState);
  }, [libraryId, workspaceState]);

  React.useEffect(() => {
    if (!mediaProcessingRequest) {
      return;
    }
    if (mediaProcessingRequest.kind === 'resources') {
      setMediaProcessingResources(mediaProcessingRequest.resources);
      setMediaProcessingMode('resources');
    } else if (mediaProcessingRequest.kind === 'hls-download') {
      setMediaProcessingHlsRequest(mediaProcessingRequest);
      setMediaProcessingMode('hls-download');
    }
    setWorkspaceState((current) => ({
      ...current,
      activeToolId: 'media-processing',
    }));
  }, [mediaProcessingRequest]);

  React.useEffect(() => {
    if (!pendingSubtitleListScrollRef.current || draft.rows.length === 0) {
      return;
    }

    pendingSubtitleListScrollRef.current = false;
    const frameId = window.requestAnimationFrame(() => {
      subtitleListPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [draft.rows.length, loadedSubtitleIdentity, subtitleListScrollRequestId]);

  const scrollToSubtitleList = React.useCallback(() => {
    pendingSubtitleListScrollRef.current = true;
    requestSubtitleListScroll();
  }, []);

  const patchDraft = React.useCallback((updater: (current: SubtitleTranslationDraft) => SubtitleTranslationDraft) => {
    setWorkspaceState((current) => ({
      ...current,
      subtitleTranslationDraft: updater(current.subtitleTranslationDraft),
    }));
  }, []);

  const replaceDraft = React.useCallback((nextDraft: SubtitleTranslationDraft) => {
    setActiveRowId(null);
    setEditingRowId(null);
    bumpSubtitleDatasetVersion();
    patchDraft(() => nextDraft);
  }, [patchDraft]);

  const openTool = React.useCallback((toolId: ToolWorkspaceToolId) => {
    setWorkspaceState((current) => ({
      ...current,
      activeToolId: toolId,
    }));
  }, []);

  const applyRunnerResults = React.useCallback(() => {
    const drained = subtitleTranslationRunner.drainResults();
    if (drained.size === 0) {
      return;
    }
    patchDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        const result = drained.get(row.id);
        if (!result) {
          return row;
        }
        return {
          ...row,
          error: result.error,
          status: result.status,
          translatedText: result.translatedText || row.translatedText,
        };
      }),
    }));
  }, [patchDraft]);

  // Subscribe to runner updates
  React.useEffect(() => {
    // Drain any results accumulated while unmounted
    applyRunnerResults();
    setRunnerSnapshot(subtitleTranslationRunner.getSnapshot());

    return subtitleTranslationRunner.subscribe(() => {
      applyRunnerResults();
      setRunnerSnapshot(subtitleTranslationRunner.getSnapshot());
    });
  }, [applyRunnerResults]);

  const isRunnerActive = runnerSnapshot.running;
  const untranslatedCount = React.useMemo(
    () => draft.rows.filter((row) => !String(row.translatedText || '').trim()).length,
    [draft.rows],
  );
  const effectiveActiveRowId = isRunnerActive ? runnerSnapshot.activeRowId : activeRowId;

  const handleStartTranslation = React.useCallback(() => {
    if (draft.rows.length === 0) {
      Toast.warning('请先导入字幕文件');
      return;
    }
    subtitleTranslationRunner.start(config, draft.rows, libraryId);
  }, [config, draft.rows, libraryId]);

  const handleMergeAdjacentDuplicates = React.useCallback(() => {
    if (!draft.fileFormat || draft.rows.length === 0) {
      Toast.warning('请先导入字幕文件');
      return;
    }
    subtitleTranslationRunner.stop();
    const merged = mergeAdjacentDuplicateRows(draft.rows, draft.fileFormat);
    if (merged.length === draft.rows.length) {
      Toast.info('没有发现可合并的相邻重复行');
      return;
    }
    const removedCount = draft.rows.length - merged.length;
    patchDraft((current) => ({
      ...current,
      rows: merged,
    }));
    Toast.success(`已合并 ${removedCount} 条重复行，剩余 ${merged.length} 条`);
  }, [draft.fileFormat, draft.rows, patchDraft]);

  const handleRefreshModels = React.useCallback(async () => {
    setLoadingModels(true);
    try {
      const modelIds = await fetchAvailableTranslationModels(config);
      setAvailableModels(modelIds);
      if (!config.model && modelIds.length > 0) {
        const nextConfig = { ...config, model: modelIds[0] };
        setConfig(nextConfig);
        saveSubtitleTranslationPreferences(nextConfig);
      }
      Toast.success(modelIds.length > 0 ? `已获取 ${modelIds.length} 个模型` : '当前未返回模型列表');
    } catch (error: any) {
      Toast.error(error?.message || '获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  }, [config]);

  const persistConfig = React.useCallback((nextConfig: SubtitleTranslationConfig) => {
    setConfig(nextConfig);
    saveSubtitleTranslationPreferences(nextConfig);
  }, []);

  const handleImportLocal = React.useCallback(async () => {
    subtitleTranslationRunner.stop();
    setImporting(true);
    try {
      const result = await pickLocalSubtitleFile();
      if (!result) {
        return;
      }
      replaceDraft({
        fileFormat: result.fileFormat,
        fileName: result.fileName,
        filePath: result.filePath,
        rows: result.rows,
        sourceNode: null,
        sourceType: 'local',
      });
      scrollToSubtitleList();
      Toast.success(`已载入 ${result.rows.length} 条字幕`);
    } catch (error: any) {
      Toast.error(error?.message || '读取本地字幕失败');
    } finally {
      setImporting(false);
    }
  }, [replaceDraft, scrollToSubtitleList]);

  const handleImportSelectedLibraryFile = React.useCallback(async () => {
    if (!selectedTreeNode || selectedTreeNode.type !== 'file') {
      Toast.warning('请先在目录树中选中一个字幕文件');
      return;
    }
    if (!isSupportedSubtitleExtension(selectedTreeNode.ext || '')) {
      Toast.warning('当前选中文件不是支持的字幕文件');
      return;
    }

    subtitleTranslationRunner.stop();
    setImporting(true);
    try {
      const result = await loadSubtitleFromLibraryNode(libraryId, selectedTreeNode);
      replaceDraft({
        fileFormat: result.fileFormat,
        fileName: result.fileName,
        filePath: '',
        rows: result.rows,
        sourceNode: selectedTreeNode,
        sourceType: 'library',
      });
      scrollToSubtitleList();
      Toast.success(`已从库内载入 ${result.rows.length} 条字幕`);
    } catch (error: any) {
      Toast.error(error?.message || '读取库内字幕失败');
    } finally {
      setImporting(false);
    }
  }, [libraryId, replaceDraft, scrollToSubtitleList, selectedTreeNode]);

  const updateRow = React.useCallback((rowId: string, updater: (row: SubtitleTranslationRow) => SubtitleTranslationRow) => {
    patchDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => (
        row.id === rowId ? updater(row) : row
      )),
    }));
  }, [patchDraft]);

  const handleStopTranslation = React.useCallback(() => {
    const snapshot = subtitleTranslationRunner.getSnapshot();
    subtitleTranslationRunner.stop();
    setActiveRowId(null);
    if (!snapshot.activeRowId) {
      return;
    }
    updateRow(snapshot.activeRowId, (row) => ({
      ...row,
      error: '',
      status: String(row.translatedText || '').trim() ? 'success' : 'idle',
    }));
  }, [updateRow]);

  const handleToggleEditingRow = React.useCallback((rowId: string) => {
    setEditingRowId((current) => (current === rowId ? null : rowId));
  }, []);

  const handleTranslationChange = React.useCallback((rowId: string, value: string) => {
    updateRow(rowId, (current) => ({
      ...current,
      error: '',
      status: String(value || '').trim() ? 'success' : 'idle',
      translatedText: value,
    }));
  }, [updateRow]);

  const handleTranslateSingle = React.useCallback(async (
    rowId: string,
    options?: { unloadModel?: boolean },
  ) => {
    const rowIndex = draft.rows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) {
      return;
    }

    setActiveRowId(rowId);
    setEditingRowId(null);
    updateRow(rowId, (row) => ({
      ...row,
      error: '',
      status: 'translating',
    }));

    try {
      const translatedText = await translateSubtitleRow(config, draft.rows, rowIndex);
      updateRow(rowId, (row) => ({
        ...row,
        error: '',
        status: 'success',
        translatedText,
      }));
      if (options?.unloadModel !== false) {
        await unloadOllamaModel(config).catch(() => undefined);
      }
    } catch (error: any) {
      updateRow(rowId, (row) => ({
        ...row,
        error: error?.message || '翻译失败',
        status: 'error',
      }));
      Toast.error(error?.message || '翻译失败');
    } finally {
      setActiveRowId((current) => (current === rowId ? null : current));
    }
  }, [config, draft.rows, updateRow]);

  // Stable wrapper that drops the async return — prevents inline closure in JSX
  const handleTranslateSingleSync = React.useCallback((rowId: string) => {
    void handleTranslateSingle(rowId);
  }, [handleTranslateSingle]);

  const handleSaveLocal = React.useCallback(async () => {
    if (!draft.fileFormat || draft.rows.length === 0) {
      Toast.warning('请先导入字幕文件');
      return;
    }
    setSavingLocal(true);
    try {
      const filePath = await saveSubtitleToLocalFile(
        buildTranslatedSubtitleFileName(draft.fileName, draft.fileFormat),
        draft.fileFormat,
        draft.rows,
      );
      if (!filePath) {
        return;
      }
      Toast.success(`已另存到本地：${filePath}`);
    } catch (error: any) {
      Toast.error(error?.message || '本地另存失败');
    } finally {
      setSavingLocal(false);
    }
  }, [draft.fileFormat, draft.fileName, draft.rows]);

  const handleSaveLibrary = React.useCallback(async () => {
    if (!draft.fileFormat || draft.rows.length === 0) {
      Toast.warning('请先导入字幕文件');
      return;
    }
    if (!librarySaveTarget) {
      Toast.warning('当前没有可用的库内保存目录');
      return;
    }

    setSavingLibrary(true);
    try {
      await saveSubtitleToLibraryNode({
        fileName: buildTranslatedSubtitleFileName(draft.fileName, draft.fileFormat),
        format: draft.fileFormat,
        libraryId,
        parentId: librarySaveTarget.parentId,
        rows: draft.rows,
      });
      Toast.success('已保存到库内文件系统');
    } catch (error: any) {
      Toast.error(error?.message || '库内另存失败');
    } finally {
      setSavingLibrary(false);
    }
  }, [draft.fileFormat, draft.fileName, draft.rows, libraryId, librarySaveTarget]);

  const renderToolCard = (toolId: ToolWorkspaceToolId, title: string) => (
    <button
      type="button"
      className={`tool-card ${activeToolId === toolId ? 'is-active' : ''}`}
      onClick={() => openTool(toolId)}
    >
      <div className="tool-card-title">{title}</div>
    </button>
  );

  return (
    <Wrapper>
      <ToolNav>
        <div className="title">工具区</div>
        {renderToolCard('subtitle-translation', 'AI 字幕翻译')}
        {renderToolCard('media-processing', '媒体处理')}
      </ToolNav>

      <WorkspaceMain>
        {activeToolId === 'media-processing' ? (
          <MediaProcessingTool
            activeMode={mediaProcessingMode}
            hlsRequest={mediaProcessingHlsRequest}
            libraryId={libraryId}
            onModeChange={setMediaProcessingMode}
            onRefreshDirectory={onRefreshDirectory}
            resources={mediaProcessingResources}
          />
        ) : (
          <>
        <WorkspaceHeader>
          <div className="header-copy">
            <div className="header-title">AI 字幕翻译</div>
            <div className="header-desc">
              读取本地或库内字幕文件，自动识别时间戳与文本，按句翻译。接口按 OpenAI-compatible `chat/completions`
              风格请求，适配你当前的 Ollama 地址 `http://localhost:11434/v1`。
            </div>
          </div>
          <div className="header-tags">
            <Tag color="blue">工作区模式</Tag>
            <Tag color="green">本地 Ollama</Tag>
            {draft.fileFormat ? <Tag color="grey">{draft.fileFormat.toUpperCase()}</Tag> : null}
            {draft.rows.length > 0 ? <Tag color="cyan">{draft.rows.length} 行</Tag> : null}
          </div>
        </WorkspaceHeader>

        <WorkspaceBody>
          <Panel>
            <div className="panel-title">模型配置</div>
            <div className="panel-desc">
              `baseUrl`、`apiKey` 和默认模型只保存在本机。你可以手动输入模型，也可以从服务端读取模型列表。
            </div>
            <ConfigGrid>
              <div className="field">
                <div className="label">Base URL</div>
                <Input
                  value={config.baseUrl}
                  onChange={(value) => persistConfig({ ...config, baseUrl: value })}
                  placeholder="http://localhost:11434/v1"
                />
              </div>
              <div className="field">
                <div className="label">API Key</div>
                <Input
                  value={config.apiKey}
                  onChange={(value) => persistConfig({ ...config, apiKey: value })}
                  placeholder="ollama"
                />
              </div>
              <div className="field">
                <div className="label">模型</div>
                <div className="models-row">
                  <Input
                    value={config.model}
                    onChange={(value) => persistConfig({ ...config, model: value })}
                    placeholder="例如 qwen3:8b"
                  />
                  <Button loading={loadingModels} onClick={() => void handleRefreshModels()}>
                    读取模型
                  </Button>
                </div>
                {availableModels.length > 0 ? (
                  <ActionRow>
                    {normalizeModelOptions(availableModels).map((item) => (
                      <Button
                        key={item.value}
                        theme={config.model === item.value ? 'solid' : 'borderless'}
                        type={config.model === item.value ? 'primary' : 'tertiary'}
                        onClick={() => persistConfig({ ...config, model: item.value })}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </ActionRow>
                ) : null}
              </div>
              <div className="field">
                <div className="label">上下文窗口</div>
                <InputNumber
                  min={0}
                  max={10}
                  step={1}
                  value={config.contextWindow}
                  onChange={(value) => persistConfig({ ...config, contextWindow: Number(value) || 0 })}
                />
              </div>
              <div className="field">
                <div className="label">翻译后释放模型</div>
                <Switch
                  checked={config.unloadModelAfterTranslate}
                  onChange={(checked) => persistConfig({ ...config, unloadModelAfterTranslate: checked })}
                />
              </div>
              <div className="field full">
                <div className="label">目标语言</div>
                <Input
                  value={config.targetLanguage}
                  onChange={(value) => persistConfig({ ...config, targetLanguage: value || '简体中文' })}
                  placeholder="简体中文"
                />
              </div>
              <div className="field full">
                <div className="label">预设提示词</div>
                <TextArea
                  autosize={{ minRows: 4, maxRows: 8 }}
                  value={config.presetPrompt}
                  onChange={(value) => persistConfig({ ...config, presetPrompt: value })}
                  placeholder="例如：人名保留英文；游戏术语按中文社区常用译法；语气尽量口语自然。"
                />
              </div>
            </ConfigGrid>
          </Panel>

          <Panel>
            <div className="panel-title">导入与导出</div>
            <div className="panel-desc">
              库内导入依赖目录树当前选中的字幕文件；库内另存为优先保存到当前选中目录，其次回退到源字幕所在目录或当前库根目录。
            </div>
            <ImportExportSection>
              <ActionRow>
                <Button icon={<IconPlus />} loading={importing} onClick={() => void handleImportLocal()}>
                  读取本地字幕
                </Button>
                <Button
                  icon={<IconDownload />}
                  loading={importing}
                  disabled={!selectedTreeNode || selectedTreeNode.type !== 'file'}
                  onClick={() => void handleImportSelectedLibraryFile()}
                >
                  读取当前选中文件
                </Button>
                {isRunnerActive ? (
                  <Button onClick={handleStopTranslation}>
                    停止翻译 ({runnerSnapshot.doneCount}/{runnerSnapshot.totalCount})
                  </Button>
                ) : (
                  <Button disabled={draft.rows.length === 0 || untranslatedCount === 0} onClick={handleStartTranslation}>
                    翻译未翻译 ({untranslatedCount})
                  </Button>
                )}
                <Button disabled={draft.rows.length === 0 || isRunnerActive} onClick={handleMergeAdjacentDuplicates}>
                  合并重复行
                </Button>
                <Button loading={savingLocal} disabled={draft.rows.length === 0} onClick={() => void handleSaveLocal()}>
                  另存到本地
                </Button>
                <Button loading={savingLibrary} disabled={draft.rows.length === 0 || !librarySaveTarget} onClick={() => void handleSaveLibrary()}>
                  另存到库内
                </Button>
              </ActionRow>
              <ActionRow>
                <Tag color="grey">
                  当前选中节点：{selectedTreeNode ? `${selectedTreeNode.name}${selectedTreeNode.ext ? `.${selectedTreeNode.ext}` : ''}` : '未选择'}
                </Tag>
                {librarySaveTarget ? (
                  <Tag color="light-blue">{librarySaveTarget.label}</Tag>
                ) : null}
                {draft.fileName ? (
                  <Tag color="cyan">当前字幕：{draft.fileName}</Tag>
                ) : null}
                {draft.rows.length > 0 ? (
                  untranslatedCount > 0 ? (
                    <Tag color="orange">还有 {untranslatedCount} 条未翻译</Tag>
                  ) : (
                    <Tag color="green">全部已翻译</Tag>
                  )
                ) : null}
              </ActionRow>
            </ImportExportSection>
          </Panel>

          <Panel ref={subtitleListPanelRef}>
            <div className="panel-title">字幕列表</div>
            <div className="panel-desc">
              左中右分别是时间戳、原文和译文。默认按单行压缩显示，点击译文即可直接编辑；单句翻译默认附带前后上下文。
            </div>
            {deferredRows.length === 0 ? (
              <Empty
                title="还没有字幕内容"
                description="先读取本地字幕，或者在目录树中选中一个库内字幕文件后导入。"
              />
            ) : (
              <VirtualSubtitleTable
                key={loadedSubtitleIdentity}
                activeRowId={effectiveActiveRowId}
                editingRowId={editingRowId}
                isRunnerActive={isRunnerActive}
                onToggleEditingRow={handleToggleEditingRow}
                onTranslationChange={handleTranslationChange}
                onTranslateSingle={handleTranslateSingleSync}
                resetKey={loadedSubtitleIdentity}
                rows={deferredRows}
              />
            )}
          </Panel>
        </WorkspaceBody>
          </>
        )}
      </WorkspaceMain>
    </Wrapper>
  );
};

export default ToolWorkspace;

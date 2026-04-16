import React from 'react';
import styled from 'styled-components';
import {
  Empty,
  Button,
  Input,
  InputNumber,
  Switch,
  Tag,
  TextArea,
  Toast,
} from '@douyinfe/semi-ui';
import { IconDownload, IconPlus } from '@douyinfe/semi-icons';

import type { SelectedTreeNode } from '@/features/file-explorer';

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
  ToolWorkspaceState,
} from './types';

const Wrapper = styled.div`
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
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
    font-size: 17px;
    font-weight: 700;
    color: var(--app-text);
  }

  .desc {
    font-size: 14px;
    line-height: 1.7;
    color: var(--app-text-muted);
  }

  .tool-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 12px;
    border-radius: 12px;
    border: 1px solid var(--semi-color-primary);
    background: var(--semi-color-primary-light-default);
  }

  .tool-card-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--semi-color-primary);
  }

  .tool-card-copy {
    font-size: 13px;
    line-height: 1.7;
    color: var(--app-text-muted);
  }

  .semi-button {
    min-height: 40px;
    font-size: 14px;
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
    font-size: 27px;
    font-weight: 700;
    color: var(--app-text);
    line-height: 1.2;
  }

  .header-desc {
    font-size: 14px;
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
  gap: 16px;
`;

const Panel = styled.section`
  border: 1px solid var(--app-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--app-bg-elevated) 92%, transparent);
  padding: 18px;

  .panel-title {
    font-size: 17px;
    font-weight: 700;
    color: var(--app-text);
    margin-bottom: 12px;
  }

  .panel-desc {
    font-size: 14px;
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
    font-size: 13px;
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
    font-size: 14px;
  }

  .semi-input-wrapper,
  .semi-input-number {
    min-height: 40px;
  }
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .semi-button {
    min-height: 40px;
    font-size: 14px;
  }

  .semi-tag {
    font-size: 13px;
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
      label: '当前库根目录',
      parentId: rootNodeId,
    };
  }
  return null;
}

/* ---------- ToolWorkspace ---------- */

type ToolWorkspaceProps = {
  libraryId: number;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
  onOpenFileWorkspace: () => void;
};

const ToolWorkspace: React.FC<ToolWorkspaceProps> = ({
  libraryId,
  onOpenFileWorkspace,
  rootNodeId,
  selectedTreeNode,
}) => {
  const [workspaceState, setWorkspaceState] = React.useState<ToolWorkspaceState>(() => (
    loadToolWorkspaceState(libraryId)
  ));
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

  return (
    <Wrapper>
      <ToolNav>
        <div className="title">工具区</div>
        <div className="desc">
          目录树继续保留在左侧，工具工作流集中在这里承接。后续可以继续扩字幕处理、批处理和转写整理能力。
        </div>
        <div className="tool-card">
          <div className="tool-card-title">AI 字幕翻译</div>
          <div className="tool-card-copy">导入本地或库内字幕，按句翻译，并将结果另存为本地文件或库内文件。</div>
        </div>
        <Button theme="borderless" onClick={onOpenFileWorkspace}>
          返回文件区
        </Button>
      </ToolNav>

      <WorkspaceMain>
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
      </WorkspaceMain>
    </Wrapper>
  );
};

export default ToolWorkspace;

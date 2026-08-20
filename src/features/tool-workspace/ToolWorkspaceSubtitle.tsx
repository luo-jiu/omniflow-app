import React from 'react';
import styled from 'styled-components';
import {
  Button,
  Empty,
  TextArea,
  Tooltip,
  Toast,
} from '@douyinfe/semi-ui';
import {
  IconAlignCenterVertical,
  IconCloudUploadStroked,
  IconDownloadStroked,
  IconFile,
  IconHelpCircleStroked,
  IconImport,
  IconRedoStroked,
  IconUpload,
} from '@douyinfe/semi-icons';

import type { SelectedTreeNode } from '@/features/file-explorer';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

import type { RunnerSnapshot } from './subtitle-translation.runner';
import { selectSingleDroppedSubtitleFile } from './subtitle-translation.service';
import SubtitleTranslationComposer from './SubtitleTranslationComposer';
import type {
  SubtitleTranslationConfig,
  SubtitleTranslationDraft,
  SubtitleTranslationRow,
} from './types';
import {
  WorkspaceHeader,
} from './styles';

const SubtitleDropSurface = styled.section`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const SubtitleDropOverlay = styled.div`
  position: absolute;
  inset: 8px;
  z-index: 12;
  border: 1px dashed var(--semi-color-primary);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-elevated) 94%, transparent);
  color: var(--app-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--semi-color-primary) 12%, transparent);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;

  .subtitle-drop-message {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--semi-color-primary);
    font-size: 12px;
    font-weight: 700;
  }

  svg {
    width: 18px;
    height: 18px;
  }
`;

const SubtitleWorkspaceBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SubtitleHeaderActions = styled.div`
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;

  .header-action-anchor {
    display: inline-flex;
  }

  .semi-button {
    width: 28px;
    min-width: 28px;
    min-height: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    color: var(--app-text-muted);
  }

  .semi-button:not(.semi-button-disabled):hover,
  .semi-button:not(.semi-button-disabled):focus-visible {
    color: var(--app-text);
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const SubtitleWorkspaceHeader = styled(WorkspaceHeader)`
  align-items: center;
  justify-content: space-between;
`;

const SubtitleListPanel = styled.section`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .subtitle-empty {
    flex: 1;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

const TitleWithHelp = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: fit-content;
`;

const HelpTrigger = styled.button`
  padding: 0;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  color: var(--app-text-muted);
  cursor: default;

  &:hover,
  &:focus-visible {
    color: var(--semi-color-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--semi-color-primary-light-active);
    outline-offset: 1px;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const HelpContent = styled.div`
  max-width: 360px;
  font-size: 11px;
  line-height: 1.6;
`;

const HELP_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--app-bg-elevated)',
  border: '1px solid var(--app-border-strong)',
  boxShadow: 'var(--app-shadow)',
  color: 'var(--app-text)',
  maxWidth: 360,
  padding: '8px 10px',
};

interface HelpTitleProps {
  className: string;
  help: React.ReactNode;
  helpLabel: string;
  title: string;
}

const HelpTitle: React.FC<HelpTitleProps> = ({ className, help, helpLabel, title }) => (
  <TitleWithHelp className={className}>
    <span>{title}</span>
    <Tooltip
      content={<HelpContent>{help}</HelpContent>}
      position="bottomLeft"
      showArrow={false}
      style={HELP_TOOLTIP_STYLE}
    >
      <HelpTrigger aria-label={helpLabel} type="button">
        <IconHelpCircleStroked />
      </HelpTrigger>
    </Tooltip>
  </TitleWithHelp>
);

const SUBTITLE_TABLE_HEADER_HEIGHT = 36;
const SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT = 46;
const SUBTITLE_TABLE_OVERSCAN_PX = SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT * 6;

function hasNativeFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types || []).includes('Files');
}

function placeCaretAtTextEnd(event: React.FocusEvent<HTMLTextAreaElement>): void {
  const textarea = event.currentTarget;
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);
}

const SubtitleTable = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .table-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    will-change: scroll-position;
    ${workspaceScrollbarStyles}
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 260px minmax(154px, 1fr) minmax(182px, 1fr) 66px;
    gap: 0;
    min-width: 714px;
  }

  .table-head {
    min-height: ${SUBTITLE_TABLE_HEADER_HEIGHT}px;
    border-bottom: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-bg) 92%, transparent);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .table-head .head-cell {
    transform: translateY(-1px);
  }

  .table-row {
    height: ${SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT}px;
    min-height: ${SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT}px;
    border-radius: 7px;
    contain: layout style;
  }

  .table-row[data-row-tone='alternate'] {
    background: var(--semi-color-fill-1);
  }

  .virtual-spacer {
    width: 100%;
    min-width: 714px;
    pointer-events: none;
  }

  .cell {
    padding: 7px 9px;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .head-cell {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .time-cell {
    display: flex;
    align-items: center;
    gap: 5px;
    justify-content: center;
    white-space: nowrap;
  }

  .time-index {
    font-size: 11px;
    line-height: 1.4;
    color: var(--app-text-muted);
    flex: none;
  }

  .time-range {
    font-size: 12px;
    line-height: 1.4;
    color: var(--app-text);
    white-space: nowrap;
  }

  .source-cell {
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .translation-cell .semi-input-textarea-wrapper {
    width: 100%;
    height: 32px;
    min-height: 32px;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .translation-cell .semi-input-textarea-wrapper:hover,
  .translation-cell .semi-input-textarea-wrapper:focus-within {
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .translation-cell textarea {
    height: 32px;
    font-size: 12px;
    line-height: 1.45;
    min-height: 32px;
    max-height: 32px;
    padding: 6px 8px;
    background: transparent;
  }

  .translation-preview {
    width: 100%;
    min-height: 32px;
    padding: 6px 8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    font-size: 12px;
    line-height: 1.45;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
    display: flex;
    align-items: center;
  }

  .translation-preview:hover {
    background: var(--semi-color-fill-0);
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
    min-height: 28px;
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    color: var(--app-text-muted);
    background: transparent;
  }

  .row-actions .semi-button:hover {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .row-actions .semi-button.semi-button-disabled,
  .row-actions .semi-button.semi-button-loading {
    background: transparent;
  }

  .row-actions .semi-button svg {
    width: 14px;
    height: 14px;
  }
`;

type LibrarySaveTarget = {
  label: string;
  parentId: number;
};

type SubtitleTableRowProps = {
  isActive: boolean;
  isEditing: boolean;
  isRunnerActive: boolean;
  onToggleEditingRow: (rowId: string) => void;
  onTranslationChange: (rowId: string, value: string) => void;
  onTranslateSingle: (rowId: string) => void;
  registerRowElement: (rowId: string, element: HTMLDivElement | null) => void;
  row: SubtitleTranslationRow;
  rowPosition: number;
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
  rowPosition,
}: SubtitleTableRowProps) => (
  <div
    ref={(element) => registerRowElement(row.id, element)}
    className="table-row"
    data-row-id={row.id}
    data-row-tone={rowPosition % 2 === 1 ? 'alternate' : 'base'}
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
          autosize={{ minRows: 1, maxRows: 1 }}
          value={row.translatedText}
          placeholder="译文会出现在这里，也可以手动修改"
          onBlur={() => onToggleEditingRow(row.id)}
          onChange={(value) => onTranslationChange(row.id, value)}
          onFocus={placeCaretAtTextEnd}
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
        aria-label={isActive ? '正在重新翻译当前句' : '重新翻译当前句'}
        className="subtitle-row-translate"
        icon={<IconRedoStroked />}
        size="small"
        loading={isActive}
        disabled={isRunnerActive && !isActive}
        theme="light"
        title={isActive ? '正在重新翻译' : '重新翻译当前句'}
        type="tertiary"
        onClick={() => onTranslateSingle(row.id)}
      />
    </div>
  </div>
), (prevProps, nextProps) => (
  prevProps.row === nextProps.row
  && prevProps.isActive === nextProps.isActive
  && prevProps.isEditing === nextProps.isEditing
  && prevProps.isRunnerActive === nextProps.isRunnerActive
  && prevProps.rowPosition === nextProps.rowPosition
));

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

  React.useEffect(() => {
    setScrollTop(0);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({ left: 0, top: 0 });
    }
  }, [resetKey]);

  React.useEffect(() => () => {
    cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(top);
    });
  }, []);

  const virtualRows = React.useMemo(() => {
    void virtualLayoutRevision;
    if (rows.length === 0) {
      return {
        bottomSpacerHeight: 0,
        topSpacerHeight: 0,
        visibleRows: [] as Array<{ row: SubtitleTranslationRow; rowPosition: number }>,
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
      visibleRows: rows.slice(startIndex, endIndex + 1).map((row, offset) => ({
        row,
        rowPosition: startIndex + offset,
      })),
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
        {virtualRows.visibleRows.map(({ row, rowPosition }) => (
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
            rowPosition={rowPosition}
          />
        ))}
        {virtualRows.bottomSpacerHeight > 0 ? (
          <div className="virtual-spacer" style={{ height: `${virtualRows.bottomSpacerHeight}px` }} />
        ) : null}
      </div>
    </SubtitleTable>
  );
});

type ToolWorkspaceSubtitleProps = {
  activeRowId: string | null;
  availableModels: string[];
  config: SubtitleTranslationConfig;
  deferredRows: SubtitleTranslationRow[];
  draft: SubtitleTranslationDraft;
  editingRowId: string | null;
  effectiveActiveRowId: string | null;
  importing: boolean;
  isRunnerActive: boolean;
  librarySaveTarget: LibrarySaveTarget | null;
  loadedSubtitleIdentity: string;
  loadingModels: boolean;
  runnerSnapshot: RunnerSnapshot;
  savingLibrary: boolean;
  savingLocal: boolean;
  selectedTreeNode: SelectedTreeNode | null;
  untranslatedCount: number;
  onConfigChange: (nextConfig: SubtitleTranslationConfig) => void;
  onImportDroppedFile: (file: File) => void;
  onImportLocal: () => void;
  onImportSelectedLibraryFile: () => void;
  onMergeAdjacentDuplicates: () => void;
  onLoadModels: () => Promise<boolean>;
  onRetranslateAll: () => void;
  onSaveLibrary: () => void;
  onSaveLocal: () => void;
  onStartTranslation: () => void;
  onStopTranslation: () => void;
  onToggleEditingRow: (rowId: string) => void;
  onTranslateSingle: (rowId: string) => void;
  onTranslationChange: (rowId: string, value: string) => void;
};

const ToolWorkspaceSubtitle: React.FC<ToolWorkspaceSubtitleProps> = ({
  activeRowId,
  availableModels,
  config,
  deferredRows,
  draft,
  editingRowId,
  effectiveActiveRowId,
  importing,
  isRunnerActive,
  librarySaveTarget,
  loadedSubtitleIdentity,
  loadingModels,
  runnerSnapshot,
  savingLibrary,
  savingLocal,
  selectedTreeNode,
  untranslatedCount,
  onConfigChange,
  onImportDroppedFile,
  onImportLocal,
  onImportSelectedLibraryFile,
  onMergeAdjacentDuplicates,
  onLoadModels,
  onRetranslateAll,
  onSaveLibrary,
  onSaveLocal,
  onStartTranslation,
  onStopTranslation,
  onToggleEditingRow,
  onTranslateSingle,
  onTranslationChange,
}) => {
  const [dropActive, setDropActive] = React.useState(false);
  const dragDepthRef = React.useRef(0);
  const fileSummary = draft.fileName || '未载入字幕';

  const resetDropState = React.useCallback(() => {
    dragDepthRef.current = 0;
    setDropActive(false);
  }, []);

  const handleDragEnter = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasNativeFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (importing) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    dragDepthRef.current += 1;
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, [importing]);

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasNativeFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
  }, [importing]);

  const handleDragLeave = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasNativeFileDrag(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDropActive(false);
    }
  }, []);

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasNativeFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    resetDropState();
    if (importing) {
      Toast.info('正在读取字幕，请稍候');
      return;
    }
    try {
      onImportDroppedFile(selectSingleDroppedSubtitleFile(event.dataTransfer.files));
    } catch (error: any) {
      Toast.warning(error?.message || '无法读取拖入的字幕文件');
      return;
    }
  }, [importing, onImportDroppedFile, resetDropState]);

  return (
    <SubtitleDropSurface
      onDragEnterCapture={handleDragEnter}
      onDragLeaveCapture={handleDragLeave}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
    >
      {dropActive ? (
        <SubtitleDropOverlay aria-live="polite" role="status">
          <div className="subtitle-drop-message">
            <IconFile />
            <span>松开以读取字幕文件</span>
          </div>
        </SubtitleDropOverlay>
      ) : null}
      <SubtitleWorkspaceHeader>
        <div className="header-copy">
          <HelpTitle
            className="header-title"
            help="读取本地或库内字幕，检查和编辑译文，再通过底部翻译栏选择语言、模型与推理强度后开始翻译。"
            helpLabel="查看 AI 字幕翻译功能说明"
            title="AI 字幕翻译"
          />
        </div>
        <SubtitleHeaderActions aria-label="字幕文件操作">
          <span className="header-action-anchor" title="读取本地字幕">
            <Button
              aria-label="读取本地字幕"
              icon={<IconUpload />}
              loading={importing}
              theme="borderless"
              onClick={onImportLocal}
            />
          </span>
          <span className="header-action-anchor" title="读取选中的字幕文件">
            <Button
              aria-label="读取选中的字幕文件"
              disabled={!selectedTreeNode || selectedTreeNode.type !== 'file'}
              icon={<IconImport />}
              loading={importing}
              theme="borderless"
              onClick={onImportSelectedLibraryFile}
            />
          </span>
          <span className="header-action-anchor" title="合并重复行">
            <Button
              aria-label="合并重复行"
              disabled={draft.rows.length === 0 || isRunnerActive}
              icon={<IconAlignCenterVertical />}
              theme="borderless"
              onClick={onMergeAdjacentDuplicates}
            />
          </span>
          <span className="header-action-anchor" title="另存到本地">
            <Button
              aria-label="另存到本地"
              disabled={draft.rows.length === 0}
              icon={<IconDownloadStroked />}
              loading={savingLocal}
              theme="borderless"
              onClick={onSaveLocal}
            />
          </span>
          <span
            className="header-action-anchor"
            title={librarySaveTarget ? `另存到库内 · ${librarySaveTarget.label}` : '另存到库内'}
          >
            <Button
              aria-label="另存到库内"
              disabled={draft.rows.length === 0 || !librarySaveTarget}
              icon={<IconCloudUploadStroked />}
              loading={savingLibrary}
              theme="borderless"
              onClick={onSaveLibrary}
            />
          </span>
        </SubtitleHeaderActions>
      </SubtitleWorkspaceHeader>

      <SubtitleWorkspaceBody>
        <SubtitleListPanel>
          {deferredRows.length === 0 ? (
            <div className="subtitle-empty">
              <Empty
                title="还没有字幕内容"
                description="读取本地字幕，或者从目录树导入当前选中的字幕文件。"
              />
            </div>
          ) : (
            <VirtualSubtitleTable
              key={loadedSubtitleIdentity}
              activeRowId={effectiveActiveRowId ?? activeRowId}
              editingRowId={editingRowId}
              isRunnerActive={isRunnerActive}
              onToggleEditingRow={onToggleEditingRow}
              onTranslationChange={onTranslationChange}
              onTranslateSingle={onTranslateSingle}
              resetKey={loadedSubtitleIdentity}
              rows={deferredRows}
            />
          )}
        </SubtitleListPanel>

        <SubtitleTranslationComposer
          availableModels={availableModels}
          config={config}
          disabled={draft.rows.length === 0 || untranslatedCount === 0}
          fileName={fileSummary}
          retranslateDisabled={draft.rows.length === 0}
          isRunnerActive={isRunnerActive}
          loadingModels={loadingModels}
          runnerSnapshot={runnerSnapshot}
          onConfigChange={onConfigChange}
          onLoadModels={onLoadModels}
          onRetranslateAll={onRetranslateAll}
          onStartTranslation={onStartTranslation}
          onStopTranslation={onStopTranslation}
        />
      </SubtitleWorkspaceBody>
    </SubtitleDropSurface>
  );
};

export default ToolWorkspaceSubtitle;

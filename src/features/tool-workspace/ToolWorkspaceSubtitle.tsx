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
} from '@douyinfe/semi-ui';
import { IconDownload, IconPlus } from '@douyinfe/semi-icons';

import type { SelectedTreeNode } from '@/features/file-explorer';

import type { RunnerSnapshot } from './subtitle-translation.runner';
import type {
  SubtitleTranslationConfig,
  SubtitleTranslationDraft,
  SubtitleTranslationRow,
} from './types';
import {
  ActionRow,
  ConfigGrid,
  Panel,
  WorkspaceBody,
  WorkspaceHeader,
} from './styles';

const ImportExportSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 4px;
`;

const SUBTITLE_TABLE_HEADER_HEIGHT = 34;
const SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT = 44;
const SUBTITLE_TABLE_OVERSCAN_PX = SUBTITLE_TABLE_ESTIMATED_ROW_HEIGHT * 6;

const SubtitleTable = styled.div`
  border: 1px solid var(--app-border);
  border-radius: 8px;
  overflow: hidden;
  min-height: 190px;
  display: flex;
  flex-direction: column;

  .table-scroll {
    overflow: auto;
    max-height: min(62vh, 560px);
    will-change: scroll-position;
  }

  .table-head,
  .table-row {
    display: grid;
    grid-template-columns: 176px minmax(154px, 1fr) minmax(182px, 1fr) 66px;
    gap: 0;
    min-width: 630px;
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
    min-width: 630px;
    pointer-events: none;
  }

  .cell {
    padding: 5px 8px;
    min-width: 0;
    display: flex;
    align-items: stretch;
  }

  .head-cell {
    font-size: 10px;
    font-weight: 700;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .time-cell {
    display: flex;
    align-items: center;
    gap: 5px;
    justify-content: center;
    white-space: nowrap;
  }

  .time-index {
    font-size: 10px;
    color: var(--app-text-muted);
    flex: none;
  }

  .time-range {
    font-size: 11px;
    line-height: 1.4;
    color: var(--app-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .source-cell {
    font-size: 11px;
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
    font-size: 11px;
    line-height: 1.45;
    min-height: 28px;
  }

  .translation-preview {
    width: 100%;
    min-height: 28px;
    padding: 5px 7px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--app-border) 82%, transparent);
    background: color-mix(in srgb, var(--app-bg) 94%, transparent);
    font-size: 11px;
    line-height: 1.45;
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
    min-height: 24px;
    font-size: 10px;
    width: 100%;
    min-width: 0;
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

function normalizeModelOptions(models: string[]) {
  return models.map((modelId) => ({
    label: modelId,
    value: modelId,
  }));
}

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
  subtitleListPanelRef: React.RefObject<HTMLElement | null>;
  untranslatedCount: number;
  onConfigChange: (nextConfig: SubtitleTranslationConfig) => void;
  onImportLocal: () => void;
  onImportSelectedLibraryFile: () => void;
  onMergeAdjacentDuplicates: () => void;
  onRefreshModels: () => void;
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
  subtitleListPanelRef,
  untranslatedCount,
  onConfigChange,
  onImportLocal,
  onImportSelectedLibraryFile,
  onMergeAdjacentDuplicates,
  onRefreshModels,
  onSaveLibrary,
  onSaveLocal,
  onStartTranslation,
  onStopTranslation,
  onToggleEditingRow,
  onTranslateSingle,
  onTranslationChange,
}) => (
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
              onChange={(value) => onConfigChange({ ...config, baseUrl: value })}
              placeholder="http://localhost:11434/v1"
            />
          </div>
          <div className="field">
            <div className="label">API Key</div>
            <Input
              value={config.apiKey}
              onChange={(value) => onConfigChange({ ...config, apiKey: value })}
              placeholder="ollama"
            />
          </div>
          <div className="field">
            <div className="label">模型</div>
            <div className="models-row">
              <Input
                value={config.model}
                onChange={(value) => onConfigChange({ ...config, model: value })}
                placeholder="例如 qwen3:8b"
              />
              <Button loading={loadingModels} onClick={onRefreshModels}>
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
                    onClick={() => onConfigChange({ ...config, model: item.value })}
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
              onChange={(value) => onConfigChange({ ...config, contextWindow: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <div className="label">翻译后释放模型</div>
            <Switch
              checked={config.unloadModelAfterTranslate}
              onChange={(checked) => onConfigChange({ ...config, unloadModelAfterTranslate: checked })}
            />
          </div>
          <div className="field full">
            <div className="label">目标语言</div>
            <Input
              value={config.targetLanguage}
              onChange={(value) => onConfigChange({ ...config, targetLanguage: value || '简体中文' })}
              placeholder="简体中文"
            />
          </div>
          <div className="field full">
            <div className="label">预设提示词</div>
            <TextArea
              autosize={{ minRows: 4, maxRows: 8 }}
              value={config.presetPrompt}
              onChange={(value) => onConfigChange({ ...config, presetPrompt: value })}
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
            <Button icon={<IconPlus />} loading={importing} onClick={onImportLocal}>
              读取本地字幕
            </Button>
            <Button
              icon={<IconDownload />}
              loading={importing}
              disabled={!selectedTreeNode || selectedTreeNode.type !== 'file'}
              onClick={onImportSelectedLibraryFile}
            >
              读取当前选中文件
            </Button>
            {isRunnerActive ? (
              <Button onClick={onStopTranslation}>
                停止翻译 ({runnerSnapshot.doneCount}/{runnerSnapshot.totalCount})
              </Button>
            ) : (
              <Button disabled={draft.rows.length === 0 || untranslatedCount === 0} onClick={onStartTranslation}>
                翻译未翻译 ({untranslatedCount})
              </Button>
            )}
            <Button disabled={draft.rows.length === 0 || isRunnerActive} onClick={onMergeAdjacentDuplicates}>
              合并重复行
            </Button>
            <Button loading={savingLocal} disabled={draft.rows.length === 0} onClick={onSaveLocal}>
              另存到本地
            </Button>
            <Button loading={savingLibrary} disabled={draft.rows.length === 0 || !librarySaveTarget} onClick={onSaveLibrary}>
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

      <Panel ref={subtitleListPanelRef as React.RefObject<HTMLElement>}>
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
      </Panel>
    </WorkspaceBody>
  </>
);

export default ToolWorkspaceSubtitle;

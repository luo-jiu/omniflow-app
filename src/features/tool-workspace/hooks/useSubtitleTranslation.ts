import React from 'react';
import { Toast } from '@douyinfe/semi-ui';

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
} from '../subtitle-translation.service';
import {
  subtitleTranslationRunner,
  type RunnerSnapshot,
} from '../subtitle-translation.runner';
import {
  buildTranslatedSubtitleFileName,
  isSupportedSubtitleExtension,
  mergeAdjacentDuplicateRows,
} from '../subtitle-translation.utils';
import type {
  SubtitleTranslationConfig,
  SubtitleTranslationDraft,
  SubtitleTranslationRow,
} from '../types';

type LibrarySaveTarget = {
  label: string;
  parentId: number;
};

type UseSubtitleTranslationInput = {
  draft: SubtitleTranslationDraft;
  libraryId: number;
  onDraftReplace: (nextDraft: SubtitleTranslationDraft) => void;
  onDraftUpdate: (updater: (current: SubtitleTranslationDraft) => SubtitleTranslationDraft) => void;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
};

function getLibrarySaveTarget(payload: {
  draft: SubtitleTranslationDraft;
  rootNodeId: number | null;
  selectedTreeNode: SelectedTreeNode | null;
}): LibrarySaveTarget | null {
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

export function useSubtitleTranslation(input: UseSubtitleTranslationInput) {
  const {
    draft,
    libraryId,
    onDraftReplace,
    onDraftUpdate,
    rootNodeId,
    selectedTreeNode,
  } = input;
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
  const subtitleListPanelRef = React.useRef<HTMLElement | null>(null);
  const pendingSubtitleListScrollRef = React.useRef(false);

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

  const updateRow = React.useCallback((rowId: string, updater: (row: SubtitleTranslationRow) => SubtitleTranslationRow) => {
    onDraftUpdate((current) => ({
      ...current,
      rows: current.rows.map((row) => (
        row.id === rowId ? updater(row) : row
      )),
    }));
  }, [onDraftUpdate]);

  const applyRunnerResults = React.useCallback(() => {
    const drained = subtitleTranslationRunner.drainResults();
    if (drained.size === 0) {
      return;
    }
    onDraftUpdate((current) => ({
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
  }, [onDraftUpdate]);

  React.useEffect(() => {
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

  const persistConfig = React.useCallback((nextConfig: SubtitleTranslationConfig) => {
    setConfig(nextConfig);
    saveSubtitleTranslationPreferences(nextConfig);
  }, []);

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
    onDraftUpdate((current) => ({
      ...current,
      rows: merged,
    }));
    Toast.success(`已合并 ${removedCount} 条重复行，剩余 ${merged.length} 条`);
  }, [draft.fileFormat, draft.rows, onDraftUpdate]);

  const handleRefreshModels = React.useCallback(async () => {
    setLoadingModels(true);
    try {
      const modelIds = await fetchAvailableTranslationModels(config);
      setAvailableModels(modelIds);
      if (!config.model && modelIds.length > 0) {
        const nextConfig = { ...config, model: modelIds[0] };
        persistConfig(nextConfig);
      }
      Toast.success(modelIds.length > 0 ? `已获取 ${modelIds.length} 个模型` : '当前未返回模型列表');
    } catch (error: any) {
      Toast.error(error?.message || '获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  }, [config, persistConfig]);

  const handleImportLocal = React.useCallback(async () => {
    subtitleTranslationRunner.stop();
    setImporting(true);
    try {
      const result = await pickLocalSubtitleFile();
      if (!result) {
        return;
      }
      setActiveRowId(null);
      setEditingRowId(null);
      bumpSubtitleDatasetVersion();
      onDraftReplace({
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
  }, [onDraftReplace, scrollToSubtitleList]);

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
      setActiveRowId(null);
      setEditingRowId(null);
      bumpSubtitleDatasetVersion();
      onDraftReplace({
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
  }, [libraryId, onDraftReplace, scrollToSubtitleList, selectedTreeNode]);

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

  return {
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
    handlers: {
      onConfigChange: persistConfig,
      onImportLocal: () => void handleImportLocal(),
      onImportSelectedLibraryFile: () => void handleImportSelectedLibraryFile(),
      onMergeAdjacentDuplicates: handleMergeAdjacentDuplicates,
      onRefreshModels: () => void handleRefreshModels(),
      onSaveLibrary: () => void handleSaveLibrary(),
      onSaveLocal: () => void handleSaveLocal(),
      onStartTranslation: handleStartTranslation,
      onStopTranslation: handleStopTranslation,
      onToggleEditingRow: handleToggleEditingRow,
      onTranslateSingle: handleTranslateSingleSync,
      onTranslationChange: handleTranslationChange,
    },
    resetState: () => {
      subtitleTranslationRunner.stop();
      setActiveRowId(null);
      setEditingRowId(null);
      bumpSubtitleDatasetVersion();
    },
  };
}

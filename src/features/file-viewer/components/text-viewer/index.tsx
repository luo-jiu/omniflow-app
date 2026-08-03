import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Spin, Toast, Tooltip } from '@douyinfe/semi-ui';
import { IconCopyAdd, IconDownload, IconSave } from '@douyinfe/semi-icons';
import CodeMirror from '@uiw/react-codemirror';
import { keymap, EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { useTheme } from '@/hooks/useTheme';
import {
  fetchNodeDetailById,
  getFileLink,
  updateNodeFileContent,
  uploadLocalPathAndCreateNode,
} from '@/features/file-explorer/services/file.api';
import { useFileViewer } from '@/hooks/useFileViewer';
import { refreshDirectoryInTree } from '@/features/file-explorer/services/tree-locate';
import { runtimeLogger } from '@/utils/runtimeLogger';
import {
  createViewerDraftKey,
  createViewerResourceKey,
  useViewerSession,
  viewerDraftStore,
  ViewerDraftStoreError,
  type ViewerDraftKey,
  type ViewerDraftRecord,
  type ViewerResourceKey,
  type ViewerSessionAdapter,
} from '@/features/file-viewer/session';
import { TextViewerWrapper } from './style';
import { resolveTextEditorLanguage } from './language';
import {
  createTextContentRevision,
  parseTextViewerSessionSnapshot,
  TEXT_VIEWER_SESSION_ESTIMATED_BYTES,
  TEXT_VIEWER_SESSION_SCHEMA_VERSION,
  type TextViewerSessionSnapshot,
} from './text-viewer-session';
import { resolveTextSaveFeedback } from './text-viewer-save';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

interface TextViewerProps {
  accountScope: string | null;
  active?: boolean;
  contentRevision: string | null;
  fileName?: string | null;
  libraryId: number | null;
  nodeId: number | null;
  reloadToken?: number;
  tabId: string;
  url: string;
}

interface IpcTextFetchResponse {
  status?: number;
  body?: unknown;
}

interface DraftRecoveryState {
  conflict: boolean;
  draft: ViewerDraftRecord;
  remoteContent: string;
  remoteRevision: string;
}

type ViewerZoomShortcutAction = 'zoom-in' | 'zoom-out' | 'reset';

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 15;
const FONT_SIZE_STEP = 1;
const DRAFT_WRITE_DEBOUNCE_MS = 700;
const TEXT_EDITOR_BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLineGutter: true,
  highlightActiveLine: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true,
} as const;
const HIGHLIGHT_SOURCE_LABEL = {
  lezer: '官方语法高亮',
  legacy: '兼容语法高亮',
  plain: '纯文本',
} as const;

function clampFontSize(size: number): number {
  return Math.min(Math.max(Math.round(size), MIN_FONT_SIZE), MAX_FONT_SIZE);
}

function readTextResponseBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  return String(body);
}

function normalizeProvidedRevision(value: string | null): string | null {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

const TextViewer: React.FC<TextViewerProps> = ({
  accountScope,
  active = true,
  contentRevision,
  fileName,
  libraryId,
  nodeId,
  reloadToken = 0,
  tabId,
  url,
}) => {
  const { resolvedTheme } = useTheme();
  const { updateFileTabResource } = useFileViewer();
  const [content, setContent] = useState<string | null>(null);
  const [draftRecovery, setDraftRecovery] = useState<DraftRecoveryState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const contentRef = useRef('');
  const draftErrorShownRef = useRef(false);
  const draftKeyRef = useRef<ViewerDraftKey | null>(null);
  const draftPersistedRef = useRef(true);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftWriteGenerationRef = useRef<number | null>(null);
  const editGenerationRef = useRef(0);
  const editorViewRef = useRef<EditorView | null>(null);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);
  const isAliveRef = useRef(true);
  const isDirtyRef = useRef(false);
  const latestSessionSnapshotRef = useRef<TextViewerSessionSnapshot | null>(null);
  const loadedUrlRef = useRef('');
  const pendingContentRef = useRef<string | null>(null);
  const pendingSessionHydrationRef = useRef(false);
  const pendingSessionSnapshotRef = useRef<TextViewerSessionSnapshot | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const sessionCaptureFrameRef = useRef<number | null>(null);
  const wordWrapRef = useRef(false);
  fontSizeRef.current = fontSize;
  wordWrapRef.current = wordWrap;

  const resourceIdentity = useMemo<ViewerResourceKey | null>(() => {
    if (!accountScope || libraryId == null) return null;
    return createViewerResourceKey({
      accountScope,
      libraryId,
      nodeId,
      viewerKind: 'text',
    });
  }, [accountScope, libraryId, nodeId]);
  const resourceIdentityRef = useRef(resourceIdentity);
  resourceIdentityRef.current = resourceIdentity;

  const setDirtyState = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    if (isAliveRef.current) setIsDirty(dirty);
  }, []);

  const setEditorContent = useCallback((value: string, dirty: boolean) => {
    pendingContentRef.current = value;
    contentRef.current = value;
    setContent(value);
    setDirtyState(dirty);
  }, [setDirtyState]);

  const clearDraftTimer = useCallback(() => {
    if (draftTimerRef.current == null) return;
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
  }, []);

  const reportDraftFailure = useCallback((error: unknown) => {
    runtimeLogger.error('文本草稿写入失败:', error);
    draftPersistedRef.current = false;
    if (isAliveRef.current && !draftErrorShownRef.current) {
      draftErrorShownRef.current = true;
      Toast.error('草稿无法持久化，请及时保存文件');
    }
  }, []);

  const flushDraft = useCallback(async () => {
    clearDraftTimer();
    if (!isDirtyRef.current) return true;
    const identity = resourceIdentityRef.current;
    const draftKey = draftKeyRef.current;
    if (!identity || !draftKey) {
      reportDraftFailure(new Error('Text draft requires a stable resource identity and revision'));
      return false;
    }
    const generation = editGenerationRef.current;
    const nextContent = contentRef.current;
    try {
      await viewerDraftStore.writeDraft(draftKey, nextContent, {
        writeGeneration: draftWriteGenerationRef.current,
      });
      if (generation === editGenerationRef.current) {
        draftPersistedRef.current = true;
        draftErrorShownRef.current = false;
      }
      return true;
    } catch (error) {
      if (error instanceof ViewerDraftStoreError && error.code === 'draft-invalidated') {
        return true;
      }
      reportDraftFailure(error);
      return false;
    }
  }, [clearDraftTimer, reportDraftFailure]);

  const scheduleDraftFlush = useCallback(() => {
    clearDraftTimer();
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      void flushDraft();
    }, DRAFT_WRITE_DEBOUNCE_MS);
  }, [clearDraftTimer, flushDraft]);

  const captureTextSessionSnapshot = useCallback((): TextViewerSessionSnapshot => {
    const view = editorViewRef.current;
    let nextSnapshot = latestSessionSnapshotRef.current ?? {
      fontSize: fontSizeRef.current,
      wordWrap: wordWrapRef.current,
      selectionAnchor: 0,
      selectionHead: 0,
      topLine: 1,
      topLineOffset: 0,
      scrollTop: 0,
      scrollLeft: 0,
    };
    if (view) {
      const selection = view.state.selection.main;
      const scrollTop = Math.max(view.scrollDOM.scrollTop, 0);
      const scrollLeft = Math.max(view.scrollDOM.scrollLeft, 0);
      let topLine = 1;
      let topLineOffset = 0;
      try {
        const block = view.lineBlockAtHeight(scrollTop);
        topLine = view.state.doc.lineAt(block.from).number;
        topLineOffset = Math.max(scrollTop - block.top, 0);
      } catch {
        // Raw scroll offsets remain the fallback when CodeMirror has not measured layout yet.
      }
      nextSnapshot = {
        fontSize: fontSizeRef.current,
        wordWrap: wordWrapRef.current,
        selectionAnchor: selection.anchor,
        selectionHead: selection.head,
        topLine,
        topLineOffset,
        scrollTop,
        scrollLeft,
      };
    } else {
      nextSnapshot = {
        ...nextSnapshot,
        fontSize: fontSizeRef.current,
        wordWrap: wordWrapRef.current,
      };
    }
    latestSessionSnapshotRef.current = nextSnapshot;
    return nextSnapshot;
  }, []);

  const applySessionSnapshotToEditor = useCallback((snapshot: TextViewerSessionSnapshot) => {
    const view = editorViewRef.current;
    if (!view) return;
    const docLength = view.state.doc.length;
    const anchor = Math.min(snapshot.selectionAnchor, docLength);
    const head = Math.min(snapshot.selectionHead, docLength);
    view.dispatch({ selection: { anchor, head } });
    if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        const currentView = editorViewRef.current;
        if (!currentView) return;
        const lineNumber = Math.min(snapshot.topLine, currentView.state.doc.lines);
        let scrollTop = snapshot.scrollTop;
        try {
          const line = currentView.state.doc.line(lineNumber);
          const block = currentView.lineBlockAt(line.from);
          scrollTop = Math.max(block.top + snapshot.topLineOffset, 0);
        } catch {
          // Keep the raw scrollTop fallback.
        }
        currentView.scrollDOM.scrollTop = scrollTop;
        currentView.scrollDOM.scrollLeft = snapshot.scrollLeft;
      });
    });
  }, []);

  const restoreTextSessionSnapshot = useCallback((payload: TextViewerSessionSnapshot) => {
    const snapshot = parseTextViewerSessionSnapshot(payload);
    if (!snapshot) return;
    const normalized = {
      ...snapshot,
      fontSize: clampFontSize(snapshot.fontSize),
    };
    latestSessionSnapshotRef.current = normalized;
    pendingSessionSnapshotRef.current = normalized;
    pendingSessionHydrationRef.current = true;
    fontSizeRef.current = normalized.fontSize;
    wordWrapRef.current = normalized.wordWrap;
    setFontSize(normalized.fontSize);
    setWordWrap(normalized.wordWrap);
    applySessionSnapshotToEditor(normalized);
  }, [applySessionSnapshotToEditor]);

  const sessionAdapter = useMemo<ViewerSessionAdapter<TextViewerSessionSnapshot>>(() => ({
    capture: captureTextSessionSnapshot,
    restore: restoreTextSessionSnapshot,
    suspend: () => undefined,
    resume: () => undefined,
    estimateCost: () => TEXT_VIEWER_SESSION_ESTIMATED_BYTES,
    getPinReasons: () => (
      isDirtyRef.current && !draftPersistedRef.current ? ['dirty'] : []
    ),
  }), [captureTextSessionSnapshot, restoreTextSessionSnapshot]);

  const { capture: captureSessionSnapshot } = useViewerSession({
    accountScope,
    active,
    adapter: sessionAdapter,
    contentRevision: null,
    libraryId,
    nodeId,
    reloadToken,
    schemaVersion: TEXT_VIEWER_SESSION_SCHEMA_VERSION,
    tabId,
    viewerKind: 'text',
  });

  const scheduleSessionCapture = useCallback(() => {
    if (sessionCaptureFrameRef.current != null) return;
    sessionCaptureFrameRef.current = requestAnimationFrame(() => {
      sessionCaptureFrameRef.current = null;
      captureSessionSnapshot();
    });
  }, [captureSessionSnapshot]);

  const handleEditorCreate = useCallback((view: EditorView) => {
    editorViewRef.current = view;
    const snapshot = pendingSessionSnapshotRef.current;
    if (snapshot) applySessionSnapshotToEditor(snapshot);
  }, [applySessionSnapshotToEditor]);

  const handleEditorUpdate = useCallback((update: ViewUpdate) => {
    if (update.selectionSet || update.viewportChanged || update.geometryChanged) {
      scheduleSessionCapture();
    }
  }, [scheduleSessionCapture]);

  useEffect(() => {
    if (!url) return;
    const providedRevision = normalizeProvidedRevision(contentRevision);
    const loadKey = `${url}::${reloadToken}::${providedRevision ?? ''}`;
    if (loadedUrlRef.current === loadKey) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);
    setDraftRecovery(null);

    (async () => {
      try {
        const response = await window.electronAPI.fetch(url, { method: 'GET' }) as IpcTextFetchResponse;
        const status = Number(response?.status ?? 0);
        if (status >= 400) throw new Error(`HTTP ${status}`);
        const remoteContent = readTextResponseBody(response?.body);
        let contentHashRevision: string | null = null;
        try {
          contentHashRevision = await createTextContentRevision(remoteContent);
        } catch (error) {
          runtimeLogger.warn('创建文本内容 revision 失败，草稿恢复将降级:', error);
        }
        const remoteRevision = providedRevision && !providedRevision.startsWith('sha256:')
          ? providedRevision
          : (contentHashRevision ?? providedRevision);
        if (cancelled) return;
        loadedUrlRef.current = loadKey;
        const currentDraftKey = resourceIdentity && remoteRevision
          ? createViewerDraftKey(resourceIdentity, remoteRevision)
          : null;
        draftKeyRef.current = currentDraftKey;
        draftWriteGenerationRef.current = resourceIdentity
          ? viewerDraftStore.getWriteGeneration(resourceIdentity)
          : null;
        setEditorContent(remoteContent, false);
        draftPersistedRef.current = true;
        draftErrorShownRef.current = false;

        if (!resourceIdentity || !currentDraftKey || !remoteRevision) return;
        try {
          const draft = await viewerDraftStore.readLatest(resourceIdentity);
          if (cancelled || !draft) return;
          if (draft.content === remoteContent) {
            await viewerDraftStore.deleteDraft(resourceIdentity);
            return;
          }
          if (cancelled) return;
          setDraftRecovery({
            conflict: draft.key.contentRevision !== remoteRevision,
            draft,
            remoteContent,
            remoteRevision,
          });
        } catch (error) {
          runtimeLogger.error('文本草稿读取失败:', error);
          if (!cancelled) Toast.error('草稿恢复不可用，请及时保存文件');
        }
      } catch (error: any) {
        if (!cancelled) {
          runtimeLogger.error('文本文件加载失败:', error);
          setErrorMessage('文件加载失败');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contentRevision, reloadToken, resourceIdentity, setEditorContent, url]);

  useEffect(() => {
    if (pendingSessionHydrationRef.current) {
      const expected = pendingSessionSnapshotRef.current;
      if (expected && (
        clampFontSize(fontSize) !== expected.fontSize
        || wordWrap !== expected.wordWrap
      )) {
        return;
      }
      pendingSessionHydrationRef.current = false;
    }
    captureSessionSnapshot();
  }, [captureSessionSnapshot, fontSize, wordWrap]);

  useEffect(() => {
    if (!active) void flushDraft();
  }, [active, flushDraft]);

  useEffect(() => {
    const handlePageHide = () => {
      void flushDraft();
      captureSessionSnapshot();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [captureSessionSnapshot, flushDraft]);

  useEffect(() => {
    isAliveRef.current = true;
    return () => {
      isAliveRef.current = false;
      clearDraftTimer();
      void flushDraft();
      if (restoreFrameRef.current != null) cancelAnimationFrame(restoreFrameRef.current);
      if (sessionCaptureFrameRef.current != null) cancelAnimationFrame(sessionCaptureFrameRef.current);
      editorViewRef.current = null;
    };
  }, [clearDraftTimer, flushDraft]);

  const buildFullFileName = useCallback((detail: { name: string; ext?: string }) => {
    const ext = detail.ext?.trim().replace(/^\./, '');
    return ext ? `${detail.name}.${ext}` : detail.name;
  }, []);

  const handleSave = useCallback(async () => {
    if (!nodeId || isSaving) return;
    setIsSaving(true);
    clearDraftTimer();
    const savedContent = contentRef.current;
    const saveGeneration = editGenerationRef.current;
    const saveIdentity = resourceIdentityRef.current;
    try {
      let savedRevision: string | null = null;
      try {
        savedRevision = await createTextContentRevision(savedContent);
      } catch (error) {
        runtimeLogger.warn('创建已保存文本 revision 失败:', error);
      }
      const detail = await fetchNodeDetailById(nodeId);
      const savedNode = await updateNodeFileContent({
        nodeId,
        libraryId: detail.libraryId,
        content: savedContent,
        contentType: detail.mimeType || 'text/plain; charset=utf-8',
      });
      const savedNodeId = Number(savedNode?.id || nodeId);
      const identity = saveIdentity;
      let draftCleanupFailed = false;
      if (identity) {
        try {
          await viewerDraftStore.deleteDraft(identity);
        } catch (error) {
          draftCleanupFailed = true;
          runtimeLogger.error('清理已保存文本草稿失败:', error);
        }
        draftKeyRef.current = savedRevision
          ? createViewerDraftKey(identity, savedRevision)
          : null;
      }
      const editedDuringSave = saveGeneration !== editGenerationRef.current;
      let followUpDraftPersisted = true;
      if (editedDuringSave) {
        draftPersistedRef.current = false;
        followUpDraftPersisted = await flushDraft();
      } else {
        setDirtyState(false);
        draftPersistedRef.current = true;
        draftErrorShownRef.current = false;
      }
      refreshDirectoryInTree(detail.parentId);
      const feedback = resolveTextSaveFeedback({
        draftCleanupFailed,
        editedDuringSave,
        followUpDraftPersisted,
      });
      if (feedback.level === 'warning') {
        Toast.warning(feedback.message);
      } else {
        Toast.success(feedback.message);
      }
      try {
        const newUrl = await getFileLink(savedNodeId, detail.libraryId);
        if (
          newUrl
          && isAliveRef.current
          && resourceIdentityRef.current === saveIdentity
        ) {
          loadedUrlRef.current = `${newUrl}::${reloadToken}::${savedRevision ?? ''}`;
          updateFileTabResource(tabId, {
            contentRevision: savedRevision,
            expectedNodeId: savedNodeId,
            fileUrl: newUrl,
          });
        }
      } catch {
        // URL 刷新失败不影响保存成功。
      }
    } catch (error: any) {
      runtimeLogger.error('文本保存失败:', error);
      if (isAliveRef.current) {
        Toast.error(error?.message || '保存失败');
        scheduleDraftFlush();
      }
    } finally {
      if (isAliveRef.current) setIsSaving(false);
    }
  }, [
    clearDraftTimer,
    flushDraft,
    isSaving,
    nodeId,
    reloadToken,
    scheduleDraftFlush,
    setDirtyState,
    tabId,
    updateFileTabResource,
  ]);

  const handleSaveAs = useCallback(async () => {
    if (!nodeId || isSaving) return;
    setIsSaving(true);
    try {
      const detail = await fetchNodeDetailById(nodeId);
      const saveName = buildFullFileName(detail);
      const staged = await window.electronAPI.createStagedTextFile(saveName, contentRef.current);
      try {
        await uploadLocalPathAndCreateNode(staged.filePath, detail.parentId, detail.libraryId, {
          conflictPolicy: 'auto_rename',
        });
        Toast.success('已另存为新文件');
        refreshDirectoryInTree(detail.parentId);
      } finally {
        await window.electronAPI.cleanupStagedTextFile(staged.filePath).catch(() => false);
      }
    } catch (error: any) {
      runtimeLogger.error('另存为失败:', error);
      Toast.error(error?.message || '另存为失败');
    } finally {
      setIsSaving(false);
    }
  }, [buildFullFileName, isSaving, nodeId]);

  const handleRestoreDraft = useCallback(() => {
    if (!draftRecovery) return;
    draftKeyRef.current = draftRecovery.draft.key;
    editGenerationRef.current += 1;
    setEditorContent(draftRecovery.draft.content, true);
    draftPersistedRef.current = true;
    draftErrorShownRef.current = false;
    setDraftRecovery(null);
  }, [draftRecovery, setEditorContent]);

  const handleDiscardDraft = useCallback(async () => {
    if (!draftRecovery || !resourceIdentity) return;
    try {
      await viewerDraftStore.deleteDraft(resourceIdentity);
      draftKeyRef.current = createViewerDraftKey(resourceIdentity, draftRecovery.remoteRevision);
      setEditorContent(draftRecovery.remoteContent, false);
      draftPersistedRef.current = true;
      draftErrorShownRef.current = false;
      setDraftRecovery(null);
    } catch (error) {
      runtimeLogger.error('放弃文本草稿失败:', error);
      Toast.error('草稿删除失败，请重试');
    }
  }, [draftRecovery, resourceIdentity, setEditorContent]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const handleSaveAsRef = useRef(handleSaveAs);
  handleSaveAsRef.current = handleSaveAs;

  const applyViewerZoomShortcut = useCallback((action: ViewerZoomShortcutAction) => {
    if (!active) return;
    if (action === 'zoom-in') {
      setFontSize((previous) => clampFontSize(previous + FONT_SIZE_STEP));
      return;
    }
    if (action === 'zoom-out') {
      setFontSize((previous) => clampFontSize(previous - FONT_SIZE_STEP));
      return;
    }
    setFontSize(DEFAULT_FONT_SIZE);
  }, [active]);

  useEffect(() => {
    const off = window.electronAPI?.onViewerZoomShortcut?.(({ action }) => {
      applyViewerZoomShortcut(action);
    });
    return () => off?.();
  }, [applyViewerZoomShortcut]);

  const saveKeymap = useMemo(
    () => keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSaveRef.current();
          return true;
        },
      },
      {
        key: 'Mod-Shift-s',
        run: () => {
          handleSaveAsRef.current();
          return true;
        },
      },
      {
        key: 'Mod-=',
        run: () => {
          setFontSize((previous) => clampFontSize(previous + FONT_SIZE_STEP));
          return true;
        },
      },
      {
        key: 'Mod-+',
        run: () => {
          setFontSize((previous) => clampFontSize(previous + FONT_SIZE_STEP));
          return true;
        },
      },
      {
        key: 'Mod--',
        run: () => {
          setFontSize((previous) => clampFontSize(previous - FONT_SIZE_STEP));
          return true;
        },
      },
      {
        key: 'Mod-0',
        run: () => {
          setFontSize(DEFAULT_FONT_SIZE);
          return true;
        },
      },
    ]),
    [],
  );

  const fontTheme = useMemo(
    () => EditorView.theme({
      '&': {
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: `${fontSize}px`,
      },
      '.cm-content': {
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: `${fontSize}px`,
        lineHeight: '1.65',
      },
      '.cm-gutters': {
        fontSize: `${Math.max(fontSize - 2, 11)}px`,
      },
    }),
    [fontSize],
  );

  const wrapExtension = useMemo(
    () => (wordWrap ? EditorView.lineWrapping : []),
    [wordWrap],
  );
  const textLanguage = useMemo(() => resolveTextEditorLanguage(fileName), [fileName]);
  const extensions = useMemo(() => {
    const nextExtensions: Extension[] = [saveKeymap, fontTheme, wrapExtension];
    if (textLanguage.extension) nextExtensions.push(textLanguage.extension);
    return nextExtensions;
  }, [fontTheme, saveKeymap, textLanguage, wrapExtension]);

  const handleChange = useCallback((value: string) => {
    if (pendingContentRef.current !== null) {
      const pendingContent = pendingContentRef.current;
      pendingContentRef.current = null;
      if (value === pendingContent) {
        contentRef.current = value;
        return;
      }
    }
    contentRef.current = value;
    setContent(value);
    editGenerationRef.current += 1;
    setDirtyState(true);
    draftPersistedRef.current = false;
    scheduleDraftFlush();
  }, [scheduleDraftFlush, setDirtyState]);

  if (!active && content === null) return null;

  return (
    <TextViewerWrapper>
      {isLoading ? (
        <div className="loading-mask">
          <Spin size="large" tip="正在加载文件..." />
        </div>
      ) : errorMessage ? (
        <div className="state-error">{errorMessage}</div>
      ) : (
        <div className="editor-stage">
          <CodeMirror
            value={content ?? ''}
            height="100%"
            theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
            extensions={extensions}
            onChange={handleChange}
            onCreateEditor={handleEditorCreate}
            onUpdate={handleEditorUpdate}
            basicSetup={TEXT_EDITOR_BASIC_SETUP}
          />
        </div>
      )}

      <div className="viewer-footer">
        <div className="footer-title-group">
          <span className="title-badge" title={HIGHLIGHT_SOURCE_LABEL[textLanguage.source]}>
            {textLanguage.label}
          </span>
          <span className="title" title={fileName || '文本预览'}>
            {fileName || '文本预览'}
          </span>
          {isDirty ? <span className="dirty-dot" title="未保存的更改" /> : null}
        </div>

        <div className="footer-controls">
          <span
            className="meta-text zoom-text"
            title={`当前字号 ${fontSize}px`}
            aria-label={`当前字号 ${fontSize}px`}
          >
            {fontSize}
          </span>
          <button
            type="button"
            className={`wrap-toggle ${wordWrap ? 'is-active' : ''}`}
            onClick={() => setWordWrap((previous) => !previous)}
            title={wordWrap ? '关闭自动换行' : '开启自动换行'}
          >
            换行
          </button>
        </div>

        <div className="footer-actions">
          <Tooltip content="保存">
            <span className="action-tooltip-anchor">
              <Button
                size="small"
                theme="solid"
                icon={<IconSave />}
                className="icon-action-btn"
                aria-label="保存"
                disabled={!isDirty || isSaving || draftRecovery !== null}
                loading={isSaving}
                onClick={handleSave}
              />
            </span>
          </Tooltip>
          <Tooltip content="另存为">
            <span className="action-tooltip-anchor">
              <Button
                size="small"
                theme="light"
                icon={<IconCopyAdd />}
                className="icon-action-btn"
                aria-label="另存为"
                disabled={isSaving || draftRecovery !== null}
                onClick={handleSaveAs}
              />
            </span>
          </Tooltip>
          <Tooltip content="下载">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-action-link"
              download={fileName || undefined}
              aria-label="下载"
            >
              <IconDownload />
            </a>
          </Tooltip>
        </div>
      </div>

      <Modal
        visible={draftRecovery !== null}
        title={draftRecovery?.conflict ? '检测到内容冲突' : '发现未保存草稿'}
        okText="恢复草稿"
        cancelText="使用最新文件"
        closable={false}
        maskClosable={false}
        onOk={handleRestoreDraft}
        onCancel={() => void handleDiscardDraft()}
      >
        <div className="draft-recovery-copy">
          {draftRecovery?.conflict
            ? '文件内容在草稿保存后发生了变化。恢复草稿后再次保存会覆盖当前文件内容。'
            : '上次编辑的内容尚未保存到文件。请选择恢复草稿或使用当前文件内容。'}
        </div>
      </Modal>
    </TextViewerWrapper>
  );
};

export default TextViewer;

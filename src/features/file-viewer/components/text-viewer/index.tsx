import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Spin, Toast, Tooltip } from '@douyinfe/semi-ui';
import { IconCopyAdd, IconDownload, IconSave } from '@douyinfe/semi-icons';
import CodeMirror from '@uiw/react-codemirror';
import { keymap, EditorView } from '@codemirror/view';
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
import { TextViewerWrapper } from './style';
import { resolveTextEditorLanguage } from './language';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

interface TextViewerProps {
  nodeId: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  reloadToken?: number;
}

interface IpcTextFetchResponse {
  status?: number;
  body?: unknown;
}

type ViewerZoomShortcutAction = 'zoom-in' | 'zoom-out' | 'reset';

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 15;
const FONT_SIZE_STEP = 1;
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

const TextViewer: React.FC<TextViewerProps> = ({
  nodeId,
  url,
  fileName,
  active = true,
  reloadToken = 0,
}) => {
  const { resolvedTheme } = useTheme();
  const { setFileUrl } = useFileViewer();
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [wordWrap, setWordWrap] = useState(false);
  const contentRef = useRef<string>('');
  const loadedUrlRef = useRef<string>('');

  useEffect(() => {
    if (!url || loadedUrlRef.current === `${url}::${reloadToken}`) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    (async () => {
      try {
        const response = await window.electronAPI.fetch(url, {
          method: 'GET',
        }) as IpcTextFetchResponse;
        const status = Number(response?.status ?? 0);
        if (status >= 400) throw new Error(`HTTP ${status}`);
        const text = readTextResponseBody(response?.body);
        if (cancelled) return;
        loadedUrlRef.current = `${url}::${reloadToken}`;
        setContent(text);
        contentRef.current = text;
        setIsDirty(false);
      } catch (error: any) {
        if (!cancelled) {
          runtimeLogger.error('文本文件加载失败:', error);
          setErrorMessage('文件加载失败');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url, reloadToken]);

  const buildFullFileName = useCallback((detail: { name: string; ext?: string }) => {
    const ext = detail.ext?.trim().replace(/^\./, '');
    return ext ? `${detail.name}.${ext}` : detail.name;
  }, []);

  const handleSave = useCallback(async () => {
    if (!nodeId || isSaving) return;
    setIsSaving(true);
    try {
      const detail = await fetchNodeDetailById(nodeId);
      const savedContent = contentRef.current;
      const savedNode = await updateNodeFileContent({
        nodeId,
        libraryId: detail.libraryId,
        content: savedContent,
        contentType: detail.mimeType || 'text/plain; charset=utf-8',
      });
      const savedNodeId = Number(savedNode?.id || nodeId);
      contentRef.current = savedContent;
      setContent(savedContent);
      setIsDirty(false);
      refreshDirectoryInTree(detail.parentId);
      Toast.success('已保存');
      try {
        const newUrl = await getFileLink(savedNodeId, detail.libraryId);
        if (newUrl) {
          loadedUrlRef.current = `${newUrl}::${reloadToken}`;
          setFileUrl(newUrl, fileName || null, 'text', savedNodeId);
        }
      } catch {
        // URL 刷新失败不影响保存成功
      }
    } catch (error: any) {
      runtimeLogger.error('文本保存失败:', error);
      Toast.error(error?.message || '保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [nodeId, isSaving, reloadToken, fileName, setFileUrl]);

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
  }, [nodeId, isSaving, buildFullFileName]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleSaveAsRef = useRef(handleSaveAs);
  handleSaveAsRef.current = handleSaveAs;

  const applyViewerZoomShortcut = useCallback((action: ViewerZoomShortcutAction) => {
    if (!active) return;
    if (action === 'zoom-in') {
      setFontSize((prev) => clampFontSize(prev + FONT_SIZE_STEP));
      return;
    }
    if (action === 'zoom-out') {
      setFontSize((prev) => clampFontSize(prev - FONT_SIZE_STEP));
      return;
    }
    setFontSize(DEFAULT_FONT_SIZE);
  }, [active]);

  useEffect(() => {
    const off = window.electronAPI?.onViewerZoomShortcut?.(({ action }) => {
      applyViewerZoomShortcut(action);
    });
    return () => {
      off?.();
    };
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
          setFontSize((prev) => clampFontSize(prev + FONT_SIZE_STEP));
          return true;
        },
      },
      {
        key: 'Mod-+',
        run: () => {
          setFontSize((prev) => clampFontSize(prev + FONT_SIZE_STEP));
          return true;
        },
      },
      {
        key: 'Mod--',
        run: () => {
          setFontSize((prev) => clampFontSize(prev - FONT_SIZE_STEP));
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
    const exts: Extension[] = [saveKeymap, fontTheme, wrapExtension];
    if (textLanguage.extension) exts.push(textLanguage.extension);
    return exts;
  }, [saveKeymap, fontTheme, wrapExtension, textLanguage]);

  const handleChange = useCallback((value: string) => {
    contentRef.current = value;
    setContent(value);
    setIsDirty(true);
  }, []);

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
            onClick={() => setWordWrap((prev) => !prev)}
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
                disabled={!isDirty || isSaving}
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
                disabled={isSaving}
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
    </TextViewerWrapper>
  );
};

export default TextViewer;

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import { IconMinus, IconPlus } from '@douyinfe/semi-icons';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { xml } from '@codemirror/lang-xml';
import { python } from '@codemirror/lang-python';
import { keymap, EditorView } from '@codemirror/view';
import { useTheme } from '@/hooks/useTheme';
import {
  fetchNodeDetailById,
  getFileLink,
  updateNodeFileContent,
  uploadLocalPathAndCreateNode,
} from '@/features/file-explorer/services/file.api';
import { useFileViewer } from '@/hooks/useFileViewer';
import { refreshDirectoryInTree } from '@/features/file-explorer/services/tree-locate';
import { normalizeFileExtension } from '@/utils/preview-file-type';
import { runtimeLogger } from '@/utils/runtimeLogger';
import { TextViewerWrapper } from './style';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

interface TextViewerProps {
  nodeId: number | null;
  url: string;
  fileName?: string | null;
  active?: boolean;
  reloadToken?: number;
}

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 15;
const FONT_SIZE_STEP = 1;

function clampFontSize(size: number): number {
  return Math.min(Math.max(Math.round(size), MIN_FONT_SIZE), MAX_FONT_SIZE);
}

function resolveLanguageExtension(fileName?: string | null) {
  const ext = normalizeFileExtension(fileName?.split('.').pop());
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'json':
    case 'json5':
    case 'jsonc':
      return json();
    case 'md':
    case 'markdown':
      return markdown();
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'xml':
      return xml();
    case 'py':
      return python();
    default:
      return null;
  }
}

function resolveLanguageLabel(fileName?: string | null): string {
  const ext = normalizeFileExtension(fileName?.split('.').pop());
  const map: Record<string, string> = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX',
    ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TSX',
    json: 'JSON', json5: 'JSON5', jsonc: 'JSON',
    md: 'Markdown', markdown: 'Markdown',
    html: 'HTML', htm: 'HTML',
    css: 'CSS', scss: 'SCSS', less: 'Less',
    xml: 'XML', svg: 'SVG',
    py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust',
    java: 'Java', kt: 'Kotlin',
    c: 'C', cpp: 'C++', h: 'C', hpp: 'C++',
    sh: 'Shell', bash: 'Bash', zsh: 'Zsh',
    yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    ini: 'INI', cfg: 'Config', conf: 'Config',
    sql: 'SQL', csv: 'CSV', tsv: 'TSV',
    log: 'Log', txt: 'Text',
    srt: 'SRT', vtt: 'WebVTT', ass: 'ASS', ssa: 'SSA', lrc: 'LRC',
  };
  return map[ext] || 'Text';
}

const TextViewer: React.FC<TextViewerProps> = ({
  nodeId,
  url,
  fileName,
  active = true,
  reloadToken = 0,
}) => {
  const { resolvedTheme } = useTheme();
  const { reloadActiveTab, setFileUrl } = useFileViewer();
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
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (cancelled) return;
        loadedUrlRef.current = `${url}::${reloadToken}`;
        setContent(text);
        contentRef.current = text;
        setIsDirty(false);
      } catch (error: any) {
        runtimeLogger.error('文本文件加载失败:', error);
        if (!cancelled) setErrorMessage('文件加载失败');
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
          reloadActiveTab();
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
  }, [nodeId, isSaving, reloadToken, fileName, reloadActiveTab, setFileUrl]);

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

  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  useEffect(() => {
    const handler = (_event: any, direction: string) => {
      if (!active) return;
      if (direction === 'in') setFontSize((prev) => clampFontSize(prev + FONT_SIZE_STEP));
      else if (direction === 'out') setFontSize((prev) => clampFontSize(prev - FONT_SIZE_STEP));
      else if (direction === 'reset') setFontSize(DEFAULT_FONT_SIZE);
    };
    window.ipcRenderer?.on('app:zoom-shortcut', handler);
    return () => { window.ipcRenderer?.off('app:zoom-shortcut', handler); };
  }, [active]);

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

  const langExtension = useMemo(() => resolveLanguageExtension(fileName), [fileName]);
  const langLabel = useMemo(() => resolveLanguageLabel(fileName), [fileName]);

  const extensions = useMemo(() => {
    const exts: any[] = [saveKeymap, fontTheme, wrapExtension];
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [saveKeymap, fontTheme, wrapExtension, langExtension]);

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
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              bracketMatching: true,
              closeBrackets: true,
              indentOnInput: true,
            }}
          />
        </div>
      )}

      <div className="viewer-footer">
        <div className="footer-title-group">
          <span className="title-badge">{langLabel}</span>
          <span className="title" title={fileName || '文本预览'}>
            {fileName || '文本预览'}
          </span>
          {isDirty ? <span className="dirty-dot" title="未保存的更改" /> : null}
        </div>

        <div className="footer-controls">
          <Button
            size="small"
            icon={<IconMinus />}
            theme="borderless"
            onClick={() => setFontSize((prev) => clampFontSize(prev - FONT_SIZE_STEP))}
            disabled={fontSize <= MIN_FONT_SIZE}
          />
          <span className="meta-text zoom-text">{fontSize}px</span>
          <Button
            size="small"
            icon={<IconPlus />}
            theme="borderless"
            onClick={() => setFontSize((prev) => clampFontSize(prev + FONT_SIZE_STEP))}
            disabled={fontSize >= MAX_FONT_SIZE}
          />
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
          <Button
            size="small"
            theme="solid"
            className="save-btn"
            disabled={!isDirty || isSaving}
            loading={isSaving}
            onClick={handleSave}
          >
            保存
          </Button>
          <Button
            size="small"
            theme="light"
            className="save-btn"
            disabled={isSaving}
            onClick={handleSaveAs}
          >
            另存为
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="action-link"
            download={fileName || undefined}
          >
            下载
          </a>
        </div>
      </div>
    </TextViewerWrapper>
  );
};

export default TextViewer;

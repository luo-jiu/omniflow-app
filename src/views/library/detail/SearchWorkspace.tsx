import React from 'react';
import styled from 'styled-components';
import { IconApps, IconGlobeStroke } from '@douyinfe/semi-icons';

export type SearchWorkspaceMode = 'files' | 'web';

type SearchWorkspaceProps = {
  actionLabel?: string;
  description?: React.ReactNode;
  mode: SearchWorkspaceMode;
  onModeChange: (mode: SearchWorkspaceMode) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  title?: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
};

const SearchWorkspaceRoot = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
  background: var(--app-bg);

  .search-workspace-panel {
    width: min(720px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .search-workspace-header {
    width: 100%;
    min-height: 112px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 16px;
    text-align: center;
  }

  .search-workspace-title {
    margin: 0;
    color: var(--app-text);
    font-size: 32px;
    font-weight: 700;
    line-height: 1.1;
  }

  .search-workspace-description {
    color: var(--app-text-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  .search-workspace-form {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }

  .search-workspace-mode-btn {
    height: 40px;
    min-width: 120px;
    border: none;
    border-radius: 999px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
  }

  .search-workspace-mode-btn.files {
    background: color-mix(in srgb, #2f6fed 14%, var(--app-bg-elevated));
    color: color-mix(in srgb, #2f6fed 88%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #2f6fed 28%, transparent);
  }

  .search-workspace-mode-btn.web {
    background: color-mix(in srgb, #1f9d63 16%, var(--app-bg-elevated));
    color: color-mix(in srgb, #1f9d63 86%, var(--app-text));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #1f9d63 30%, transparent);
  }

  .search-workspace-mode-btn:hover {
    color: var(--app-text);
  }

  .search-workspace-mode-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .search-workspace-mode-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    opacity: 1;
  }

  .search-workspace-input {
    width: 100%;
    height: 48px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 14px;
    outline: none;
    font-size: 14px;
  }

  .search-workspace-input:focus {
    border-color: var(--semi-color-primary);
  }

  .search-workspace-submit {
    height: 40px;
    border-radius: 8px;
    border: none;
    background: var(--semi-color-primary);
    color: #fff;
    padding: 0 18px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .search-workspace-below {
    width: 100%;
    min-height: 240px;
    margin-top: 20px;
  }

  .search-workspace-file-tips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    width: min(600px, 100%);
    margin: 0 auto;
  }

  .search-workspace-file-tip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: 8px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
    text-align: left;
  }

  .search-workspace-file-tip-label {
    color: var(--app-text);
    font-size: 14px;
    font-weight: 500;
  }

  .search-workspace-file-tip-text {
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }
`;

export default function SearchWorkspace({
  actionLabel = '进入',
  description,
  mode,
  onModeChange,
  onSubmit,
  placeholder = '输入关键词',
  title,
  value,
  onValueChange,
}: SearchWorkspaceProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const switchMode = React.useCallback(() => {
    onModeChange(mode === 'files' ? 'web' : 'files');
  }, [mode, onModeChange]);
  const isFilesMode = mode === 'files';
  const heading = isFilesMode ? '选择左侧文件开始预览' : title;
  const subheading = isFilesMode ? null : description;

  React.useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [mode]);

  return (
    <SearchWorkspaceRoot>
      <div className="search-workspace-panel">
        <div className="search-workspace-header">
          {heading ? (
            <h1 className="search-workspace-title">{heading}</h1>
          ) : null}
          {subheading ? (
            <div className="search-workspace-description">{subheading}</div>
          ) : null}
        </div>
        <form
          className="search-workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(value);
          }}
        >
          <button
            type="button"
            className={`search-workspace-mode-btn ${isFilesMode ? 'files' : 'web'}`}
            onClick={switchMode}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                switchMode();
              }
            }}
            aria-label="切换搜索模式"
            title="切换模式"
          >
            <span className="search-workspace-mode-label">
              {isFilesMode ? <IconApps /> : <IconGlobeStroke />}
              {isFilesMode ? '文件' : '网页'}
            </span>
            <span className="search-workspace-mode-switch">⇄</span>
          </button>
          <input
            ref={inputRef}
            className="search-workspace-input"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
          />
          <button type="submit" className="search-workspace-submit">
            {actionLabel}
          </button>
        </form>
        <div className="search-workspace-below">
          {mode === 'files' ? (
            <div className="search-workspace-file-tips">
              <div className="search-workspace-file-tip">
                <span className="search-workspace-file-tip-label">双击</span>
                <span className="search-workspace-file-tip-text">展开目录或打开文件</span>
              </div>
              <div className="search-workspace-file-tip">
                <span className="search-workspace-file-tip-label">右键</span>
                <span className="search-workspace-file-tip-text">新建、重命名、删除节点</span>
              </div>
              <div className="search-workspace-file-tip">
                <span className="search-workspace-file-tip-label">拖拽</span>
                <span className="search-workspace-file-tip-text">把文件直接拖到目录里上传</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SearchWorkspaceRoot>
  );
}

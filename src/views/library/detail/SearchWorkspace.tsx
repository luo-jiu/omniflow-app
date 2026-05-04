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
  padding: 16px;
  overflow: auto;
  background: var(--app-bg);

  .search-workspace-panel {
    width: min(460px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .search-workspace-header {
    width: 100%;
    min-height: 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-bottom: 10px;
    text-align: center;
  }

  .search-workspace-title {
    margin: 0;
    color: var(--app-text);
    font-size: 28px;
    font-weight: 700;
    line-height: 1.1;
  }

  .search-workspace-description {
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.55;
  }

  .search-workspace-form {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
  }

  .search-workspace-mode-btn {
    height: 30px;
    min-width: 82px;
    border: none;
    border-radius: 999px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    cursor: pointer;
    font-size: 10px;
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
    gap: 5px;
  }

  .search-workspace-mode-icon {
    width: 13px;
    height: 13px;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .search-workspace-mode-icon .mode-icon {
    position: absolute;
    inset: 0;
    margin: auto;
    font-size: 13px;
    transition: transform 180ms ease, opacity 180ms ease;
    opacity: 0;
    transform: scale(0.74) rotate(-18deg);
  }

  .search-workspace-mode-icon .mode-icon.active {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  .search-workspace-mode-btn.web .search-workspace-mode-icon .mode-icon.active {
    transform: scale(1) rotate(-12deg);
  }

  .search-workspace-mode-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 13px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    opacity: 0.92;
    transition: transform 180ms ease, opacity 180ms ease;
  }

  .search-workspace-mode-btn.files .search-workspace-mode-switch {
    transform: rotate(0deg);
  }

  .search-workspace-mode-btn.web .search-workspace-mode-switch {
    transform: rotate(180deg);
  }

  .search-workspace-mode-btn:hover .search-workspace-mode-switch {
    opacity: 1;
  }

  .search-workspace-input {
    width: 100%;
    height: 34px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: var(--app-bg-elevated);
    color: var(--app-text);
    padding: 0 10px;
    outline: none;
    font-size: 12px;
  }

  .search-workspace-input:focus {
    border-color: var(--semi-color-primary);
  }

  .search-workspace-submit {
    height: 30px;
    border-radius: 6px;
    border: none;
    background: var(--semi-color-primary);
    color: #fff;
    padding: 0 12px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
  }

  .search-workspace-below {
    width: 100%;
    min-height: 112px;
    margin-top: 20px;
  }

  .search-workspace-file-tips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
    width: min(360px, 100%);
    margin: 0 auto;
  }

  .search-workspace-file-tip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px;
    border-radius: 6px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
    text-align: left;
  }

  .search-workspace-file-tip-label {
    color: var(--app-text);
    font-size: 10px;
    font-weight: 500;
  }

  .search-workspace-file-tip-text {
    color: var(--app-text-muted);
    font-size: 10px;
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
  const heading = isFilesMode ? '从左侧打开文件' : title;
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
              <span className="search-workspace-mode-icon" aria-hidden>
                <IconApps className={`mode-icon ${isFilesMode ? 'active' : ''}`} />
                <IconGlobeStroke className={`mode-icon ${isFilesMode ? '' : 'active'}`} />
              </span>
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

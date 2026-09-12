import styled, { createGlobalStyle } from 'styled-components';
import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

export const TextViewerSaveAsModalStyle = createGlobalStyle`
  .text-viewer-save-as-modal {
    width: min(380px, calc(100vw - 32px)) !important;
  }

  .text-viewer-save-as-modal .semi-modal-content {
    overflow: hidden;
    padding: 0 !important;
    border: 1px solid var(--app-border-strong);
    border-radius: var(--app-radius-medium);
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .text-viewer-save-as-modal .semi-modal-header {
    margin: 0;
    padding: 14px 16px 8px !important;
  }

  .text-viewer-save-as-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .text-viewer-save-as-modal .semi-modal-close {
    top: 13px;
    right: 14px;
    color: var(--app-text-muted);
  }

  .text-viewer-save-as-modal .semi-modal-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .text-viewer-save-as-modal .semi-modal-body {
    padding: 2px 16px 16px !important;
  }

  .text-viewer-save-as-modal .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .text-viewer-save-as-modal .semi-modal-footer .semi-button {
    height: 28px;
    min-width: 56px;
    margin: 0;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
`;

export const TextViewerSaveAsContent = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;

  .save-as-label {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .semi-input-wrapper {
    min-height: 30px;
    height: 30px;
    border-radius: 6px;
    border-color: var(--app-border-strong);
    background: var(--semi-color-bg-1);
  }

  .semi-input {
    font-size: 12px;
  }
`;

export const TextViewerWrapper = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--semi-color-bg-0);

  .editor-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .markdown-stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 24px 32px 40px;
    color: var(--app-text);
    line-height: 1.7;
    font-size: 15px;
    ${workspaceScrollbarStyles}
    h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 .5em; line-height: 1.3; }
    h1 { font-size: 26px; } h2 { font-size: 22px; } h3 { font-size: 18px; }
    p { margin: .75em 0; }
    ul, ol { padding-left: 28px; }
    blockquote { margin: 1em 0; padding: 4px 16px; border-left: 3px solid var(--app-accent); color: var(--app-text-secondary); }
    code { padding: 2px 5px; border-radius: 4px; background: var(--app-bg-elevated); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
    pre { padding: 14px 16px; overflow: auto; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-bg-elevated); }
    pre code { padding: 0; background: transparent; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 7px 10px; border: 1px solid var(--app-border); text-align: left; }
    img { max-width: 100%; height: auto; }
    a { color: var(--app-accent); }
    hr { border: 0; border-top: 1px solid var(--app-border); }
  }

  .editor-stage > div {
    flex: 1;
    min-height: 0;
  }

  .editor-stage .cm-editor {
    height: 100%;
    font-family: 'JetBrains Mono', monospace;
    font-size: 15px;
    line-height: 1.65;
  }

  .editor-stage .cm-editor .cm-scroller {
    overflow: auto !important;
    padding: 12px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .editor-stage .cm-editor .cm-scroller::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .editor-stage .cm-editor .cm-scroller::-webkit-scrollbar-track,
  .editor-stage .cm-editor .cm-scroller::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  .editor-stage .cm-editor .cm-scroller::-webkit-scrollbar-thumb {
    min-width: 28px;
    min-height: 28px;
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--app-scrollbar-thumb);
    background-clip: padding-box;
  }

  .editor-stage .cm-editor .cm-scroller::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
    background-clip: padding-box;
  }

  .editor-stage .cm-editor .cm-gutters {
    border-right: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
  }

  .editor-stage .cm-editor.cm-focused {
    outline: none;
  }

  .loading-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    pointer-events: none;
  }

  .state-error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: var(--semi-color-danger);
  }

  .viewer-footer {
    height: 46px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border-top: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-1);
  }

  .footer-title-group {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .title-badge {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-primary) 15%, transparent);
    color: var(--semi-color-primary);
    border: 1px solid color-mix(in srgb, var(--semi-color-primary) 34%, transparent);
    font-weight: 600;
    letter-spacing: 0;
  }

  .title {
    min-width: 0;
    font-size: 13px;
    color: var(--semi-color-text-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--semi-color-warning);
  }

  .footer-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .status-item {
    min-width: 0;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 7px;
    font-size: 12px;
    color: var(--semi-color-text-2);
    user-select: none;
    font-variant-numeric: tabular-nums;
  }

  .cursor-position {
    min-width: 48px;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .markdown-mode-toggle { width: 28px; height: 28px; margin-right: 8px; padding: 0; color: var(--app-text-muted); }
  .markdown-mode-toggle:hover { color: var(--app-text); }
  .markdown-mode-toggle.is-rendered { color: var(--app-accent); }
  .markdown-mode-toggle.is-source { color: var(--app-text-secondary); }
  .markdown-mode-toggle svg { display: block; width: 16px; height: 16px; }

  .icon-action-btn {
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    border: 0;
    border-radius: var(--app-radius-medium);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--app-text-muted);
    background: transparent;
    box-shadow: none;
    transition: color 120ms ease, background-color 120ms ease;
  }

  .icon-action-btn .semi-icon,
  .icon-action-btn svg,
  .icon-action-btn .semi-button-content {
    width: 15px;
    height: 15px;
  }

  .icon-action-btn:not(.semi-button-disabled):hover,
  .icon-action-btn:not(.semi-button-disabled):focus-visible {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 9%, transparent);
    box-shadow: none;
  }

  .icon-action-btn.semi-button-disabled {
    background: transparent;
  }
`;

import styled from 'styled-components';

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
    letter-spacing: 0.03em;
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

  .meta-text {
    font-size: 12px;
    color: var(--semi-color-text-2);
    user-select: none;
  }

  .zoom-text {
    min-width: 38px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .wrap-toggle {
    all: unset;
    font-size: 12px;
    line-height: 1;
    padding: 4px 10px;
    margin-left: 6px;
    border-radius: 6px;
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-2);
    cursor: pointer;
    user-select: none;
    transition: color 0.15s, border-color 0.15s, background 0.15s;

    &:hover {
      color: var(--semi-color-primary);
      border-color: var(--semi-color-primary);
    }

    &.is-active {
      color: var(--semi-color-primary);
      border-color: var(--semi-color-primary);
      background: color-mix(in srgb, var(--semi-color-primary) 12%, transparent);
    }
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .save-btn {
    min-height: 30px;
    font-size: 13px;
    padding: 0 14px;
    border-radius: 6px;
  }

  .action-link {
    font-size: 12px;
    color: var(--semi-color-text-1);
    text-decoration: none;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--semi-color-border);

    &:hover {
      color: var(--semi-color-primary);
      border-color: var(--semi-color-primary);
      background: var(--semi-color-primary-light-default);
    }
  }
`;

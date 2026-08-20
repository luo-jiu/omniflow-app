import { createGlobalStyle } from 'styled-components';
import styled from 'styled-components';

import { workspaceScrollbarStyles } from '@/components/ui/workspace-scrollbar';

export const AIServiceWorkspaceShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--app-text);

  .ai-service-header {
    min-height: 58px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--app-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .ai-service-heading {
    min-width: 0;
  }

  .ai-service-title {
    margin: 0;
    font-size: 17px;
    line-height: 1.3;
    font-weight: 700;
  }

  .ai-service-description {
    margin-top: 3px;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.45;
  }

  .ai-service-add {
    flex: none;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border-radius: 50%;
  }

  .ai-service-add svg {
    width: 16px;
    height: 16px;
  }

  .ai-service-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    ${workspaceScrollbarStyles}
    padding: 14px 16px 18px;
  }

  .ai-service-loading,
  .ai-service-empty {
    min-height: 210px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .ai-service-empty-icon {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-bg-elevated);
    color: var(--app-text-muted);
  }

  .ai-service-empty-icon .ai-service-glyph {
    font-size: 13px;
  }

  .ai-service-empty-title {
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  .ai-service-list {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-service-row {
    min-height: 74px;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 11px 12px;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: color-mix(in srgb, var(--app-bg-elevated) 94%, transparent);
  }

  .ai-service-row.is-active {
    border-color: color-mix(in srgb, var(--semi-color-primary) 70%, var(--app-border));
    background: color-mix(in srgb, var(--semi-color-primary-light-default) 55%, var(--app-bg-elevated));
  }

  .ai-service-row.is-dragging {
    position: relative;
    z-index: 1;
    opacity: 0.88;
    box-shadow: var(--app-shadow);
  }

  .ai-service-avatar {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--app-radius-small);
    background: var(--semi-color-fill-0);
    color: var(--semi-color-primary);
    cursor: grab;
    touch-action: none;
    outline: none;
  }

  .ai-service-avatar:active {
    cursor: grabbing;
  }

  .ai-service-avatar:focus-visible {
    box-shadow: 0 0 0 2px var(--semi-color-focus-border);
  }

  .ai-service-avatar .ai-service-provider-icon {
    width: 20px;
    height: 20px;
  }

  .ai-service-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: currentColor;
    font-family: Arial, sans-serif;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0;
  }

  .ai-service-main {
    min-width: 0;
  }

  .ai-service-name-line {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .ai-service-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 650;
  }

  .ai-service-active-mark {
    flex: none;
    border-radius: 4px;
    font-size: 10px;
    line-height: 20px;
    padding: 0 6px;
  }

  .ai-service-active-mark {
    background: var(--semi-color-primary-light-default);
    color: var(--semi-color-primary);
    font-weight: 700;
  }

  .ai-service-meta {
    margin-top: 5px;
    min-width: 0;
    display: flex;
    align-items: center;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .ai-service-url {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ai-service-actions {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .ai-service-activate {
    height: 28px;
    min-height: 28px;
    padding: 0 10px;
    border-radius: var(--app-radius-large);
    font-size: 12px;
    font-weight: 600;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  .ai-service-icon-action {
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    padding: 0;
    border-radius: var(--app-radius-medium);
    color: var(--app-text-muted);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  .ai-service-row:hover .ai-service-icon-action,
  .ai-service-row:focus-within .ai-service-icon-action,
  .ai-service-row:hover .ai-service-activate,
  .ai-service-row:focus-within .ai-service-activate {
    opacity: 1;
    pointer-events: auto;
  }

  .ai-service-icon-action:hover {
    color: var(--app-text);
  }

  .ai-service-icon-action.is-danger:hover {
    color: var(--semi-color-danger);
  }

  .ai-service-icon-action svg {
    width: 15px;
    height: 15px;
  }

  .ai-service-editor {
    width: 100%;
    padding: 4px 2px 20px;
  }

  .ai-service-editor-title {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 650;
  }

  .ai-service-form {
    margin-top: 16px;
    display: grid;
    gap: 12px;
  }

  .ai-service-form-field {
    min-width: 0;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
  }

  .ai-service-form-label {
    padding-top: 8px;
    color: var(--app-text);
    font-size: 11px;
    line-height: 16px;
    font-weight: 600;
  }

  .ai-service-form .semi-input-wrapper,
  .ai-service-form .semi-select {
    width: 100%;
    min-height: 34px;
    border-radius: 6px;
  }

  .ai-service-form .semi-input,
  .ai-service-form .semi-select-selection-text {
    font-size: 12px;
  }

  .ai-service-key-visibility {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .ai-service-key-visibility:hover,
  .ai-service-key-visibility:focus-visible {
    background: var(--semi-color-fill-1);
    color: var(--app-text);
  }

  .ai-service-key-visibility:focus-visible {
    outline: 2px solid var(--semi-color-primary-light-active);
    outline-offset: 0;
  }

  .ai-service-key-visibility:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .ai-service-key-visibility svg {
    width: 15px;
    height: 15px;
  }

  .ai-service-editor-actions {
    margin-top: 18px;
    padding-left: 72px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .ai-service-editor-actions .semi-button {
    min-width: 64px;
    min-height: 30px;
    border-radius: 6px;
    font-size: 11px;
  }

  @media (max-width: 680px) {
    .ai-service-form-field {
      grid-template-columns: minmax(0, 1fr);
      gap: 5px;
    }

    .ai-service-form-label {
      padding-top: 0;
    }

    .ai-service-editor-actions {
      padding-left: 0;
    }
  }
`;

export const AIServiceGlobalStyle = createGlobalStyle`
  .ai-service-provider-label {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .ai-service-provider-icon {
    flex: none;
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  body[theme-mode="dark"] .ai-service-provider-icon.is-monochrome {
    filter: invert(1);
    opacity: 0.88;
  }
`;

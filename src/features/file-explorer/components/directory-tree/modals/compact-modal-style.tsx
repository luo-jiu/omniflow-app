import { createGlobalStyle } from 'styled-components';

export const DirectoryTreeCompactModalStyle = createGlobalStyle`
  .directory-tree-compact-modal .semi-modal-content {
    overflow: hidden;
    border: 1px solid var(--app-border-strong);
    border-radius: 10px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .directory-tree-compact-modal .semi-modal-header {
    margin: 0;
    padding: 14px 16px 8px !important;
  }

  .directory-tree-compact-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .directory-tree-compact-modal .semi-modal-close {
    top: 13px;
    right: 14px;
    color: var(--app-text-muted);
  }

  .directory-tree-compact-modal .semi-modal-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent);
  }

  .directory-tree-compact-modal .semi-modal-body {
    padding: 0 16px 14px !important;
  }

  .directory-tree-compact-modal .semi-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 0;
    padding: 0 16px 16px !important;
  }

  .directory-tree-compact-modal .semi-button {
    height: 28px;
    min-width: 56px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .directory-tree-create-modal {
    width: 360px !important;
  }

  .directory-tree-create-modal .semi-modal-content {
    width: 360px;
  }

  .directory-tree-create-modal .semi-modal-body {
    padding-top: 2px !important;
  }

  .directory-tree-create-modal .semi-input-wrapper {
    width: 100%;
    height: 30px;
    min-height: 30px;
  }

  .directory-tree-compact-modal .semi-input,
  .directory-tree-compact-modal .semi-input-default {
    font-size: 12px;
  }

  .directory-tree-compact-modal .semi-input-wrapper {
    min-height: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--semi-color-bg-1);
    border-color: var(--app-border-strong);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  .directory-tree-compact-modal .semi-input-wrapper:hover {
    border-color: var(--semi-color-primary);
  }

  .directory-tree-compact-modal .semi-input-wrapper-focus,
  .directory-tree-compact-modal .semi-input-wrapper:focus-within {
    border-color: var(--semi-color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--semi-color-primary) 18%, transparent);
  }
`;

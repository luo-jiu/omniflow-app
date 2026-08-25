import { createGlobalStyle } from 'styled-components';

export const DirectoryTreeCompactModalStyle = createGlobalStyle`
  .directory-tree-compact-modal .semi-modal-content {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--app-border-strong);
    border-radius: 10px;
    background: var(--app-bg-elevated);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), var(--app-shadow);
  }

  .directory-tree-compact-modal .semi-modal-header {
    min-height: 50px;
    margin: 0;
    padding: 14px 44px 8px 16px !important;
  }

  .directory-tree-compact-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.35;
    font-weight: 700;
  }

  .directory-tree-compact-modal .semi-modal-close {
    position: absolute !important;
    top: 9px !important;
    right: 10px !important;
    display: inline-flex !important;
    width: 24px !important;
    min-width: 24px !important;
    height: 24px !important;
    align-items: center;
    justify-content: center;
    padding: 0 !important;
    border-radius: var(--app-radius-medium, 10px) !important;
    background: transparent !important;
    color: var(--app-text-muted);
    line-height: 1;
  }

  .directory-tree-compact-modal .semi-modal-close:hover {
    color: var(--app-text);
    background: color-mix(in srgb, var(--app-text) 8%, transparent) !important;
  }

  .directory-tree-compact-modal .semi-modal-close .semi-icon {
    display: inline-flex;
    width: 12px;
    height: 12px;
    align-items: center;
    justify-content: center;
    font-size: 12px;
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

  .directory-tree-compact-modal .semi-modal-footer .semi-button {
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

  .directory-tree-upload-modal .semi-modal-header {
    min-height: 44px;
    padding: 14px 44px 8px 18px !important;
  }

  .directory-tree-upload-modal .semi-modal-content {
    padding-right: 0;
    padding-left: 0;
  }

  .directory-tree-upload-modal .semi-modal-title {
    font-size: 18px;
    line-height: 1.25;
  }

  .directory-tree-upload-modal .semi-modal-body {
    padding-right: 18px !important;
    padding-bottom: 10px !important;
    padding-left: 18px !important;
  }

  .directory-tree-upload-modal .semi-modal-footer {
    padding-right: 18px !important;
    padding-bottom: 12px !important;
    padding-left: 18px !important;
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

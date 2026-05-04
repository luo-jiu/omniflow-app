import styled from 'styled-components'

export const DirectorySidebarWrapper = styled.aside<{ $isDragging?: boolean }>`
  position: relative;
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 0;
  background: transparent;
  border: none;

  .sidebar-container {
    background: transparent;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .repository-selector {
    padding: 7px 8px;
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }

  .tree-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
    padding: 3px 1px 7px 1px;
    overscroll-behavior: contain;
    font-size: 13px;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }

  .tree-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .tree-container::-webkit-scrollbar-track {
    background: var(--app-scrollbar-track);
  }

  .tree-container::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .tree-container:hover,
  .tree-container:focus-within,
  .tree-container:active {
    scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);
  }

  .tree-container:hover::-webkit-scrollbar-thumb,
  .tree-container:focus-within::-webkit-scrollbar-thumb,
  .tree-container:active::-webkit-scrollbar-thumb {
    background: var(--app-scrollbar-thumb);
  }

  .tree-container::-webkit-scrollbar-thumb:hover {
    background: var(--app-scrollbar-thumb-hover);
  }

  .tree-container::-webkit-scrollbar-corner {
    background: var(--app-scrollbar-track);
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    z-index: 12;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    left: -4px;
    right: -4px;
    top: 0;
    bottom: 0;
    cursor: col-resize;
  }
  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .custom-tree-wrapper {
    display: block;
    min-width: max-content;
    width: auto;
    font-size: 13px;
  }

  /* 全局覆盖 Semi Tree 的字体大小 */
  .custom-tree,
  .custom-tree * {
    font-size: 13px !important;
  }

  .custom-tree {
    user-select: none;

    .semi-tree-option-list .semi-tree-option {
      box-sizing: border-box;
      min-height: 20px;
      padding: 1px 3px;
      border-radius: 6px;
      font-size: 13px !important;
      line-height: 17px !important;
      color: var(--app-text-secondary);
    }
  }

  /* 压缩 Semi Tree 内部左侧间距 */
  .custom-tree .semi-tree-option-list {
    padding-left: 0 !important;
  }

  .custom-tree .semi-tree-option {
    padding-left: 2px !important;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      border-radius 120ms ease;
  }

    .semi-tree-option:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--app-text);
    }

    .semi-tree-option.tree-row-selected,
    .semi-tree-option.tree-row-selected:hover {
      background: color-mix(in srgb, var(--semi-color-primary-light-default) 92%, transparent);
      color: var(--app-text);
    }

    .semi-tree-option.tree-row-selected-single {
      border-radius: 6px;
    }

    .semi-tree-option.tree-row-selected-start {
      border-radius: 6px 6px 2px 2px;
    }

    .semi-tree-option.tree-row-selected-middle {
      border-radius: 2px;
    }

    .semi-tree-option.tree-row-selected-end {
      border-radius: 2px 2px 6px 6px;
    }

    .semi-tree-option-selected,
    .semi-tree-option-selected:hover {
      background: transparent;
      color: inherit;
    }

    .semi-tree-option-label,
    .semi-tree-option-label-text {
      font-size: 13px !important;
    }

    .semi-tree-option-label {
      width: 100%;
      min-width: 0;
      flex: 1;
    }

    .semi-tree-option-label .semi-icon,
    .semi-tree-option-icon {
      font-size: 14px !important;
      margin-right: 3px;
      color: var(--app-text-muted);
    }

    .semi-tree-option-expand-icon {
      font-size: 13px !important;
      color: var(--app-text-muted);
      padding: 4px;
      margin: -4px 0 -4px 0;
      border-radius: 4px;
      cursor: pointer;
    }

    .semi-tree-option-expand-icon:hover {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .custom-tree .semi-input {
    font-size: 13px;
    line-height: 17px;
  }

  .custom-tree .semi-input-wrapper {
    height: 24px;
    border-radius: 6px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
  }

  .tree-node-label {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    gap: 5px;
    padding-right: 4px;
  }

  .tree-node-label.drag-over {
    background: rgba(52, 88, 71, 0.06);
    outline: 1px dashed var(--app-accent);
    border-radius: 4px;
  }

  .tree-node-text {
    display: inline-block;
    flex: 0 0 auto;
    white-space: nowrap;
    overflow: visible;
    text-overflow: initial;
    color: inherit;
    font-size: 13px !important;
    line-height: 17px;
  }

  .tree-node-text-archive {
    color: color-mix(in srgb, var(--semi-color-success) 78%, var(--app-text) 22%);
    font-weight: 600;
  }

  .tree-file-type-icon {
    width: 15px;
    height: 15px;
    display: block;
    object-fit: contain;
    margin-right: 2px;
    box-sizing: border-box;
    flex: 0 0 15px;
  }

  .tree-file-type-icon-audio-subtitles {
    margin-right: 2px;
    flex: 0 0 15px;
    overflow: visible;
    transform: scale(0.75);
    transform-origin: center;
  }

  /* Normalize perceptual size for built-in folder icons. */
  .tree-file-type-icon-comic-folder {
    padding: 0.5px;
  }

  .tree-file-type-icon-asmr-folder {
    padding: 1px;
  }

  .tree-built-in-type-icon {
    width: 13px;
    height: 13px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 600;
    line-height: 1;
  }

  .tree-built-in-type-icon-comic {
    color: #8a4b00;
    background: #ffe9c4;
    border: 1px solid #ffcf8b;
  }

  .tree-built-in-type-icon-unknown {
    color: #8b1f1f;
    background: #ffd8d8;
    border: 1px solid #ffb7b7;
  }

`;

export default DirectorySidebarWrapper;

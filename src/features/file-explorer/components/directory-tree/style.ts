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
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }

  .tree-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
    padding: 4px 6px 10px 2px;
    scrollbar-gutter: stable both-edges;
    overscroll-behavior: contain;
    font-size: 19px;
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
    font-size: 19px;
  }

  /* 全局覆盖 Semi Tree 的字体大小 */
  .custom-tree,
  .custom-tree * {
    font-size: 19px !important;
  }

  .custom-tree {
    user-select: none;

    .semi-tree-option-list .semi-tree-option {
      box-sizing: border-box;
      min-height: 34px;
      padding: 3px 6px;
      border-radius: 8px;
      font-size: 19px !important;
      line-height: 28px !important;
      color: var(--app-text-secondary);
    }
  }

  /* 压缩 Semi Tree 内部左侧间距 */
  .custom-tree .semi-tree-option-list {
    padding-left: 0 !important;
  }

  .custom-tree .semi-tree-option {
    padding-left: 4px !important;
  }

  .custom-tree .semi-tree-indent {
    width: 16px !important;
  }

    .semi-tree-option:hover {
      background: rgba(0, 0, 0, 0.04);
      color: var(--app-text);
    }

    .semi-tree-option-selected,
    .semi-tree-option-selected:hover {
      background: rgba(0, 0, 0, 0.06);
      color: var(--app-text);
    }

    .semi-tree-option-label,
    .semi-tree-option-label-text {
      font-size: 19px !important;
    }

    .semi-tree-option-label .semi-icon,
    .semi-tree-option-icon {
      font-size: 22px !important;
      margin-right: 8px;
      color: var(--app-text-muted);
    }

    .semi-tree-option-expand-icon {
      font-size: 22px !important;
      color: var(--app-text-muted);
      padding: 6px;
      margin: -6px 2px -6px -6px;
      border-radius: 6px;
      cursor: pointer;
    }

    .semi-tree-option-expand-icon:hover {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .custom-tree .semi-input {
    font-size: 19px;
    line-height: 28px;
  }

  .custom-tree .semi-input-wrapper {
    height: 38px;
    border-radius: 8px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
  }

  .tree-node-label {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    gap: 6px;
    padding-right: 8px;
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
    font-size: 19px !important;
    line-height: 28px;
  }

  .tree-file-type-icon {
    width: 20px;
    height: 20px;
    display: block;
    object-fit: contain;
  }

  .tree-container::-webkit-scrollbar {
    height: 6px;
    width: 6px;
  }
  .tree-container::-webkit-scrollbar-track {
    background: transparent;
  }
  .tree-container::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
    border-radius: 10px;
    min-height: 20px;
    min-width: 20px;
  }
  .tree-container::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.2);
  }
  .tree-container::-webkit-scrollbar-corner {
    background: transparent;
  }

  .tree-container {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.12) transparent;
  }

  /* 覆盖所有内部可能出现的滚动条 */
  *::-webkit-scrollbar {
    height: 6px;
    width: 6px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
    border-radius: 10px;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.2);
  }
  *::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

export default DirectorySidebarWrapper;

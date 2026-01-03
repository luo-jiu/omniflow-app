import styled from 'styled-components'

export const DirectorySidebarWrapper = styled.aside<{ $isDragging?: boolean }>`
  position: relative;
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;

  /* 侧边栏容器 */
  .sidebar-container {
    background: var(--semi-color-bg-0);
    border-right: 1px solid var(--semi-color-border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* 仓库选择器区域 */
  .repository-selector {
    padding: 8px;
    border-bottom: 1px solid var(--semi-color-border);
    flex-shrink: 0;
  }

  /* 树容器区域：横/纵滚动条；横向仅在“有遮挡”时出现（auto） */
  .tree-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;                 /* 仅在需要时出现 */
    position: relative;
    scrollbar-gutter: stable both-edges; /* 预留轨道空间，避免布局抖动 */
    overscroll-behavior: contain;
  }

  /* 可选：侧栏 resize handle */
  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 10px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    z-index: 12;
  }
  .resize-handle::after {
    content: "";
    position: absolute;
    left: -6px;
    right: -6px;
    top: 0;
    bottom: 0;
    cursor: col-resize;
  }
  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  /* wrapper 的 min-width 将由 JS 动态设置为“视口内最大被遮挡右缘 + 冗余” */
  .custom-tree-wrapper {
    display: block;
    min-width: max-content; /* 初值为内容宽，随 JS 覆盖为像素值 */
    width: auto;
  }

  .custom-tree {
    user-select: none;

    .semi-tree-option-list .semi-tree-option {
      box-sizing: border-box;
      font-size: 22px !important;
      line-height: 32px !important;
      padding: 4px 8px;
    }

    .semi-tree-option-label .semi-icon {
      font-size: 20px !important;
      margin-right: 8px;
    }
  }

  .custom-tree .semi-input {
    font-size: 22px;
    line-height: 32px;
  }

  .custom-tree .semi-input-wrapper {
    height: 36px;
  }

  /* 行 label：inline-flex 以内容宽驱动，利于横向滚动 */
  .tree-node-label {
    display: inline-flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding-right: 8px;
  }

  /* 外部文件拖拽悬停高亮 */
  .tree-node-label.drag-over {
    background: var(--semi-color-fill-1);
    outline: 1px dashed var(--semi-color-primary);
    border-radius: 6px;
  }

  /* 文字块使用 inline-block，scrollWidth 更稳定 */
  .tree-node-text {
    display: inline-block;
    flex: 0 0 auto;
    white-space: nowrap;
    overflow: visible;
    text-overflow: initial;
  }

  /* 滚动条更易命中（Chromium/Electron） */
  .tree-container::-webkit-scrollbar {
    height: 24px;   /* 横向滚动条厚度 */
    width: 16px;    /* 纵向滚动条厚度 */
  }
  .tree-container::-webkit-scrollbar-track {
    background: var(--semi-color-fill-0);
    border-radius: 10px;
  }
  .tree-container::-webkit-scrollbar-thumb {
    background: var(--semi-color-fill-2);
    border-radius: 10px;
    min-height: 44px;
    min-width: 44px;
  }
  .tree-container::-webkit-scrollbar-thumb:hover,
  .tree-container::-webkit-scrollbar-thumb:active,
  .tree-container::-webkit-scrollbar-thumb:focus {
    background: var(--semi-color-fill-2);
  }

  /* Firefox 兜底 */
  .tree-container {
    scrollbar-width: auto;
  }
`;

export default DirectorySidebarWrapper;

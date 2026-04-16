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
    background: transparent;
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

  /* 树容器区域：允许横向滚动 */
  .tree-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
  }

  /* 拖拽条 */
  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    z-index: 12; /* 比树略高，但不覆盖滚动条区域下的内容 */
    ${props => props.$isDragging && `
      background: rgba(0, 0, 255, 0.12);
    `}
  }

  .resize-handle:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  /* wrapper：宽度由 JS measure 控制（min-width 会被设置） */
  .custom-tree-wrapper {
    display: block;
    min-width: max-content; /* 初始值，运行时会被 measure() 更新为更合理的值 */
    width: auto;
  }

  /* Tree 内部样式 */
  .custom-tree {
    user-select: none;

    .semi-tree-option-list .semi-tree-option {
      box-sizing: border-box;
      font-size: 22px !important;
      line-height: 32px !important;
      padding: 4px 8px;
    }

    /* 保留 semi 的 icon 样式（文件夹/文件图标） */
    .semi-tree-option-label .semi-icon {
      font-size: 20px !important;
      margin-right: 8px;
    }
  }

  /* 我们把每一行的 label 设为 flex 布局（不使用绝对定位） */
  .tree-node-label {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0; /* 关键：允许子元素触发 ellipsis */
    box-sizing: border-box;
    padding-right: 8px; /* 给 + 留点空间 */
  }

  /* 文字：自动省略并且不会遮挡 + 号 */
  .tree-node-text {
    flex: 1 1 auto;
    min-width: 0; /* 关键：让 text-overflow 生效 */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 8px;
  }

  /* + 保留在流内，不绝对定位，避免覆盖滚动条 */
  .tree-node-plus {
    flex: 0 0 auto;
    margin-left: 6px;
    width: 18px;
    height: 18px;
    line-height: 18px;
    cursor: pointer;
    color: var(--semi-color-text-2);
    transition: color 0.16s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tree-node-plus:hover {
    color: var(--semi-color-primary);
  }

  /* 自定义滚动条（可选） */
  .tree-container::-webkit-scrollbar {
    height: 10px;
    width: 8px;
  }
  .tree-container::-webkit-scrollbar-track {
    background: var(--semi-color-fill-0);
    border-radius: 6px;
  }
  .tree-container::-webkit-scrollbar-thumb {
    background: var(--semi-color-fill-2);
    border-radius: 6px;
  }
  .tree-container::-webkit-scrollbar-thumb:hover {
    background: var(--semi-color-fill-3);
  }
`;
export default DirectorySidebarWrapper;
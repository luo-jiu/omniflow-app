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
        flex-shrink: 0; /* 不缩放 */
    }

    /* 树容器区域 */
    .tree-container {
        flex: 1; /* 占据剩余空间 */
        overflow-y: auto; /* 只有这里可以滚动 */
        overflow-x: hidden;
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
        z-index: 10;

        ${props => props.$isDragging && `
      background: rgba(0, 0, 255, 0.3);
    `}
    }

    .resize-handle:hover {
        background: rgba(0, 0, 0, 0.1);
    }

    /* Tree 样式 */
    .custom-tree {
        user-select: none;
        .semi-tree-option-list .semi-tree-option {
            font-size: 22px !important;
        }
        .semi-tree-option-label .semi-icon {
            font-size: 25px !important;
        }
    }
`;

export default DirectorySidebarWrapper;
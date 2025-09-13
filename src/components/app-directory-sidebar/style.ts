import styled from 'styled-components'

export const DirectorySidebarWrapper = styled.aside`
  display: flex;
  flex-direction: row; /* 改成水平布局 */
  flex-shrink: 0;

  .sidebar {
    background: var(--semi-color-bg-0);
    border-right: 1px solid var(--semi-color-border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  /* 拖拽条 */
  .resize-handle {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
  }

  .resize-handle:hover {
    background: rgba(0,0,0,0.1); /* 可见的 hover 效果 */
  }
`;

export default DirectorySidebarWrapper;
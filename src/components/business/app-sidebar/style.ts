import styled from 'styled-components'

export const SidebarWrapper = styled.aside`
  width: 80px;
  padding: 10px 8px;
  background: var(--app-bg-sidebar);
  border-right: 1px solid var(--app-border);
  color: var(--semi-color-text-0);
  flex-shrink: 0;
  overflow: hidden;

  .app-rail-nav {
    height: auto;
    padding: 4px 0;
    background: transparent;
    overflow: hidden;
  }

  .semi-navigation {
    background: transparent;
    height: auto !important;
    overflow: hidden;
  }

  .semi-navigation-list {
    gap: 4px;
    overflow: hidden;
  }

  .semi-navigation-item {
    margin: 0 4px;
    border-radius: 10px;
    min-height: 60px;
  }

  .semi-navigation-item-icon {
    margin-right: 0;
    font-size: 24px;
    color: var(--app-text-secondary);
  }

  .semi-navigation-item-text {
    font-size: 13px;
    line-height: 1.2;
    margin-top: 4px;
    color: var(--app-text-muted);
  }

  .semi-navigation-item:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .semi-navigation-item-selected {
    background: rgba(0, 0, 0, 0.06);
  }

  .semi-navigation-item-selected .semi-navigation-item-text,
  .semi-navigation-item-selected .semi-navigation-item-icon {
    color: var(--app-text);
  }

  /* 隐藏底部footer和滚动条 */
  .semi-navigation-footer {
    display: none;
  }

  .semi-navigation-inner,
  .semi-navigation-list-wrapper {
    overflow: hidden !important;
  }

  *::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
`;

export default SidebarWrapper;

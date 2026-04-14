import styled from 'styled-components';

export const MenuContent = styled.div`
  min-width: 240px;
  padding: 8px;
  background: var(--semi-color-bg-3);
  border-radius: 12px;
  box-shadow: var(--semi-shadow-elevated);
  border: 1px solid var(--semi-color-border);
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: hidden;
  
  // 菜单标题
  .menu-title {
    font-size: 14px;
    line-height: 24px;
    font-weight: 600;
    color: var(--semi-color-text-2);
    margin: 4px 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--semi-color-border);
  }

  .menu-item {
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    font-size: 18px;
    line-height: 1.2;
    font-weight: 500;
    color: var(--semi-color-text-0);
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;

    .menu-item-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      flex: 0 0 20px;
      color: var(--semi-color-text-1);
      overflow: visible;
    }

    .menu-item-label {
      flex: 1;
      min-width: 0;
      display: block;
      overflow: hidden;
      white-space: nowrap;
      line-height: 1.25;
    }

    .menu-item-submenu-arrow {
      margin-left: 6px;
      color: var(--semi-color-text-2);
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }
  }

  .menu-item + .menu-item {
    margin-top: 2px;
  }

  .menu-item:hover {
    background: var(--semi-color-fill-0);
  }

  .menu-item.danger {
    color: var(--semi-color-danger);
    .menu-item-icon {
      color: var(--semi-color-danger);
    }
  }
  
  .menu-item.danger:hover {
    background: var(--semi-color-danger-light-default);
  }

  .menu-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .menu-item-icon .bookmark-favicon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: contain;
    display: block;
  }

  .menu-item-icon .semi-icon {
    display: block;
    line-height: 1;
  }

  .menu-item-icon .bookmark-favicon.favicon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8c9099;
    background: rgba(140, 144, 153, 0.08);
  }

  .menu-item-icon .bookmark-favicon.favicon-fallback .semi-icon {
    font-size: 13px;
  }

  .menu-item-icon .bookmark-folder-glyph {
    width: 18px;
    height: 18px;
    display: block;
    position: relative;
    color: var(--semi-color-text-1);
  }

  .menu-item-icon .bookmark-folder-glyph::before {
    content: "";
    position: absolute;
    left: 1px;
    top: 5px;
    width: 15px;
    height: 10px;
    border-radius: 3px;
    border: 1.5px solid currentColor;
    background: transparent;
    box-sizing: border-box;
  }

  .menu-item-icon .bookmark-folder-glyph::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 1px;
    width: 9px;
    height: 5px;
    border: 1.5px solid currentColor;
    border-bottom: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    box-sizing: border-box;
  }

  &.directory-context-menu {
    padding: 5px;

    .semi-divider-horizontal {
      margin: 2px 0 !important;
    }

    .menu-item {
      font-size: 17px;
      font-weight: 400;
      padding: 6px 12px;
      line-height: 1.3;
    }

    .menu-item + .menu-item {
      margin-top: 1px;
    }

    .menu-item-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }
  }
`;

export default MenuContent;

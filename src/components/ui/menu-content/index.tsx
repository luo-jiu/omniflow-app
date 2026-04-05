import styled from 'styled-components';

export const MenuContent = styled.div`
  min-width: 240px;
  padding: 8px;
  background: var(--semi-color-bg-3);
  border-radius: 12px;
  box-shadow: var(--semi-shadow-elevated);
  border: 1px solid var(--semi-color-border);
  
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
    line-height: 1.4;
    font-weight: 500;
    color: var(--semi-color-text-0);
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 10px;

    .menu-item-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      width: 16px;
      color: var(--semi-color-text-1);
    }

    .menu-item-label {
      flex: 1;
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
  }
`;

export default MenuContent;

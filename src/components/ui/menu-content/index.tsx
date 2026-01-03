import styled from 'styled-components';

export const MenuContent = styled.div`
  min-width: 220px;
  padding: 8px;
  
  .menu-title {
    font-size: 14px;
    line-height: 24px;
    font-weight: 600;
    color: var(--semi-color-text-2);
    margin: 4px 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--semi-color-border);
  }

  .menu-item {
    padding: 10px 16px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    font-size: 14px;
    line-height: 20px;
    color: var(--semi-color-text-0);
    transition: background 0.12s, color 0.12s;
    display: flex;
    align-items: center;
  }

  .menu-item + .menu-item {
    margin-top: 4px;
  }

  .menu-item:hover {
    background: var(--semi-color-fill-1);
  }

  .menu-item.danger {
    color: var(--semi-color-danger);
  }
  
  .menu-item.danger:hover {
    background: var(--semi-color-danger-light-default);
  }
`;

export default MenuContent;


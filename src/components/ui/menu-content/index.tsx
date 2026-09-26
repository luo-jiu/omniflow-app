import styled, { css } from 'styled-components';
import { focusVisibleStyles, surfaceStyles, textToneStyles } from '@/components/ui/theme-foundation-styles';

// 普通菜单画在行上，紧凑菜单画在外扩的伪元素上；两者消费同一份状态颜色。
const menuItemStateStyles = css`
  --app-menu-item-background: transparent;
  --app-menu-item-icon-color: var(--app-text-secondary);
  --app-menu-item-detail-color: var(--app-text-muted);
  ${textToneStyles('primary')}

  &:not(.disabled):not(:disabled):not([aria-disabled='true']) {
    &:hover {
      --app-menu-item-background: var(--app-hover-bg);
    }

    &:active {
      --app-menu-item-background: var(--app-active-bg);
    }

    &.danger {
      color: var(--app-danger-text);
      --app-menu-item-icon-color: var(--app-danger-text);

      &:hover {
        --app-menu-item-background: var(--app-danger-bg);
      }

      &:active {
        --app-menu-item-background: color-mix(in srgb, var(--app-danger-text) 14%, var(--app-danger-bg));
      }
    }
  }

  &:not(.disabled) {
    ${focusVisibleStyles}
  }

  &.disabled,
  &:disabled,
  &[aria-disabled='true'] {
    ${textToneStyles('disabled')}
    --app-menu-item-icon-color: var(--app-text-disabled);
    --app-menu-item-detail-color: var(--app-text-disabled);
    cursor: not-allowed;

    img.bookmark-favicon {
      opacity: 0.5;
    }
  }
`;

export const MenuContent = styled.div`
  ${surfaceStyles('popover')}
  min-width: 240px;
  padding: 8px;
  border-radius: 12px;
  box-shadow: var(--app-shadow);
  border: 1px solid var(--app-border-strong);
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: hidden;
  
  // 菜单标题
  .menu-title {
    ${textToneStyles('muted')}
    font-size: 14px;
    line-height: 24px;
    font-weight: 600;
    margin: 4px 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--app-border);
  }

  .menu-item {
    ${menuItemStateStyles}
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    font-size: 18px;
    line-height: 1.2;
    font-weight: 500;
    background-color: var(--app-menu-item-background);
    transition: background-color 0.15s ease, color 0.15s ease;
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
      color: var(--app-menu-item-icon-color);
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
      color: var(--app-menu-item-detail-color);
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }
  }

  .menu-item + .menu-item {
    margin-top: 2px;
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
    color: inherit;
    background: var(--app-fill-subtle);
  }

  .menu-item-icon .bookmark-favicon.favicon-fallback .semi-icon {
    font-size: 13px;
  }

  .menu-item-icon .bookmark-folder-glyph {
    width: 18px;
    height: 18px;
    display: block;
    position: relative;
    color: inherit;
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
    min-width: 160px;
    padding: 3px;
    border-radius: 6px;

    .menu-title {
      font-size: 11px;
      line-height: 18px;
      margin: 3px 8px;
      padding-bottom: 4px;
    }

    .semi-divider-horizontal {
      margin: 1px 0 !important;
    }

    .menu-item {
      position: relative;
      isolation: isolate;
      min-height: 24px;
      font-size: 12px;
      font-weight: 400;
      padding: 3px 7px;
      line-height: 1.2;
      gap: 5px;
      border-radius: 5px;
      background-color: transparent;
    }

    .menu-item + .menu-item {
      margin-top: 0;
    }

    .menu-item::before {
      content: '';
      position: absolute;
      inset: 0 -2px;
      z-index: -1;
      border-radius: inherit;
      pointer-events: none;
      background-color: var(--app-menu-item-background);
      transition: background-color 0.15s ease;
    }

    .menu-item-icon {
      width: 14px;
      height: 14px;
      flex-basis: 14px;
      font-size: 14px;
    }

    .menu-item-submenu-arrow {
      margin-left: 3px;
      font-size: 11px;
    }
  }

  &.directory-tree-context-menu {
    min-width: 148px;
    padding: 2px;

    .semi-divider-horizontal {
      margin: 0 !important;
    }

    .menu-item {
      min-height: 21px;
      padding: 2px 6px;
      gap: 4px;
    }

    .menu-item-icon {
      width: 13px;
      height: 13px;
      flex-basis: 13px;
      font-size: 13px;
    }

    .menu-item-submenu-arrow {
      margin-left: 2px;
    }
  }

  &.bookmark-folder-context-menu {
    width: min(290px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);

    .menu-item {
      width: 100%;
      box-sizing: border-box;
    }

    .menu-item-label {
      text-overflow: ellipsis;
    }

    .menu-item-label > span {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
`;

export default MenuContent;

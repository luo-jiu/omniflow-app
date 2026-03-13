import styled from 'styled-components'
import { Button } from '@douyinfe/semi-ui';
import {ComponentType} from "react";

// 头部最外层容器
export const HeaderWrapper = styled.div`
  height: 52px;
  background: var(--app-bg-sidebar);
  display: flex;
  align-items: center;
  padding: 0 18px 0 96px;
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;
  -webkit-app-region: drag;

  .content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    -webkit-app-region: no-drag;
  }

  .brand-mark {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--app-accent);
    flex-shrink: 0;
  }

  .brand-copy {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h1 {
    font-size: 17px;
    line-height: 1;
    font-weight: 600;
    margin: 0;
    color: var(--app-text);
  }

  .brand-subtitle {
    font-size: 14px;
    line-height: 1;
    color: var(--app-text-muted);
    letter-spacing: 0.02em;
  }

  .right-controls {
    display: flex;
    gap: 6px;
    align-items: center;
    -webkit-app-region: no-drag;
  }

  .header-action,
  .window-action {
    min-width: 34px;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 8px;
    color: var(--app-text-muted);
    background: transparent;
    font-size: 20px;
  }

  .header-action:hover,
  .window-action:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--app-text);
  }

  .window-action.close:hover {
    background: rgba(188, 62, 62, 0.1);
    color: #9f2f2f;
  }

  .avatar-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px 4px 4px;
    border-radius: 8px;
    cursor: pointer;
  }

  .avatar-trigger:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .avatar-name {
    font-size: 15px;
    color: var(--app-text-secondary);
  }

  .user-section {
    margin: 0 4px;
  }

  @media (max-width: 900px) {
    padding-left: 88px;

    .brand-subtitle,
    .avatar-name {
      display: none;
    }
  }
`

// 主题切换按钮
export const ThemeToggleButton = styled(Button as ComponentType<any>)`
  font-size: 15px;
  padding: 0 12px;
`

export default HeaderWrapper

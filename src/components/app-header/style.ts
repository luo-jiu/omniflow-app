import styled from 'styled-components'
import { Button } from '@douyinfe/semi-ui';
import {ComponentType} from "react";

// 头部最外层容器
export const HeaderWrapper = styled.div`
  height: 56px;
  background: var(--semi-color-bg-2);
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--semi-color-border);
  flex-shrink: 0;
  -webkit-app-region: drag;

  .content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .right-controls {
    display: flex;
    gap: 8px;
    -webkit-app-region: no-drag;
  }

  h1 {
    font-size: 28px;
    margin: 0;
    color: var(--semi-color-text-0);
  }
`

// 主题切换按钮
export const ThemeToggleButton = styled(Button as ComponentType<any>)`
  font-size: 20px;
  margin-top: 5px; /* 你想要往下移多少就调这个 */
  padding: 0 12px;     /* 左右热区 */
`

export default HeaderWrapper

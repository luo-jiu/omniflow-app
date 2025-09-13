import styled from 'styled-components'

// 头部最外层容器
export const HeaderWrapper = styled.div`
  height: 48px;
  background: var(--semi-color-bg-2);
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--semi-color-border);
  flex-shrink: 0; /* 防止被压缩 */
  
  // 内容区域容器（BEM 命名规范中的 content 部分）
  .content {
    display: flex;
    justify-content: space-between; /* 左右分布 */
    align-items: center;
    width: 100%;
  }

  h1 {
    font-size: 16px;
    margin: 0;
    color: var(--semi-color-text-0);
  }
`

export default HeaderWrapper
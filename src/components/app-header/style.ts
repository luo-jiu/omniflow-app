import styled from 'styled-components'

// 头部最外层容器
export const HeaderWrapper = styled.div`
  height: 50px;
  background: #2c3e50;
  color: white;
  display: flex;
  align-items: center;
  padding: 0 15px;
  font-size: 18px;
  flex-shrink: 0; /* 防止被压缩 */
  
  // 内容区域容器（BEM 命名规范中的 content 部分）
  .content {
      display: flex;             /* 启用弹性布局 */
      justify-content: space-between;  /* 子元素左右两端对齐 */
  }

  .divider {
    height: 5px;
    background-color: #c20c0c;
  }
`

export default HeaderWrapper
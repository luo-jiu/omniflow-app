import styled from 'styled-components';

export const MainWrapper = styled.main`
  flex: 1;
  padding: 16px;
  overflow: hidden;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  position: relative;

  /* 查看器模式下移除内边距，让内容占满 */
  &.viewer-mode {
    padding: 0;
  }
`;

export default MainWrapper;

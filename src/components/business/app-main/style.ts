import styled from 'styled-components';

export const MainWrapper = styled.main`
  flex: 1;
  padding: 14px;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--semi-color-text-0);
  position: relative;

  &.viewer-mode {
    padding: 12px;
  }
`;

export default MainWrapper;

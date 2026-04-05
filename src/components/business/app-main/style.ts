import styled from 'styled-components';

export const MainWrapper = styled.main`
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

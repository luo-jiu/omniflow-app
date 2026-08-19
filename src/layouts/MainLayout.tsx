import React, { ReactNode } from 'react';
import styled from 'styled-components';
import { APP_OVERLAY_ROOT_ID } from '@/utils/popup-container';

interface MainLayoutProps {
  children: ReactNode;
}

const LayoutWrapper = styled.div`
  display: flex;
  position: relative;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  --windows-caption-controls-width: 0px;

  html[data-platform="windows"] & {
    --windows-caption-controls-width: calc(
      100vw
      - env(titlebar-area-x, 0px)
      - env(titlebar-area-width, calc(100vw - 138px))
    );
    background: var(--app-bg);
  }
`;

const OverlayRoot = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 2000;

  > * {
    pointer-events: auto;
  }
`;

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <LayoutWrapper>
      {children}
      <OverlayRoot id={APP_OVERLAY_ROOT_ID} />
    </LayoutWrapper>
  );
};

export default MainLayout;

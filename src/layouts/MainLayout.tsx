import React, { ReactNode } from 'react';
import styled from 'styled-components';

interface MainLayoutProps {
  children: ReactNode;
}

const LayoutWrapper = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <LayoutWrapper>
      {children}
    </LayoutWrapper>
  );
};

export default MainLayout;

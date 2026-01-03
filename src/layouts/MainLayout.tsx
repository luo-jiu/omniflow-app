import React, { ReactNode } from 'react';
import AppHeader from "@/components/business/app-header";
import styled from 'styled-components';

interface MainLayoutProps {
  children: ReactNode;
}

const LayoutWrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
`;

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <LayoutWrapper>
      <AppHeader />
      <div className="main-content">
        {children}
      </div>
    </LayoutWrapper>
  );
};

export default MainLayout;


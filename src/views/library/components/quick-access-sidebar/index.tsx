import React from 'react';
import {
  SideMenu,
  SideMenuHeader,
  SideMenuList,
  SideMenuItem
} from '../../style';

export type QuickAccessMode = 'all' | 'favorites' | 'recent';

interface QuickAccessSidebarProps {
  mode: QuickAccessMode;
  onModeChange: (mode: QuickAccessMode) => void;
}

const QuickAccessSidebar: React.FC<QuickAccessSidebarProps> = ({ mode, onModeChange }) => {
  return (
    <SideMenu>
      <SideMenuHeader>Quick Access</SideMenuHeader>
      <SideMenuList>
        <SideMenuItem
          data-active={mode === 'all'}
          onClick={() => onModeChange('all')}
        >
          全部库
        </SideMenuItem>
        <SideMenuItem
          data-active={mode === 'favorites'}
          onClick={() => onModeChange('favorites')}
        >
          我的收藏
        </SideMenuItem>
        <SideMenuItem
          data-active={mode === 'recent'}
          onClick={() => onModeChange('recent')}
        >
          最近访问
        </SideMenuItem>
      </SideMenuList>
    </SideMenu>
  );
};

export default QuickAccessSidebar;

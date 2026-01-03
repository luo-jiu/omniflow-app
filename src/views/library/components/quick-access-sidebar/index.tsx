import React from 'react';
import {
  SideMenu,
  SideMenuHeader,
  SideMenuList,
  SideMenuItem
} from '../../style';

const QuickAccessSidebar: React.FC = () => {
  return (
    <SideMenu>
      <SideMenuHeader>快速访问</SideMenuHeader>
      <SideMenuList>
        <SideMenuItem>我的收藏</SideMenuItem>
        <SideMenuItem>最近访问文件</SideMenuItem>
      </SideMenuList>
    </SideMenu>
  );
};

export default QuickAccessSidebar;


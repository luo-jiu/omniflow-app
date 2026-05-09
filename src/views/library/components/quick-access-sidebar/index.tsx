import React from 'react';
import { IconSetting } from '@douyinfe/semi-icons';
import {
  SideMenu,
  SideMenuHeader,
  SideMenuList,
  SideMenuItem,
  SideMenuFooter,
  SideMenuAction,
} from '../../style';

export type QuickAccessMode = 'all' | 'favorites' | 'recent';

interface QuickAccessSidebarProps {
  mode: QuickAccessMode;
  onModeChange: (mode: QuickAccessMode) => void;
  onOpenSettings: () => void;
  onSidebarClick?: () => void;
  footerContent?: React.ReactNode;
}

const QuickAccessSidebar: React.FC<QuickAccessSidebarProps> = ({
  mode,
  onModeChange,
  onOpenSettings,
  onSidebarClick,
  footerContent,
}) => {
  return (
    <SideMenu onClick={onSidebarClick}>
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
      <SideMenuFooter>
        <SideMenuAction
          onClick={(event) => {
            event.stopPropagation();
            onOpenSettings();
          }}
          title="设置"
          aria-label="设置"
        >
          <IconSetting style={{ fontSize: 15 }} />
        </SideMenuAction>
        {footerContent ? (
          <SideMenuAction as="div" className="avatar-action">
            {footerContent}
          </SideMenuAction>
        ) : <span />}
      </SideMenuFooter>
    </SideMenu>
  );
};

export default QuickAccessSidebar;

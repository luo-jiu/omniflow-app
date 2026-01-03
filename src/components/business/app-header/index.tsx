import { FC } from 'react';
import {HeaderWrapper} from './style';
import { Button, Avatar, Popover } from '@douyinfe/semi-ui';
import {IconMinus, IconStop, IconClose, IconSetting, IconExit} from '@douyinfe/semi-icons';
import {useNavigate} from "react-router-dom";
import { useAuth } from '@/contexts/AuthContext';
import ContextMenu from '@/components/ui/context-menu';

declare global {
  interface Window {
    electronWindow: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

const AppHeader: FC = () => {
  const navigate = useNavigate()
  const { user, isLoggedIn, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const avatarContent = (
    <div 
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
      onClick={() => !isLoggedIn && navigate('/login')}
    >
      <Avatar
        size="default" // 从 small 改为 default，稍微变大一点
        src={user?.avatar}
        style={{ 
          backgroundColor: isLoggedIn ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-2)',
          marginRight: 8 
        }}
      >
        {isLoggedIn ? (user?.username?.[0]?.toUpperCase() || 'U') : '未'}
      </Avatar>
    </div>
  );

  return (
    <HeaderWrapper>
      <div className="content">
        <h1 onClick={() => navigate('/')} title="返回首页">
          Omniflow
        </h1>
        <div className="right-controls">
          <Button
            onClick={() => navigate('/settings')}
            theme="borderless"
            icon={<IconSetting style={{ fontSize: 22 }} />} // 稍微增大图标
            title="设置"
          />

          <div className="user-section" style={{ margin: '0 8px', display: 'flex', alignItems: 'center' }}>
            {isLoggedIn ? (
              <Popover
                showArrow={false}
                spacing={0} // 紧贴头像
                style={{ padding: 0 }} // 移除 Popover 默认内边距，解决“嵌套感”
                content={
                  <ContextMenu
                    title={user?.username}
                    style={{ border: 'none', boxShadow: 'none' }} // 移除 ContextMenu 内部的边框和阴影，因为 Popover 已经有了
                    items={[
                      {
                        key: 'logout',
                        label: '退出登录',
                        icon: <IconExit />,
                        danger: true,
                        onClick: handleLogout
                      }
                    ]}
                  />
                }
              >
                {avatarContent}
              </Popover>
            ) : (
              avatarContent
            )}
          </div>

          <Button
            onClick={() => window.electronWindow.minimize()}
            theme="borderless"
            size="large" // 点击范围大
            icon={<IconMinus style={{ fontSize: 20 }} />} // 图标更大
          />
          <Button
            onClick={() => window.electronWindow.maximize()}
            theme="borderless"
            size="large"
            icon={<IconStop style={{ fontSize: 20 }} />}
          />
          <Button
            onClick={() => window.electronWindow.close()}
            theme="borderless"
            size="large"
            icon={<IconClose style={{ fontSize: 20 }} />}
          />
        </div>
      </div>
    </HeaderWrapper>
  );
};

export default AppHeader;
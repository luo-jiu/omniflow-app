import { FC } from 'react';
import {HeaderWrapper} from './style';
import { Button, Avatar, Popover } from '@douyinfe/semi-ui';
import {IconSetting, IconExit, IconUpload} from '@douyinfe/semi-icons';
import {useNavigate} from "react-router-dom";
import { useAuth } from '@/hooks/useAuth';
import ContextMenu from '@/components/ui/context-menu';

const AppHeader: FC = () => {
  const navigate = useNavigate()
  const { user, isLoggedIn, logout } = useAuth();
  const displayName = isLoggedIn ? user?.username || 'User' : '未登录';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const avatarContent = (
    <div
      className="avatar-trigger"
      onClick={() => !isLoggedIn && navigate('/login')}
    >
      <Avatar
        size="small"
        src={user?.avatar}
        style={{
          backgroundColor: isLoggedIn ? 'var(--app-accent)' : 'var(--semi-color-fill-2)',
        }}
      >
        {isLoggedIn ? (user?.username?.[0]?.toUpperCase() || 'U') : '未'}
      </Avatar>
      <span className="avatar-name">{displayName}</span>
    </div>
  );

  return (
    <HeaderWrapper>
      <div className="content">
        <div className="brand" onClick={() => navigate('/')} title="返回首页">
          <span className="brand-mark" />
          <div className="brand-copy">
            <h1>Omniflow</h1>
            <span className="brand-subtitle">Quiet workspace</span>
          </div>
        </div>
        <div className="right-controls">
          <Button
            onClick={() => navigate('/upload-center')}
            theme="borderless"
            className="header-action"
            icon={<IconUpload />}
            title="上传中心"
          />
          <Button
            onClick={() => navigate('/settings')}
            theme="borderless"
            className="header-action"
            icon={<IconSetting />}
            title="设置"
          />

          <div className="user-section">
            {isLoggedIn ? (
              <Popover
                showArrow={false}
                spacing={8}
                style={{ padding: 0 }}
                content={
                  <ContextMenu
                    title={user?.username}
                    style={{ border: 'none', boxShadow: 'none' }}
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

        </div>
      </div>
    </HeaderWrapper>
  );
};

export default AppHeader;

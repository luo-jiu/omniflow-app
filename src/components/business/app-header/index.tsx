import { FC } from 'react';
import { HeaderWrapper } from './style';
import { Button, Popover } from '@douyinfe/semi-ui';
import { IconSetting, IconUpload, IconMusic } from '@douyinfe/semi-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMediaEntries } from '@/hooks/useMediaRegistry';
import { mediaRegistry } from '@/contexts/media-registry.singleton';
import { setPendingActivation } from '@/contexts/file-viewer-pending-activation';
import MediaHubPopover from '@/components/business/media-hub-popover';
import { getAppPopupContainer } from '@/utils/popup-container';
import type { MediaEntry } from '@/contexts/media-registry.context';

// 全局顶栏：所有路由共享。承载传输中心、设置、MediaHub（按需显示）。
// Avatar/登出 已下沉到 library 左下角；详见 docs/media-hub-contract.md。
const AppHeader: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const mediaEntries = useMediaEntries();

  // 登录页不显示全局顶栏。
  if (location.pathname === '/login') return null;

  const handleActivate = (tabId: string) => {
    const entry = mediaEntries.find((e) => e.tabId === tabId);
    if (!entry || entry.libraryId == null) return;
    setPendingActivation(entry.libraryId, tabId);
    navigate(`/libraries/${entry.libraryId}`);
  };

  const handleToggle = (entry: MediaEntry) => {
    if (entry.isPlaying) {
      mediaRegistry.pause(entry.entryId);
    } else {
      void mediaRegistry.play(entry.entryId);
    }
  };

  const handleSeek = (entry: MediaEntry, time: number) => {
    mediaRegistry.seek(entry.entryId, time);
  };

  const handleDismiss = (entry: MediaEntry) => {
    mediaRegistry.dismiss(entry.entryId);
  };

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
          {mediaEntries.length > 0 ? (
            <Popover
              trigger="click"
              showArrow={false}
              position="bottomRight"
              spacing={6}
              getPopupContainer={getAppPopupContainer}
              content={
                <MediaHubPopover
                  entries={mediaEntries}
                  onActivate={handleActivate}
                  onToggle={handleToggle}
                  onSeek={handleSeek}
                  onDismiss={handleDismiss}
                />
              }
            >
              <Button
                theme="borderless"
                className="header-action"
                icon={<IconMusic />}
                title="正在播放的媒体"
              />
            </Popover>
          ) : null}
          <Button
            onClick={() => navigate('/transfer-center?tab=upload')}
            theme="borderless"
            className="header-action"
            icon={<IconUpload />}
            title="传输中心"
          />
          <Button
            onClick={() => navigate('/settings')}
            theme="borderless"
            className="header-action"
            icon={<IconSetting />}
            title="设置"
          />
        </div>
      </div>
    </HeaderWrapper>
  );
};

export default AppHeader;

import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Typography, Divider, Switch, Select, Button, Input, Toast } from '@douyinfe/semi-ui';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getFileTreeShowSuffix, setFileTreeShowSuffix } from '@/utils/fileTreeSettings';
import type { ThemeMode } from '@/contexts/theme.context';
import {
  getAutoImportEnabled,
  getAutoImportWatchDirectory,
  setAutoImportEnabled,
  setAutoImportWatchDirectory,
} from '@/features/file-explorer/auto-import/settings';
import { pickAutoImportDirectoryFromDesktop } from '@/features/file-explorer/services/desktop-auto-import.api';
import { updateCurrentUserProfile, type UserProfile } from '@/features/user/services/user.api';
import {
  getAppLanguage,
  mergeUserPreferencesIntoExt,
  resolveUserPreferences,
  setAppLanguage,
  type AppLanguage,
  type UserPreferences,
} from '@/features/user/preferences/user-preferences';
import {
  getLocalChromeBookmarkImportHint,
  importChromeBookmarksFromText,
  loadLocalChromeBookmarkFile,
  pickChromeBookmarkImportFile,
} from '@/features/embedded-browser/bookmarks/import/chrome-bookmark-import';

const SettingsPageWrapper = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;

  .top-drag-region {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    -webkit-app-region: drag;
    z-index: 0;
  }
`;

const SettingsWrapper = styled.div`
  position: relative;
  z-index: 1;
  padding: 48px 60px;
  padding-top: 56px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  color: var(--semi-color-text-0);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .settings-subtitle {
    margin-left: 52px;
    margin-bottom: 28px;
    color: var(--semi-color-text-2);
    font-size: 15px;
  }

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 0;
  }

  .setting-title {
    font-size: 16px;
    font-weight: 500;
  }

  .setting-desc {
    font-size: 14px;
    margin-top: 4px;
    color: var(--semi-color-text-2);
  }

  .setting-control-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: min(56vw, 420px);
    justify-content: flex-end;
  }

  .setting-path-input {
    flex: 1;
    min-width: 0;
  }

  .settings-action-btn {
    min-height: 36px;
    min-width: 96px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 14px;
  }

  .settings-action-btn.manage {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-bg-0);
  }

  .settings-action-btn.manage:hover {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .settings-action-btn.manage:active {
    background: var(--semi-color-bg-0);
    border-color: color-mix(in srgb, var(--semi-color-primary) 78%, var(--semi-color-border) 22%);
    color: color-mix(in srgb, var(--semi-color-primary) 88%, var(--semi-color-text-0) 12%);
  }

  .settings-action-btn.manage:focus-visible {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .settings-action-btn.exit {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-fill-0);
  }

  .settings-action-btn.exit:hover {
    background: var(--semi-color-fill-1);
    border-color: color-mix(in srgb, var(--semi-color-border) 85%, var(--semi-color-text-2));
  }

  .settings-action-btn.exit:active {
    background: var(--semi-color-fill-2);
  }

  .theme-control-group {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }

  .theme-toggle {
    position: relative;
    width: 90px;
    height: 34px;
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-fill-0);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    transition: background-color 0.2s ease, border-color 0.2s ease;
  }

  .theme-toggle:hover {
    border-color: color-mix(in srgb, var(--semi-color-primary) 48%, var(--semi-color-border) 52%);
  }

  .theme-toggle::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 17px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-text-2) 72%, transparent);
    box-shadow:
      28px 0 0 color-mix(in srgb, var(--semi-color-text-2) 72%, transparent),
      56px 0 0 color-mix(in srgb, var(--semi-color-text-2) 72%, transparent);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .theme-toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--semi-color-bg-0);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
    transition: transform 0.2s ease, background-color 0.2s ease;
    pointer-events: none;
  }

  .theme-toggle[data-mode='system'] .theme-toggle-thumb {
    transform: translateX(28px);
    background: color-mix(in srgb, var(--semi-color-primary) 18%, var(--semi-color-bg-0) 82%);
  }

  .theme-toggle[data-mode='dark'] .theme-toggle-thumb {
    transform: translateX(56px);
    background: var(--semi-color-primary);
  }

  .theme-toggle-label {
    min-width: 64px;
    font-size: 14px;
    color: var(--semi-color-text-1);
    text-align: right;
  }
`;

const THEME_LABEL_MAP: Record<ThemeMode, string> = {
  light: '白天',
  system: '跟随系统',
  dark: '夜间',
};

const Settings: React.FC = () => {
  const { Title, Text } = Typography;
  const { theme, toggleTheme } = useTheme();
  const { user, setUserInfo } = useAuth();
  const navigate = useNavigate();
  const userRef = useRef(user);
  const userExtRef = useRef<string | undefined>(user?.ext);
  const persistQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  const [showFileSuffix, setShowFileSuffix] = useState<boolean>(() => getFileTreeShowSuffix());
  const [autoImportEnabled, setAutoImportEnabledState] = useState<boolean>(() => getAutoImportEnabled());
  const [autoImportWatchDirectory, setAutoImportWatchDirectoryState] = useState<string>(() => getAutoImportWatchDirectory());

  useEffect(() => {
    userRef.current = user;
    userExtRef.current = user?.ext;
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const preferences = resolveUserPreferences(user.ext);
    setLanguage(preferences.language);
    setShowFileSuffix(preferences.fileTreeShowSuffix);
    setAutoImportEnabledState(preferences.autoImportEnabled);
    setAutoImportWatchDirectoryState(preferences.autoImportWatchDirectory);
  }, [user]);

  const syncAuthUser = (profile: UserProfile) => {
    const currentUser = userRef.current;
    setUserInfo({
      ...(currentUser || {}),
      id: profile.id,
      username: profile.username,
      nickname: profile.nickname || currentUser?.nickname || profile.username,
      avatar: profile.avatar || currentUser?.avatar,
      ext: profile.ext || undefined,
      email: profile.email ?? currentUser?.email,
      phone: profile.phone ?? currentUser?.phone,
    });
  };

  const persistPreferences = async (patch: UserPreferences, successMessage?: string) => {
    const currentUser = userRef.current;
    if (!currentUser) {
      return true;
    }

    const ownerUserID = currentUser.id;
    const nextExt = mergeUserPreferencesIntoExt(userExtRef.current, patch);
    userExtRef.current = nextExt;

    const runPersist = async () => {
      if (userRef.current?.id !== ownerUserID) {
        return false;
      }

      try {
        const nextProfile = await updateCurrentUserProfile({ ext: nextExt });
        if (userRef.current?.id !== ownerUserID) {
          return false;
        }
        userExtRef.current = nextProfile.ext || nextExt;
        syncAuthUser(nextProfile);
        if (successMessage) {
          Toast.success(successMessage);
        }
        return true;
      } catch (error: any) {
        if (userRef.current?.id === ownerUserID) {
          Toast.warning(error?.message || '本地已生效，云端保存失败');
        }
        return false;
      }
    };

    const queuedPersist = persistQueueRef.current.then(runPersist, runPersist);
    persistQueueRef.current = queuedPersist;
    return queuedPersist;
  };

  const persistAutoImportWatchDirectory = async (value: string) => {
    setAutoImportWatchDirectoryState(value);
    setAutoImportWatchDirectory(value);
    return persistPreferences({ autoImportWatchDirectory: value });
  };

  const handlePickAutoImportDirectory = async () => {
    try {
      const directoryPath = await pickAutoImportDirectoryFromDesktop();
      if (!directoryPath) {
        return;
      }
      const saved = await persistAutoImportWatchDirectory(directoryPath);
      if (saved) {
        Toast.success('已更新监听目录');
      }
    } catch (error: any) {
      Toast.error(error?.message || '选择监听目录失败');
    }
  };

  const handleImportChromeBookmarks = async (sourceMode: 'local' | 'file') => {
    try {
      const picked = sourceMode === 'local'
        ? await loadLocalChromeBookmarkFile()
        : await pickChromeBookmarkImportFile();
      if (!picked) {
        return;
      }
      const source = sourceMode === 'local'
        ? `chrome-local:${picked.filePath || getLocalChromeBookmarkImportHint()}`
        : `chrome-file:${picked.filePath || 'selected-file'}`;
      const result = await importChromeBookmarksFromText(picked.content, source);
      Toast.success(`已导入 ${result.importedCount} 条书签`);
    } catch (error: any) {
      Toast.error(error?.message || '导入 Chrome 书签失败');
    }
  };

  return (
    <SettingsPageWrapper>
      <div className="top-drag-region" />
      <SettingsWrapper>
        <div className="settings-header">
          <Button
            icon={<IconChevronLeft style={{ fontSize: 20 }} />}
            theme="borderless"
            onClick={() => navigate(-1)}
            style={{ padding: '6px', borderRadius: '8px' }}
          />
          <Title heading={2} style={{ fontSize: 26, fontWeight: 600 }}>软件设置</Title>
        </div>

        <div className="settings-subtitle">
          在这里调整你的 Omniflow 体验
        </div>

        <Divider style={{ margin: '20px 0' }} />

        <div className="setting-item">
          <div>
            <div className="setting-title">界面主题</div>
            <div className="setting-desc">白天、跟随系统、夜间三种显示方式</div>
          </div>
          <div className="theme-control-group">
            <button
              type="button"
              className="theme-toggle"
              data-mode={theme}
              onClick={() => {
                const nextTheme = toggleTheme();
                void persistPreferences({ theme: nextTheme });
              }}
              aria-label={`切换主题，当前为${THEME_LABEL_MAP[theme]}`}
              title={`当前主题：${THEME_LABEL_MAP[theme]}`}
            >
              <span className="theme-toggle-thumb" />
            </button>
            <span className="theme-toggle-label">{THEME_LABEL_MAP[theme]}</span>
          </div>
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">默认语言</div>
            <div className="setting-desc">选择界面显示的语言</div>
          </div>
          <Select
            value={language}
            style={{ width: 160 }}
            size="large"
            onChange={(value) => {
              const nextLanguage = value as AppLanguage;
              setLanguage(nextLanguage);
              setAppLanguage(nextLanguage);
              void persistPreferences({ language: nextLanguage });
            }}
          >
            <Select.Option value="zh-CN">简体中文</Select.Option>
            <Select.Option value="en-US">English</Select.Option>
          </Select>
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">目录树显示文件后缀</div>
            <div className="setting-desc">开启后，文件节点会显示扩展名（如 .txt、.jpg）</div>
          </div>
          <Switch
            size="large"
            checked={showFileSuffix}
            onChange={(checked) => {
              setShowFileSuffix(checked);
              setFileTreeShowSuffix(checked);
              void persistPreferences({ fileTreeShowSuffix: checked });
            }}
          />
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">自动导入下载目录</div>
            <div className="setting-desc">监控指定目录并自动加入上传队列（目标：当前库根目录）</div>
          </div>
          <Switch
            size="large"
            checked={autoImportEnabled}
            onChange={(checked) => {
              setAutoImportEnabledState(checked);
              setAutoImportEnabled(checked);
              void persistPreferences({ autoImportEnabled: checked });
            }}
          />
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">监听目录路径</div>
            <div className="setting-desc">未指定时将使用默认路径（下载目录/Omniflow Inbox）</div>
          </div>
          <div className="setting-control-group">
            <Input
              className="setting-path-input"
              value={autoImportWatchDirectory}
              placeholder="未设置（默认：下载目录/Omniflow Inbox）"
              onChange={(value) => {
                setAutoImportWatchDirectoryState(value);
              }}
              onBlur={() => {
                void persistAutoImportWatchDirectory(autoImportWatchDirectory);
              }}
            />
            <Button
              theme="borderless"
              className="settings-action-btn manage"
              onClick={() => {
                void handlePickAutoImportDirectory();
              }}
            >
              选择
            </Button>
          </div>
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">标签管理</div>
            <div className="setting-desc">管理标签场景、颜色、排序和启用状态</div>
          </div>
          <Button
            theme="borderless"
            onClick={() => navigate('/settings/tags')}
            className="settings-action-btn manage"
          >
            管理
          </Button>
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">浏览器打开映射</div>
            <div className="setting-desc">为文件后缀绑定网站，支持目录树右键直接在浏览器模式打开</div>
          </div>
          <Button
            theme="borderless"
            onClick={() => navigate('/settings/browser-file-mappings')}
            className="settings-action-btn manage"
          >
            管理
          </Button>
        </div>

        <div className="setting-item">
          <div>
            <div className="setting-title">导入 Chrome 书签</div>
            <div className="setting-desc">支持导入本地书签文件，或手动选择任意 Chrome 导出的书签 JSON</div>
          </div>
          <div className="setting-control-group">
            <Button
              theme="borderless"
              onClick={() => {
                void handleImportChromeBookmarks('local');
              }}
              className="settings-action-btn manage"
            >
              导入本地书签
            </Button>
            <Button
              theme="borderless"
              onClick={() => {
                void handleImportChromeBookmarks('file');
              }}
              className="settings-action-btn manage"
            >
              指定文件导入
            </Button>
          </div>
        </div>

        <Divider style={{ margin: '24px 0' }} />

        <div>
          <Title heading={3} style={{ fontSize: 18, marginBottom: 8 }}>关于</Title>
          <Text style={{ fontSize: 14, color: 'var(--semi-color-text-2)' }}>Omniflow App v0.0.1</Text>
        </div>

        <div style={{ marginTop: 48, textAlign: 'center' }}>
          <Button
            theme="light"
            type="secondary"
            size="default"
            onClick={() => navigate(-1)}
            className="settings-action-btn exit"
          >
            退出设置
          </Button>
        </div>
      </SettingsWrapper>
    </SettingsPageWrapper>
  );
};

export default Settings;

import React, { useEffect, useRef, useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { Button, Divider, Input, Select, Switch, Toast, Typography } from '@douyinfe/semi-ui';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/contexts/theme.context';
import { getFileTreeShowSuffix, setFileTreeShowSuffix } from '@/utils/fileTreeSettings';
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
import { getAppPopupContainer } from '@/utils/popup-container';
import BrowserFileMappingsPage from '@/views/browser-file-mappings';
import StorageSettings from '@/views/storage-settings';
import TagManagement from '@/views/tag-management';
import type { SystemWorkspaceViewProps } from '../../types';
import AppUpdateSettings from '@/features/app-update/components/AppUpdateSettings';

const SettingsWrapper = styled.div`
  width: 100%;
  margin: 0;
  color: var(--semi-color-text-0);

  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
  }

  .setting-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
  }

  .setting-desc {
    font-size: 11px;
    margin-top: 4px;
    color: var(--semi-color-text-2);
    line-height: 1.6;
  }

  .setting-control-group {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    width: 360px;
    justify-content: flex-end;
  }

  .setting-path-input {
    flex: 1;
    min-width: 0;
  }

  .setting-path-input .semi-input-wrapper,
  .setting-path-input .semi-input {
    font-size: 11px;
  }

  .setting-path-input .semi-input-wrapper {
    min-height: 30px;
  }

  .settings-action-btn {
    box-sizing: border-box;
    height: 30px;
    min-height: 30px;
    min-width: 72px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    line-height: 30px;
    white-space: nowrap;
    transform: none;
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
    gap: 7px;
  }

  .theme-toggle {
    position: relative;
    box-sizing: border-box;
    width: 64px;
    height: 26px;
    padding: 3px;
    border-radius: 999px;
    border: 1px solid var(--semi-color-border);
    background: var(--semi-color-bg-0);
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
    left: 10px;
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--semi-color-text-2) 72%, transparent);
    box-shadow:
      20px 0 0 color-mix(in srgb, var(--semi-color-text-2) 72%, transparent),
      40px 0 0 color-mix(in srgb, var(--semi-color-text-2) 72%, transparent);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .theme-toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: var(--semi-color-bg-0);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.14);
    transition: transform 0.2s ease, background-color 0.2s ease;
    pointer-events: none;
  }

  .theme-toggle[data-mode='system'] .theme-toggle-thumb {
    transform: translateX(19px);
    background: color-mix(in srgb, var(--semi-color-primary) 18%, var(--semi-color-bg-0) 82%);
  }

  .theme-toggle[data-mode='dark'] .theme-toggle-thumb {
    transform: translateX(38px);
    background: var(--semi-color-primary);
  }

  .theme-toggle-label {
    min-width: 51px;
    font-size: 11px;
    color: var(--semi-color-text-1);
    text-align: right;
  }

  .language-select {
    font-size: 11px;
  }

  .language-select.semi-select {
    height: 30px;
    max-height: 30px !important;
    overflow: hidden !important;
  }

  .language-select.semi-select::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .language-select.semi-select,
  .language-select .semi-select-selection {
    height: 30px;
    min-height: 30px;
    max-height: 30px;
    font-size: 11px;
  }

  .language-select .semi-select-selection {
    align-items: center;
    overflow: hidden !important;
    padding-top: 0;
    padding-bottom: 0;
  }

  .language-select .semi-select-selection-placeholder,
  .language-select .semi-select-selection-rendered,
  .language-select .semi-select-selection-text,
  .language-select .semi-select-selection span {
    overflow: hidden !important;
  }

  .language-select .semi-select-selection-text {
    max-height: none !important;
    line-height: 30px;
    white-space: nowrap;
  }

  .language-select .semi-select-selection-text::-webkit-scrollbar {
    display: none;
  }

  .language-select .semi-select-arrow {
    align-self: center;
  }

  .chrome-bookmark-actions {
    width: auto;
  }

  .chrome-bookmark-actions .settings-action-btn {
    width: 92px;
    flex: 0 0 92px;
    padding: 0 10px;
  }

  .app-update-copy {
    flex: 1;
    min-width: 0;
  }

  .app-update-actions {
    width: 360px;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
  }

  .app-update-actions .settings-action-btn {
    min-width: 108px;
  }

  .app-version {
    font-size: 11px;
    color: var(--semi-color-text-2);
    font-variant-numeric: tabular-nums;
  }

  .app-update-setting .setting-desc.is-error {
    color: var(--semi-color-danger);
  }

  .app-update-progress {
    width: min(280px, 100%);
    height: 4px;
    margin-top: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--semi-color-fill-1);
  }

  .app-update-progress > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--semi-color-primary);
    transition: width 0.16s ease;
  }
`;

const SettingsDropdownStyle = createGlobalStyle`
  .settings-language-dropdown .semi-select-option {
    min-height: 26px;
    padding-top: 4px;
    padding-bottom: 4px;
    font-size: 11px;
    line-height: 18px;
  }

  .settings-language-dropdown .semi-select-option-selected {
    font-weight: 600;
  }
`;

const THEME_LABEL_MAP: Record<ThemeMode, string> = {
  light: '白天',
  system: '跟随系统',
  dark: '夜间',
};

const SettingsWorkspace: React.FC<SystemWorkspaceViewProps> = ({
  onSettingsSectionChange,
  settingsSection = 'home',
}) => {
  const { Title, Text } = Typography;
  const { theme, toggleTheme } = useTheme();
  const { user, setUserInfo } = useAuth();
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

  const goHome = () => {
    onSettingsSectionChange?.('home');
  };

  if (settingsSection === 'tags') {
    return <TagManagement embedded onBack={goHome} />;
  }

  if (settingsSection === 'storage') {
    return <StorageSettings embedded onBack={goHome} />;
  }

  if (settingsSection === 'browser-mappings') {
    return <BrowserFileMappingsPage embedded onBack={goHome} />;
  }

  return (
    <SettingsWrapper>
      <SettingsDropdownStyle />
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
          style={{ width: 125 }}
          size="small"
          className="language-select"
          dropdownClassName="settings-language-dropdown"
          getPopupContainer={getAppPopupContainer}
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
          size="small"
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
          size="small"
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
          onClick={() => onSettingsSectionChange?.('tags')}
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
          onClick={() => onSettingsSectionChange?.('browser-mappings')}
          className="settings-action-btn manage"
        >
          管理
        </Button>
      </div>

      <div className="setting-item">
        <div>
          <div className="setting-title">存储管理</div>
          <div className="setting-desc">管理多个存储 Provider 和文件分流规则</div>
        </div>
        <Button
          theme="borderless"
          onClick={() => onSettingsSectionChange?.('storage')}
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
        <div className="setting-control-group chrome-bookmark-actions">
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

      <AppUpdateSettings />

      <Divider style={{ margin: '16px 0' }} />

      <div>
        <Title heading={3} style={{ fontSize: 16, marginBottom: 7, lineHeight: 1.2 }}>关于</Title>
        <Text style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>Omniflow App</Text>
      </div>
    </SettingsWrapper>
  );
};

export default SettingsWorkspace;

import React from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { IconDownload, IconRefresh, IconRestart } from '@douyinfe/semi-icons';

import {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateSnapshot,
  installAppUpdate,
  subscribeAppUpdate,
} from '../services/app-update.api';
import type { AppUpdateSnapshot } from '../types';

const INITIAL_SNAPSHOT: AppUpdateSnapshot = {
  availableVersion: null,
  checkedAt: null,
  currentVersion: '0.0.0',
  message: null,
  progress: null,
  releaseNotes: null,
  status: 'idle',
  supported: false,
};

function resolveStatusText(snapshot: AppUpdateSnapshot): string {
  if (snapshot.message) return snapshot.message;
  switch (snapshot.status) {
    case 'checking':
      return '正在检查更新';
    case 'up-to-date':
      return '当前已经是最新版本';
    case 'available':
      return `发现新版本 v${snapshot.availableVersion}`;
    case 'downloading':
      return `正在下载 v${snapshot.availableVersion}`;
    case 'verifying':
      return `正在校验 v${snapshot.availableVersion}`;
    case 'downloaded':
      return `v${snapshot.availableVersion} 已准备完成`;
    case 'installing':
      return '正在退出并安装更新';
    case 'error':
      return '更新失败，请重试';
    case 'disabled':
      return '当前构建未启用应用内更新';
    default:
      return '可以检查是否有新版本';
  }
}

const AppUpdateSettings: React.FC = () => {
  const [snapshot, setSnapshot] = React.useState<AppUpdateSnapshot>(INITIAL_SNAPSHOT);

  React.useEffect(() => {
    let active = true;
    void getAppUpdateSnapshot().then((next) => {
      if (active) setSnapshot(next);
    });
    const unsubscribe = subscribeAppUpdate((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runAction = React.useCallback(async () => {
    try {
      if (snapshot.status === 'available') {
        setSnapshot(await downloadAppUpdate());
        return;
      }
      if (snapshot.status === 'downloaded') {
        setSnapshot(await installAppUpdate());
        return;
      }
      setSnapshot(await checkForAppUpdate());
    } catch (error: any) {
      Toast.error(error?.message || '更新操作失败');
    }
  }, [snapshot.status]);

  const busy = snapshot.status === 'checking'
    || snapshot.status === 'downloading'
    || snapshot.status === 'verifying'
    || snapshot.status === 'installing';
  const progressPercent = Math.max(0, Math.min(100, snapshot.progress?.percent ?? 0));
  const actionLabel = snapshot.status === 'available'
    ? '下载更新'
    : snapshot.status === 'downloaded'
      ? '重启并安装'
      : snapshot.status === 'checking'
        ? '检查中'
        : snapshot.status === 'downloading'
          ? `${Math.round(progressPercent)}%`
          : snapshot.status === 'verifying'
            ? '校验中'
            : snapshot.status === 'installing'
              ? '安装中'
              : '检查更新';
  const actionIcon = snapshot.status === 'available'
    ? <IconDownload />
    : snapshot.status === 'downloaded'
      ? <IconRestart />
      : <IconRefresh />;

  return (
    <div className="setting-item app-update-setting">
      <div className="app-update-copy">
        <div className="setting-title">软件更新</div>
        <div className={`setting-desc ${snapshot.status === 'error' ? 'is-error' : ''}`}>
          {resolveStatusText(snapshot)}
        </div>
        {snapshot.status === 'downloading' ? (
          <div className="app-update-progress" aria-label={`更新下载进度 ${Math.round(progressPercent)}%`}>
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        ) : null}
      </div>
      <div className="app-update-actions">
        <span className="app-version">v{snapshot.currentVersion}</span>
        <Button
          icon={actionIcon}
          theme={snapshot.status === 'downloaded' ? 'solid' : 'borderless'}
          type={snapshot.status === 'downloaded' ? 'primary' : 'tertiary'}
          className="settings-action-btn manage"
          disabled={!snapshot.supported || busy}
          loading={snapshot.status === 'checking'}
          onClick={() => {
            void runAction();
          }}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
};

export default AppUpdateSettings;

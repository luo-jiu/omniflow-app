import { appendFileSync, existsSync, statSync, truncateSync } from 'node:fs';
import path from 'node:path';

import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';

import type { AppUpdateSnapshot } from '@/features/app-update/types';
import { normalizeAppUpdateBaseUrl } from './appUpdateConfig';

export const APP_UPDATE_STATE_CHANNEL = 'app-update:state';

const AUTO_CHECK_DELAY_MS = 15_000;
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_LOG_FILENAME = 'app-update.log';
const MAX_UPDATE_LOG_BYTES = 1024 * 1024;
const MAC_UPDATE_VALIDATION_SETTLE_MS = 3_000;

interface AppUpdateServiceOptions {
  getMainWindow: () => BrowserWindow | null;
  updateBaseUrl?: string | null;
}

function normalizeReleaseNotes(info: UpdateInfo): string | null {
  const releaseNotes = info.releaseNotes;
  if (typeof releaseNotes === 'string') {
    return releaseNotes.trim() || null;
  }
  if (!Array.isArray(releaseNotes)) {
    return null;
  }
  const notes = releaseNotes
    .map(item => String(item?.note || '').trim())
    .filter(Boolean)
    .join('\n\n');
  return notes || null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || '未知更新错误');
}

function toUserErrorMessage(error: unknown): string {
  const message = toErrorMessage(error);
  if (/code signature|SQRLCodeSignatureErrorDomain/i.test(message)) {
    return '更新包未通过 macOS 代码签名校验';
  }
  return message;
}

export class AppUpdateService {
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly updateBaseUrl: string | null;
  private snapshot: AppUpdateSnapshot;
  private initialized = false;
  private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCheckInterval: ReturnType<typeof setInterval> | null = null;
  private activeOperation: Promise<AppUpdateSnapshot> | null = null;
  private validationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AppUpdateServiceOptions) {
    this.getMainWindow = options.getMainWindow;
    this.updateBaseUrl = normalizeAppUpdateBaseUrl(options.updateBaseUrl);
    const platformSupported = process.platform === 'darwin';
    const supported = platformSupported && app.isPackaged && Boolean(this.updateBaseUrl);
    const message = !platformSupported
      ? '当前仅在 macOS 启用应用内更新'
      : !app.isPackaged
        ? '开发模式不执行应用内更新'
        : !this.updateBaseUrl
          ? '当前安装包未配置更新地址'
          : null;
    this.snapshot = {
      availableVersion: null,
      checkedAt: null,
      currentVersion: app.getVersion(),
      message,
      progress: null,
      releaseNotes: null,
      status: supported ? 'idle' : 'disabled',
      supported,
    };
  }

  initialize() {
    if (this.initialized || !this.snapshot.supported || !this.updateBaseUrl) return;
    this.initialized = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: this.updateBaseUrl,
    });

    autoUpdater.on('checking-for-update', this.handleCheckingForUpdate);
    autoUpdater.on('update-available', this.handleUpdateAvailable);
    autoUpdater.on('update-not-available', this.handleUpdateNotAvailable);
    autoUpdater.on('download-progress', this.handleDownloadProgress);
    autoUpdater.on('update-downloaded', this.handleUpdateDownloaded);
    autoUpdater.on('error', this.handleError);

    this.writeLog('info', `updater initialized for ${process.platform} ${process.arch}`);
    this.autoCheckTimer = setTimeout(() => {
      this.autoCheckTimer = null;
      void this.check();
    }, AUTO_CHECK_DELAY_MS);
    this.autoCheckInterval = setInterval(() => {
      void this.check();
    }, AUTO_CHECK_INTERVAL_MS);
  }

  dispose() {
    if (this.autoCheckTimer) clearTimeout(this.autoCheckTimer);
    if (this.autoCheckInterval) clearInterval(this.autoCheckInterval);
    if (this.validationTimer) clearTimeout(this.validationTimer);
    this.autoCheckTimer = null;
    this.autoCheckInterval = null;
    this.validationTimer = null;
    if (!this.initialized) return;
    autoUpdater.removeListener('checking-for-update', this.handleCheckingForUpdate);
    autoUpdater.removeListener('update-available', this.handleUpdateAvailable);
    autoUpdater.removeListener('update-not-available', this.handleUpdateNotAvailable);
    autoUpdater.removeListener('download-progress', this.handleDownloadProgress);
    autoUpdater.removeListener('update-downloaded', this.handleUpdateDownloaded);
    autoUpdater.removeListener('error', this.handleError);
    this.initialized = false;
  }

  getState(): AppUpdateSnapshot {
    return { ...this.snapshot, progress: this.snapshot.progress ? { ...this.snapshot.progress } : null };
  }

  check(): Promise<AppUpdateSnapshot> {
    return this.runOperation(async () => {
      this.assertSupported();
      if (
        this.snapshot.status === 'downloading'
        || this.snapshot.status === 'verifying'
        || this.snapshot.status === 'downloaded'
      ) {
        return this.getState();
      }
      this.patchState({
        message: null,
        progress: null,
        status: 'checking',
      });
      await autoUpdater.checkForUpdates();
      return this.getState();
    });
  }

  download(): Promise<AppUpdateSnapshot> {
    return this.runOperation(async () => {
      this.assertSupported();
      if (this.snapshot.status !== 'available') {
        throw new Error('当前没有可下载的更新');
      }
      this.patchState({ message: null, progress: null, status: 'downloading' });
      await autoUpdater.downloadUpdate();
      return this.getState();
    });
  }

  async install(): Promise<AppUpdateSnapshot> {
    this.assertSupported();
    if (this.snapshot.status !== 'downloaded') {
      throw new Error('更新尚未下载完成');
    }
    this.patchState({ message: null, status: 'installing' });
    this.writeLog('info', `installing ${this.snapshot.availableVersion || 'downloaded update'}`);
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
      if (process.platform === 'darwin') {
        app.quit();
      }
    });
    return this.getState();
  }

  private runOperation(operation: () => Promise<AppUpdateSnapshot>): Promise<AppUpdateSnapshot> {
    if (this.activeOperation) return this.activeOperation;
    const promise = operation()
      .catch((error) => {
        this.setError(error);
        return this.getState();
      })
      .finally(() => {
        if (this.activeOperation === promise) {
          this.activeOperation = null;
        }
      });
    this.activeOperation = promise;
    return promise;
  }

  private assertSupported() {
    if (!this.snapshot.supported) {
      throw new Error(this.snapshot.message || '当前构建不支持应用内更新');
    }
  }

  private patchState(patch: Partial<AppUpdateSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(APP_UPDATE_STATE_CHANNEL, this.getState());
    }
  }

  private setError(error: unknown) {
    if (this.validationTimer) {
      clearTimeout(this.validationTimer);
      this.validationTimer = null;
    }
    this.writeLog('error', toErrorMessage(error));
    this.patchState({ message: toUserErrorMessage(error), status: 'error' });
  }

  private writeLog(level: 'info' | 'warn' | 'error', message: string) {
    try {
      const logPath = path.join(app.getPath('userData'), UPDATE_LOG_FILENAME);
      if (existsSync(logPath) && statSync(logPath).size > MAX_UPDATE_LOG_BYTES) {
        truncateSync(logPath, 0);
      }
      appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8');
    } catch {
      // Update logging must never block update checks or installation.
    }
  }

  private handleCheckingForUpdate = () => {
    this.patchState({ message: null, status: 'checking' });
  };

  private handleUpdateAvailable = (info: UpdateInfo) => {
    this.writeLog('info', `update available: ${info.version}`);
    this.patchState({
      availableVersion: info.version,
      checkedAt: Date.now(),
      message: null,
      progress: null,
      releaseNotes: normalizeReleaseNotes(info),
      status: 'available',
    });
  };

  private handleUpdateNotAvailable = () => {
    this.writeLog('info', 'no update available');
    this.patchState({
      availableVersion: null,
      checkedAt: Date.now(),
      message: null,
      progress: null,
      releaseNotes: null,
      status: 'up-to-date',
    });
  };

  private handleDownloadProgress = (progress: ProgressInfo) => {
    this.patchState({
      message: null,
      progress: {
        bytesPerSecond: progress.bytesPerSecond,
        percent: progress.percent,
        total: progress.total,
        transferred: progress.transferred,
      },
      status: 'downloading',
    });
  };

  private handleUpdateDownloaded = (info: UpdateInfo) => {
    this.writeLog('info', `update downloaded: ${info.version}`);
    this.patchState({
      availableVersion: info.version,
      message: `正在校验 v${info.version}`,
      progress: null,
      releaseNotes: normalizeReleaseNotes(info),
      status: 'verifying',
    });
    if (this.validationTimer) clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.validationTimer = null;
      this.patchState({ message: null, status: 'downloaded' });
    }, MAC_UPDATE_VALIDATION_SETTLE_MS);
  };

  private handleError = (error: Error) => {
    this.setError(error);
  };
}

export function createAppUpdateService(options: AppUpdateServiceOptions) {
  return new AppUpdateService(options);
}

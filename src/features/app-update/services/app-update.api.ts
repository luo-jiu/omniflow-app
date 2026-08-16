import type { AppUpdateSnapshot } from '../types';

const FALLBACK_SNAPSHOT: AppUpdateSnapshot = {
  availableVersion: null,
  checkedAt: null,
  currentVersion: '0.0.0',
  message: '当前环境不支持应用内更新',
  progress: null,
  releaseNotes: null,
  status: 'disabled',
  supported: false,
};

function getBridge() {
  return window.electronAppUpdate;
}

export async function getAppUpdateSnapshot(): Promise<AppUpdateSnapshot> {
  const bridge = getBridge();
  return bridge ? bridge.getState() : FALLBACK_SNAPSHOT;
}

export async function checkForAppUpdate(): Promise<AppUpdateSnapshot> {
  const bridge = getBridge();
  return bridge ? bridge.check() : FALLBACK_SNAPSHOT;
}

export async function downloadAppUpdate(): Promise<AppUpdateSnapshot> {
  const bridge = getBridge();
  return bridge ? bridge.download() : FALLBACK_SNAPSHOT;
}

export async function installAppUpdate(): Promise<AppUpdateSnapshot> {
  const bridge = getBridge();
  return bridge ? bridge.install() : FALLBACK_SNAPSHOT;
}

export function subscribeAppUpdate(listener: (snapshot: AppUpdateSnapshot) => void): () => void {
  return getBridge()?.onStateChange(listener) ?? (() => {});
}

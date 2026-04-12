import type { EmbeddedBrowserDownloadEvent } from '../types';

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器下载导入');
  }
}

export function subscribeEmbeddedBrowserDownloads(
  listener: (payload: EmbeddedBrowserDownloadEvent) => void,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.onDownload(listener);
}

export async function cleanupEmbeddedBrowserDownloadedFile(tempPath?: string) {
  if (!tempPath) {
    return false;
  }
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.cleanupDownloadFile(tempPath);
}

export async function saveEmbeddedBrowserDownloadToDesktop(
  tempPath: string,
  defaultFileName: string,
): Promise<{ canceled: boolean; filePath: string }> {
  assertDesktopSupport();
  const saveResult = await window.electronAPI.saveDownloadFile(defaultFileName);
  if (!saveResult || saveResult.canceled || !saveResult.filePath) {
    return { canceled: true, filePath: '' };
  }
  const filePath = await window.electronAPI.saveStagedDownloadFile(tempPath, String(saveResult.filePath));
  return {
    canceled: false,
    filePath: String(filePath),
  };
}

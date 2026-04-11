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

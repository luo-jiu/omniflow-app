import type { EmbeddedBrowserCatchToolkitState } from '../types';

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持页内捕捉工具');
  }
}

export async function getEmbeddedBrowserCatchToolkitState(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.getCatchToolkitState(tabId) as Promise<EmbeddedBrowserCatchToolkitState | null>;
}

export async function updateEmbeddedBrowserCatchToolkitState(
  tabId: string,
  payload: Partial<EmbeddedBrowserCatchToolkitState>,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.updateCatchToolkitState(tabId, payload) as Promise<EmbeddedBrowserCatchToolkitState | null>;
}

export async function clearEmbeddedBrowserCatchMediaCache(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.clearCatchMediaCache(tabId) as Promise<boolean>;
}

export async function downloadEmbeddedBrowserCatchMedia(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadCatchMedia(tabId) as Promise<boolean>;
}

export async function restartEmbeddedBrowserCatchMediaCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.restartCatchMediaCapture(tabId) as Promise<boolean>;
}

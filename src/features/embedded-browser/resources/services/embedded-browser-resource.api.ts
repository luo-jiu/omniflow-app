import type {
  EmbeddedBrowserCapturedResource,
  EmbeddedBrowserResourceCaptureSnapshot,
} from '../types';

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器资源捕获');
  }
}

export function subscribeEmbeddedBrowserResources(
  listener: (payload: EmbeddedBrowserCapturedResource) => void,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.onResourceCaptured(listener);
}

export async function listEmbeddedBrowserCapturedResources(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.listCapturedResources(tabId) as Promise<EmbeddedBrowserResourceCaptureSnapshot>;
}

export async function startEmbeddedBrowserResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.startResourceCapture(tabId) as Promise<EmbeddedBrowserResourceCaptureSnapshot>;
}

export async function stopEmbeddedBrowserResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.stopResourceCapture(tabId) as Promise<EmbeddedBrowserResourceCaptureSnapshot>;
}

export async function startEmbeddedBrowserDeepResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.startDeepResourceCapture(tabId) as Promise<EmbeddedBrowserResourceCaptureSnapshot>;
}

export async function clearEmbeddedBrowserCapturedResources(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.clearCapturedResources(tabId) as Promise<EmbeddedBrowserResourceCaptureSnapshot>;
}

export async function openEmbeddedBrowserCapturedResource(tabId: string, resourceKey: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.openCapturedResource(tabId, resourceKey) as Promise<boolean>;
}

export async function exportEmbeddedBrowserCapturedResource(tabId: string, resourceKey: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.exportCapturedResource(tabId, resourceKey) as Promise<boolean>;
}

export async function readEmbeddedBrowserCapturedResource(tabId: string, resourceKey: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.readCapturedResource(tabId, resourceKey) as Promise<{
    base64: string;
    fileName: string;
    mimeType?: string;
    resourceKey: string;
    streamType?: 'audio' | 'video';
  } | null>;
}

export async function previewEmbeddedBrowserCapturedResource(
  tabId: string,
  payload: {
    mimeType?: string;
    streamType?: 'audio' | 'video';
    title?: string;
    url: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.previewCapturedResource(tabId, payload) as Promise<boolean>;
}

export async function mergeEmbeddedBrowserCapturedMseResources(
  tabId: string,
  payload: {
    audioResourceKey?: string;
    ffmpegPath?: string;
    suggestedFileName?: string;
    videoResourceKey?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.mergeCapturedMseResources(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

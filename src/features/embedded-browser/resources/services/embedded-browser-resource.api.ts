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

export function subscribeEmbeddedBrowserHlsTask(
  listener: (payload: {
    bytesReceived?: number;
    bytesTotal?: number;
    completedFragments?: number;
    durationSeconds?: number;
    error?: string;
    etaSeconds?: number;
    ffmpegSpeedText?: string;
    failedFragments?: number[];
    manifestUrl: string;
    message?: string;
    mode: 'direct-manifest' | 'local-plan';
    outputPath?: string;
    processedSeconds?: number;
    requestId?: string;
    speedBps?: number;
    stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error';
    status: 'running' | 'success' | 'error';
    tabId: string;
    totalFragments?: number;
    usingManualKey?: boolean;
  }) => void,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.onHlsTask(listener);
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

export async function clearEmbeddedBrowserCacheAndReload(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.clearCacheAndReload(tabId) as Promise<boolean>;
}

export async function resetEmbeddedBrowserPageStorageAndReload(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.resetPageStorageAndReload(tabId) as Promise<boolean>;
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

export async function saveEmbeddedBrowserCapturedResource(
  tabId: string,
  payload: {
    resourceKey?: string;
    suggestedFileName?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.saveCapturedResource(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ok: boolean;
    outputPath?: string;
  }>;
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
    audioResource?: {
      fileName?: string;
      mimeType?: string;
      requestHeaders?: Record<string, string>;
      resourceKey?: string;
      streamType?: 'audio' | 'video';
      url?: string;
    };
    audioResourceKey?: string;
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
    videoResource?: {
      fileName?: string;
      mimeType?: string;
      requestHeaders?: Record<string, string>;
      resourceKey?: string;
      streamType?: 'audio' | 'video';
      url?: string;
    };
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

export async function transcodeEmbeddedBrowserCapturedResource(
  tabId: string,
  payload: {
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    outputFormat?: string;
    resource?: {
      fileName?: string;
      mimeType?: string;
      requestHeaders?: Record<string, string>;
      resourceKey?: string;
      streamType?: 'audio' | 'video';
      url?: string;
    };
    resourceKey?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.transcodeCapturedResource(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function downloadEmbeddedBrowserHlsManifest(
  tabId: string,
  payload: {
    durationSeconds?: number;
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    outputDirectoryPath?: string;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadHlsManifest(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function startEmbeddedBrowserHlsRecording(
  tabId: string,
  payload: {
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    manualKeyBase64?: string;
    outputDirectoryPath?: string;
    pageUrl?: string;
    requestId?: string;
    suggestedFileName?: string;
    suggestedThreadCount?: number;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.startHlsRecording(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ok: boolean;
    requestId?: string;
  }>;
}

export async function stopEmbeddedBrowserHlsRecording(
  tabId: string,
  payload: {
    requestId?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.stopHlsRecording(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function discardEmbeddedBrowserHlsRecording(
  tabId: string,
  payload: {
    requestId?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.discardHlsRecording(tabId, payload) as Promise<{
    error?: string;
    ok: boolean;
  }>;
}

export async function downloadEmbeddedBrowserHlsTracks(
  tabId: string,
  payload: {
    audioManifestUrl?: string;
    durationSeconds?: number;
    ffmpegPath?: string;
    headers?: Record<string, string>;
    outputDirectoryPath?: string;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
    videoManifestUrl?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadHlsTracks(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function downloadEmbeddedBrowserHlsPlan(
  tabId: string,
  payload: {
    ffmpegPath?: string;
    manualKeyBase64?: string;
    outputDirectoryPath?: string;
    plan: import('../model/embedded-browser-hls-manifest').EmbeddedBrowserHlsDownloadPlan;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadHlsPlan(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function downloadEmbeddedBrowserDirectFile(
  tabId: string,
  payload: {
    headers?: Record<string, string>;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    url?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadDirectFile(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function retryEmbeddedBrowserHlsPlanFailed(
  tabId: string,
  payload: {
    requestId?: string;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.retryHlsPlanFailed(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

export async function downloadEmbeddedBrowserMpdManifest(
  tabId: string,
  payload: {
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadMpdManifest(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

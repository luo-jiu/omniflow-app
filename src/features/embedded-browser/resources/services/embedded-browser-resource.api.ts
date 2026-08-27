import type {
  EmbeddedBrowserResourceStateChange,
  EmbeddedBrowserResourceStateSnapshot,
} from '../types';

export type EmbeddedBrowserHlsTaskProjection = {
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
  revision: number;
  speedBps?: number;
  stage: 'preparing' | 'downloading-fragments' | 'rewriting-playlist' | 'ffmpeg' | 'completed' | 'error';
  status: 'running' | 'success' | 'error';
  tabId: string;
  totalFragments?: number;
  usingManualKey?: boolean;
};

function assertDesktopSupport() {
  if (!window.electronEmbeddedBrowser) {
    throw new Error('当前环境不支持浏览器资源捕获');
  }
}

export function subscribeEmbeddedBrowserResources(
  listener: (payload: EmbeddedBrowserResourceStateChange) => void,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.onResourceStateChange(listener);
}

export async function listEmbeddedBrowserCapturedResources(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.listCapturedResources(tabId) as Promise<EmbeddedBrowserResourceStateSnapshot | null>;
}

export function subscribeEmbeddedBrowserHlsTask(
  listener: (payload: EmbeddedBrowserHlsTaskProjection) => void,
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.onHlsTask(listener);
}

export async function listEmbeddedBrowserHlsTaskSnapshots(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.listHlsTaskSnapshots(tabId) as Promise<EmbeddedBrowserHlsTaskProjection[]>;
}

export async function startEmbeddedBrowserResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.startResourceCapture(tabId) as Promise<EmbeddedBrowserResourceStateSnapshot | null>;
}

export async function stopEmbeddedBrowserResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.stopResourceCapture(tabId) as Promise<EmbeddedBrowserResourceStateSnapshot | null>;
}

export async function startEmbeddedBrowserDeepResourceCapture(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.startDeepResourceCapture(tabId) as Promise<EmbeddedBrowserResourceStateSnapshot | null>;
}

export async function clearEmbeddedBrowserCapturedResources(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.clearCapturedResources(tabId) as Promise<EmbeddedBrowserResourceStateSnapshot | null>;
}

export async function inspectEmbeddedBrowserCapturedResource(
  tabId: string,
  resourceId: string,
  encoding: 'base64' | 'utf8',
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.inspectCapturedResource(tabId, resourceId, encoding);
}

export async function clearEmbeddedBrowserCacheAndReload(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.clearCacheAndReload(tabId) as Promise<boolean>;
}

export async function resetEmbeddedBrowserPageStorageAndReload(tabId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.resetPageStorageAndReload(tabId) as Promise<boolean>;
}

export async function openEmbeddedBrowserCapturedResource(tabId: string, resourceId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.openCapturedResource(tabId, resourceId) as Promise<boolean>;
}

export async function exportEmbeddedBrowserCapturedResource(tabId: string, resourceId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.exportCapturedResource(tabId, resourceId) as Promise<boolean>;
}

export async function readEmbeddedBrowserCapturedResource(tabId: string, resourceId: string) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.readCapturedResource(tabId, resourceId) as Promise<{
    base64: string;
    fileName: string;
    mimeType?: string;
    streamType?: 'audio' | 'video';
  } | null>;
}

export async function saveEmbeddedBrowserCapturedResource(
  tabId: string,
  payload: {
    resourceId?: string;
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
    audioResourceId?: string;
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
    videoResourceId?: string;
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
    resourceId?: string;
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
    outputDirectoryPath?: string;
    resourceId: string;
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
    resourceId?: string;
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
    audioResourceId: string;
    durationSeconds?: number;
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
    videoResourceId: string;
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
    resourceId?: string;
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

export async function downloadEmbeddedBrowserCapturedResource(
  tabId: string,
  payload: {
    outputDirectoryPath?: string;
    resourceId: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadCapturedResource(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
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
    resourceId?: string;
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

export async function downloadEmbeddedBrowserMpdPlan(
  tabId: string,
  payload: {
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    plan: import('../model/embedded-browser-mpd-manifest').EmbeddedBrowserMpdDownloadPlan;
    resourceId?: string;
    requestId?: string;
    selectedAudioRepresentationId?: string;
    selectedVideoRepresentationId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  },
) {
  assertDesktopSupport();
  return window.electronEmbeddedBrowser.downloadMpdPlan(tabId, payload) as Promise<{
    cancelled?: boolean;
    error?: string;
    ffmpegPath?: string;
    ok: boolean;
    outputPath?: string;
  }>;
}

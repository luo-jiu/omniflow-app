/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer

  electronAPI: {
    openTextFile: () => Promise<{
      canceled: boolean;
      content: string;
      filePath: string;
    }>;
    readLocalChromeBookmarks: () => Promise<{
      canceled: boolean;
      content: string;
      filePath: string;
    }>;
    readTextFile: (filePath: string) => Promise<{
      canceled: boolean;
      content: string;
      filePath: string;
    }>;
    pickUploadFiles: () => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    pickUploadFolders: () => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    pickDownloadDirectory: () => Promise<{
      canceled: boolean;
      directoryPath: string;
    }>;
    saveDownloadFile: (defaultFileName: string) => Promise<{
      canceled: boolean;
      filePath: string;
    }>;
    pickAutoImportDirectory: () => Promise<{
      canceled: boolean;
      directoryPath: string;
    }>;
    ensureDirectory: (baseDirectory: string, relativePath: string) => Promise<string>;
    saveStagedDownloadFile: (stagedPath: string, targetFilePath: string) => Promise<string>;
    downloadUrlToPath: (
      url: string,
      baseDirectory: string,
      relativePath: string,
      headers?: Record<string, string>,
    ) => Promise<string>;
    claimAutoImportFiles: (watchDirectory: string, maxFiles?: number) => Promise<{
      canceled: boolean;
      files: Array<{
        name: string;
        size: number;
        localPath: string;
        relativePath: string;
      }>;
    }>;
    cleanupAutoImportStagedFile: (stagedPath: string) => Promise<boolean>;
    onUploadProgress: (listener: (payload: {
      uploadId: string;
      uploadedBytes: number;
      totalBytes: number;
      percentage: number;
      speedBps: number;
    }) => void) => () => void;
    getStaticData: () => Promise<{
      totalStorage: number;
      cpuModel: string;
      totalMemoryGB: number;
    }>;
    fetch: (
      url: string,
      options?: any
    ) => Promise<{
      status: number;
      headers: Record<string, string | string[]>;
      body: any;
    }>;
    fetchBinary: (
      url: string,
      options?: any
    ) => Promise<{
      status: number;
      headers: Record<string, string | string[]>;
      base64: string;
      receivedBytes: number;
      truncated: boolean;
    }>;
    upload: (
      url: string,
      filePath: string,
      formDataParams?: Record<string, string>,
      headers?: Record<string, string>,
      uploadId?: string
    ) => Promise<{
      status: number;
      body: any;
    }>;
    uploadAbort: (uploadId: string) => Promise<boolean>;
  };

  electronWindow: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    activate: (temporaryOnTop?: boolean) => Promise<boolean>;
  };
}

type EmbeddedBrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EmbeddedBrowserCapturedResource = {
  capturedAt: number;
  contentLength?: number;
  ext?: string;
  id: string;
  kind: 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other';
  method?: string;
  mimeType?: string;
  pageUrl?: string;
  referer?: string;
  resourceKey?: string;
  requestHeaders?: Record<string, string>;
  resourceType?: string;
  source: 'network' | 'probe';
  statusCode?: number;
  streamType?: 'audio' | 'video';
  tabId: string;
  url: string;
};

type EmbeddedBrowserResourceCaptureSnapshot = {
  deepCaptureEnabled: boolean;
  enabled: boolean;
  resources: EmbeddedBrowserCapturedResource[];
};

type EmbeddedBrowserCapturedResourceMergeResponse = {
  cancelled?: boolean;
  error?: string;
  ffmpegPath?: string;
  ok: boolean;
  outputPath?: string;
};

type EmbeddedBrowserCatchToolkitState = {
  autoSeekToBufferedEnd: boolean;
  autoDownloadOnComplete: boolean;
  capturedMediaSizeBytes: number;
  clearCacheOnComplete: boolean;
  currentFileName: string;
  isCaptureComplete: boolean;
  manualFileName: string;
  regexWarning: string;
  regexRule: string;
  restartAlwaysFromBeginning: boolean;
  selectorWarning: string;
  selectorRule: string;
  streamCount: number;
  trimExtraMediaHeaders: boolean;
};

interface Window {
  electronEmbeddedBrowser: {
    activateTab: (tabId: string | null) => Promise<void>;
    cleanupDownloadFile: (tempPath: string) => Promise<boolean>;
    clearCapturedResources: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    closeAll: () => Promise<void>;
    closeTab: (tabId: string) => Promise<void>;
    deactivate: () => Promise<void>;
    exportCapturedResource: (tabId: string, resourceKey: string) => Promise<boolean>;
    goBack: (tabId: string) => Promise<void>;
    goForward: (tabId: string) => Promise<void>;
    listCapturedResources: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    navigate: (tabId: string, url: string) => Promise<void>;
    openCapturedResource: (tabId: string, resourceKey: string) => Promise<boolean>;
    previewCapturedResource: (tabId: string, payload: {
      mimeType?: string;
      streamType?: 'audio' | 'video';
      title?: string;
      url: string;
    }) => Promise<boolean>;
    readCapturedResource: (tabId: string, resourceKey: string) => Promise<{
      base64: string;
      fileName: string;
      mimeType?: string;
      resourceKey: string;
      streamType?: 'audio' | 'video';
    } | null>;
    mergeCapturedMseResources: (tabId: string, payload: {
      audioResourceKey?: string;
      ffmpegPath?: string;
      suggestedFileName?: string;
      videoResourceKey?: string;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    getCatchToolkitState: (tabId: string) => Promise<EmbeddedBrowserCatchToolkitState | null>;
    updateCatchToolkitState: (
      tabId: string,
      payload: Partial<EmbeddedBrowserCatchToolkitState>,
    ) => Promise<EmbeddedBrowserCatchToolkitState | null>;
    clearCatchMediaCache: (tabId: string) => Promise<boolean>;
    downloadCatchMedia: (tabId: string) => Promise<boolean>;
    restartCatchMediaCapture: (tabId: string) => Promise<boolean>;
    openMappedFile: (tabId: string, pageUrl: string, sourceUrl: string, fileName: string) => Promise<void>;
    resolveFavicon: (payload: { iconUrl?: string; pageUrl?: string }) => Promise<{
      dataUrl: string;
      iconUrl: string;
    }>;
    onStateChange: (listener: (payload: {
      canGoBack?: boolean;
      canGoForward?: boolean;
      details?: string;
      iconSourceUrl?: string;
      iconUrl?: string;
      message?: string;
      meta?: string[];
      state?: 'idle' | 'loading' | 'ready' | 'error';
      tabId?: string;
      title?: string;
      url?: string;
    }) => void) => () => void;
    onDownload: (listener: (payload: {
      downloadId: string;
      error?: string;
      fileName: string;
      mimeType?: string;
      pageUrl?: string;
      receivedBytes: number;
      state: 'started' | 'progress' | 'completed' | 'cancelled' | 'failed';
      tabId?: string;
      tempPath?: string;
      totalBytes: number;
      url: string;
    }) => void) => () => void;
    onResourceCaptured: (listener: (payload: EmbeddedBrowserCapturedResource) => void) => () => void;
    openTab: (tabId: string, url?: string) => Promise<void>;
    reload: (tabId: string) => Promise<void>;
    setBounds: (bounds: EmbeddedBrowserBounds) => Promise<void>;
    startDeepResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    startResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    stopResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
  };
}

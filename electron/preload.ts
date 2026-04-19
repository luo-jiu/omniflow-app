// 渲染进程中的Bridge API
import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

contextBridge.exposeInMainWorld('electronAPI', {
  getStaticData: () => ipcRenderer.invoke('sys:get-static-data'),
  openTextFile: (options?: {
    filters?: Array<{
      name: string;
      extensions: string[];
    }>;
  }) => ipcRenderer.invoke('file:open', options),
  readLocalChromeBookmarks: () => ipcRenderer.invoke('file:read-local-chrome-bookmarks'),
  readTextFile: (filePath: string) => ipcRenderer.invoke('file:read-text', filePath),
  writeTextFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-text-file', filePath, content),
  pickUploadFiles: () => ipcRenderer.invoke('dialog:pick-upload-files'),
  pickUploadFolders: () => ipcRenderer.invoke('dialog:pick-upload-folders'),
  pickDownloadDirectory: () => ipcRenderer.invoke('dialog:pick-download-directory'),
  saveDownloadFile: (
    defaultFileName: string,
    options?: {
      filters?: Array<{
        name: string;
        extensions: string[];
      }>;
    },
  ) => ipcRenderer.invoke('dialog:save-download-file', defaultFileName, options),
  pickAutoImportDirectory: () => ipcRenderer.invoke('dialog:pick-auto-import-directory'),
  ensureDirectory: (baseDirectory: string, relativePath: string) =>
    ipcRenderer.invoke('fs:ensure-directory', baseDirectory, relativePath),
  saveStagedDownloadFile: (stagedPath: string, targetFilePath: string) =>
    ipcRenderer.invoke('fs:save-staged-download-file', stagedPath, targetFilePath),
  downloadUrlToPath: (
    url: string,
    baseDirectory: string,
    relativePath: string,
    headers?: Record<string, string>,
  ) => ipcRenderer.invoke('fs:download-url-to-path', url, baseDirectory, relativePath, headers),
  claimAutoImportFiles: (watchDirectory: string, maxFiles?: number) =>
    ipcRenderer.invoke('fs:claim-auto-import-files', watchDirectory, maxFiles),
  cleanupAutoImportStagedFile: (stagedPath: string) =>
    ipcRenderer.invoke('fs:cleanup-auto-import-staged-file', stagedPath),
  createStagedTextFile: (fileName: string, content: string) =>
    ipcRenderer.invoke('fs:create-staged-text-file', fileName, content),
  cleanupStagedTextFile: (stagedPath: string) =>
    ipcRenderer.invoke('fs:cleanup-staged-text-file', stagedPath),
  fetch: (url: string, options?: any) => ipcRenderer.invoke('http:fetch', url, options),
  fetchBinary: (url: string, options?: any) => ipcRenderer.invoke('http:fetch-binary', url, options),
  upload: (
    url: string,
    filePath: string,
    formDataParams?: Record<string, string>,
    headers?: Record<string, string>,
    uploadId?: string,
  ) => ipcRenderer.invoke('http:upload', url, filePath, formDataParams, headers, uploadId),
  uploadAbort: (uploadId: string) => ipcRenderer.invoke('http:upload:abort', uploadId),
  onUploadProgress: (listener: (payload: {
    uploadId: string;
    uploadedBytes: number;
    totalBytes: number;
    percentage: number;
    speedBps: number;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      uploadId: string;
      uploadedBytes: number;
      totalBytes: number;
      percentage: number;
      speedBps: number;
    }) => {
      listener(payload);
    };
    ipcRenderer.on('http:upload:progress', wrapped);
    return () => ipcRenderer.removeListener('http:upload:progress', wrapped);
  },
})

// 窗口控制 API
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  activate: (temporaryOnTop = false) => ipcRenderer.invoke('window-activate', temporaryOnTop),
  setThemeSource: (source: 'light' | 'dark' | 'system') => ipcRenderer.send('window-set-theme-source', source),
});

contextBridge.exposeInMainWorld('electronOverlay', {
  open: (type: string, props: unknown) =>
    ipcRenderer.invoke('overlay:open', { type, props }),
});

contextBridge.exposeInMainWorld('electronOverlayHost', {
  onShow: (listener: (spec: { requestId: string; type: string; props: unknown }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, spec: { requestId: string; type: string; props: unknown }) => {
      listener(spec);
    };
    ipcRenderer.on('overlay:host:show', wrapped);
    return () => ipcRenderer.removeListener('overlay:host:show', wrapped);
  },
  onDismissFromMain: (listener: (payload: { requestId: string }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { requestId: string }) => {
      listener(payload);
    };
    ipcRenderer.on('overlay:host:dismiss-from-main', wrapped);
    return () => ipcRenderer.removeListener('overlay:host:dismiss-from-main', wrapped);
  },
  resolve: (requestId: string, result: unknown) =>
    ipcRenderer.send('overlay:host:resolve', { requestId, result }),
  dismiss: (requestId: string, reason?: string) =>
    ipcRenderer.send('overlay:host:dismiss', { requestId, reason }),
  reportReady: () => ipcRenderer.send('overlay:host:ready'),
});

contextBridge.exposeInMainWorld('electronEmbeddedBrowser', {
  activateTab: (tabId: string | null) => ipcRenderer.invoke('embedded-browser:activate-tab', tabId),
  cleanupDownloadFile: (tempPath: string) => ipcRenderer.invoke('embedded-browser:cleanup-download-file', tempPath),
  closeAll: () => ipcRenderer.invoke('embedded-browser:close-all'),
  closeTab: (tabId: string) => ipcRenderer.invoke('embedded-browser:close-tab', tabId),
  deactivate: () => ipcRenderer.invoke('embedded-browser:deactivate'),
  goBack: (tabId: string) => ipcRenderer.invoke('embedded-browser:go-back', tabId),
  goForward: (tabId: string) => ipcRenderer.invoke('embedded-browser:go-forward', tabId),
  navigate: (tabId: string, url: string) => ipcRenderer.invoke('embedded-browser:navigate', tabId, url),
  openMappedFile: (
    tabId: string,
    pageUrl: string,
    sourceUrl: string,
    fileName: string,
  ) => ipcRenderer.invoke('embedded-browser:open-mapped-file', tabId, pageUrl, sourceUrl, fileName),
  resolveFavicon: (payload: { iconUrl?: string; pageUrl?: string }) =>
    ipcRenderer.invoke('embedded-browser:resolve-favicon', payload),
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
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
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
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:state', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:state', wrapped);
  },
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
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
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
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:download', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:download', wrapped);
  },
  onResourceCaptured: (listener: (payload: {
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
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
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
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:resource', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:resource', wrapped);
  },
  openTab: (tabId: string, url?: string) => ipcRenderer.invoke('embedded-browser:open-tab', tabId, url),
  exportCapturedResource: (tabId: string, resourceKey: string) =>
    ipcRenderer.invoke('embedded-browser:resource:export', tabId, resourceKey),
  listCapturedResources: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:list', tabId),
  openCapturedResource: (tabId: string, resourceKey: string) =>
    ipcRenderer.invoke('embedded-browser:resource:open', tabId, resourceKey),
  readCapturedResource: (tabId: string, resourceKey: string) =>
    ipcRenderer.invoke('embedded-browser:resource:read', tabId, resourceKey),
  saveCapturedResource: (tabId: string, payload: {
    resourceKey?: string;
    suggestedFileName?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:save', tabId, payload),
  previewCapturedResource: (tabId: string, payload: {
    mimeType?: string;
    streamType?: 'audio' | 'video';
    title?: string;
    url: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:preview', tabId, payload),
  getCatchToolkitState: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:catch-toolkit:get-state', tabId),
  updateCatchToolkitState: (tabId: string, payload: {
    autoSeekToBufferedEnd?: boolean;
    autoDownloadOnComplete?: boolean;
    capturedMediaSizeBytes?: number;
    clearCacheOnComplete?: boolean;
    currentFileName?: string;
    isCaptureComplete?: boolean;
    manualFileName?: string;
    regexWarning?: string;
    regexRule?: string;
    restartAlwaysFromBeginning?: boolean;
    selectorWarning?: string;
    selectorRule?: string;
    streamCount?: number;
    trimExtraMediaHeaders?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:catch-toolkit:update-state', tabId, payload),
  clearCatchMediaCache: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:catch-toolkit:clear-cache', tabId),
  clearCacheAndReload: (tabId: string) => ipcRenderer.invoke('embedded-browser:clear-cache-reload', tabId),
  resetPageStorageAndReload: (tabId: string) => ipcRenderer.invoke('embedded-browser:reset-page-storage', tabId),
  downloadCatchMedia: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:catch-toolkit:download', tabId),
  restartCatchMediaCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:catch-toolkit:restart', tabId),
  mergeCapturedMseResources: (tabId: string, payload: {
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
    suggestedFileName?: string;
    videoResource?: {
      fileName?: string;
      mimeType?: string;
      requestHeaders?: Record<string, string>;
      resourceKey?: string;
      streamType?: 'audio' | 'video';
      url?: string;
    };
    videoResourceKey?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:merge-mse', tabId, payload),
  transcodeCapturedResource: (tabId: string, payload: {
    ffmpegPath?: string;
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
  }) => ipcRenderer.invoke('embedded-browser:resource:transcode', tabId, payload),
  downloadHlsManifest: (tabId: string, payload: {
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    suggestedFileName?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-hls', tabId, payload),
  downloadMpdManifest: (tabId: string, payload: {
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    suggestedFileName?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-mpd', tabId, payload),
  reload: (tabId: string) => ipcRenderer.invoke('embedded-browser:reload', tabId),
  startDeepResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:start-deep-capture', tabId),
  startResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:start', tabId),
  stopResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:stop', tabId),
  clearCapturedResources: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:clear', tabId),
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('embedded-browser:set-bounds', bounds),
});

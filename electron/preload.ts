// 渲染进程中的Bridge API
import { ipcRenderer, contextBridge } from 'electron'
import type { EmbeddedBrowserCaptureRuleSet } from '@/features/embedded-browser/resources/model/embedded-browser-capture-rules'
import type {
  EmbeddedBrowserExternalToolDispatchPayload,
  EmbeddedBrowserExternalToolKey,
  EmbeddedBrowserExternalToolOption,
  EmbeddedBrowserExternalToolSettings,
} from '@/features/embedded-browser/external-tools/model/embedded-browser-external-tools'
import type { AppUpdateSnapshot } from '@/features/app-update/types'

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
  getDownloadDirectory: () => ipcRenderer.invoke('fs:get-download-directory'),
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
  createStagedBinaryFile: (fileName: string, base64: string) =>
    ipcRenderer.invoke('fs:create-staged-binary-file', fileName, base64),
  createTempImportDirectory: () =>
    ipcRenderer.invoke('fs:create-temp-import-directory'),
  getTempImportFileInfo: (filePath: string) =>
    ipcRenderer.invoke('fs:get-temp-import-file-info', filePath),
  cleanupStagedTextFile: (stagedPath: string) =>
    ipcRenderer.invoke('fs:cleanup-staged-text-file', stagedPath),
  cleanupTempImportPath: (targetPath: string) =>
    ipcRenderer.invoke('fs:cleanup-temp-import-path', targetPath),
  processMediaFile: (payload: {
    ffmpegPath?: string;
    inputFileName?: string;
    inputUrl: string;
    operation: 'extract-audio' | 'compress-video';
    outputDirectoryPath?: string;
  }) => ipcRenderer.invoke('media-tool:process-file', payload),
  prepareImagePreview: (payload: {
    nodeId?: number;
    libraryId?: number;
    url: string;
    fileName?: string;
    ext?: string;
    mimeType?: string;
    fileSize?: number;
    sourceVersion?: string;
  }) => ipcRenderer.invoke('image-preview:prepare', payload),
  onViewerZoomShortcut: (listener: (payload: { action: 'zoom-in' | 'zoom-out' | 'reset' }) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { action: 'zoom-in' | 'zoom-out' | 'reset' },
    ) => {
      listener(payload);
    };
    ipcRenderer.on('app:viewer-zoom-shortcut', wrapped);
    return () => ipcRenderer.removeListener('app:viewer-zoom-shortcut', wrapped);
  },
  fetch: (url: string, options?: any) => ipcRenderer.invoke('http:fetch', url, options),
  fetchBinary: (url: string, options?: any) => ipcRenderer.invoke('http:fetch-binary', url, options),
  uploadPresignedPut: (args: {
    uploadId: string;
    partNumber: number;
    presignedUrl: string;
    filePath: string;
    byteOffset: number;
    byteLength: number;
    contentType?: string;
  }) => ipcRenderer.invoke('http:upload:presigned-put', args),
  uploadAbort: (uploadId: string) => ipcRenderer.invoke('http:upload:abort', uploadId),
  uploadFormData: (
    url: string,
    filePath: string,
    formDataParams?: Record<string, string>,
    headers?: Record<string, string>,
    uploadId?: string,
  ) => ipcRenderer.invoke('http:upload:formdata', url, filePath, formDataParams, headers, uploadId),
  uploadFormDataAbort: (uploadId: string) => ipcRenderer.invoke('http:upload:formdata:abort', uploadId),
  onUploadProgress: (listener: (payload: {
    uploadId: string;
    partNumber: number;
    uploadedBytes: number;
    totalBytes: number;
    percentage: number;
    speedBps: number;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      uploadId: string;
      partNumber: number;
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

contextBridge.exposeInMainWorld('electronAppUpdate', {
  getState: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke('app-update:get-state'),
  check: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke('app-update:check'),
  download: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke('app-update:download'),
  install: (): Promise<AppUpdateSnapshot> => ipcRenderer.invoke('app-update:install'),
  onStateChange: (listener: (snapshot: AppUpdateSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: AppUpdateSnapshot) => listener(snapshot);
    ipcRenderer.on('app-update:state', wrapped);
    return () => ipcRenderer.removeListener('app-update:state', wrapped);
  },
})

// 窗口控制 API
contextBridge.exposeInMainWorld('electronWindow', {
  platform: process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
    ? process.platform
    : 'unknown',
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

contextBridge.exposeInMainWorld('electronSystemVideo', {
  open: (payload: {
    src: string;
    title: string;
    currentTime: number;
    duration?: number;
    isPlaying: boolean;
    volume: number;
    muted: boolean;
  }) => ipcRenderer.invoke('system-video-window:open', payload),
  close: () => ipcRenderer.invoke('system-video-window:close'),
  play: () => ipcRenderer.invoke('system-video-window:command', { type: 'play' }),
  pause: () => ipcRenderer.invoke('system-video-window:command', { type: 'pause' }),
  seek: (time: number) => ipcRenderer.invoke('system-video-window:command', { type: 'seek', time }),
  onState: (listener: (payload: {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
    muted: boolean;
    ended: boolean;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
      ended: boolean;
    }) => listener(payload);
    ipcRenderer.on('system-video-window:state', wrapped);
    return () => ipcRenderer.removeListener('system-video-window:state', wrapped);
  },
  onClosed: (listener: (payload: {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
    muted: boolean;
    ended: boolean;
  } | null) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
      ended: boolean;
    } | null) => listener(payload);
    ipcRenderer.on('system-video-window:closed', wrapped);
    return () => ipcRenderer.removeListener('system-video-window:closed', wrapped);
  },
});

contextBridge.exposeInMainWorld('electronSystemVideoHost', {
  onInit: (listener: (payload: {
    src: string;
    title: string;
    currentTime: number;
    duration?: number;
    isPlaying: boolean;
    volume: number;
    muted: boolean;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      src: string;
      title: string;
      currentTime: number;
      duration?: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
    }) => listener(payload);
    ipcRenderer.on('system-video-window:host:init', wrapped);
    return () => ipcRenderer.removeListener('system-video-window:host:init', wrapped);
  },
  onCommand: (listener: (payload: { type: 'play' } | { type: 'pause' } | { type: 'seek'; time: number }) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { type: 'play' } | { type: 'pause' } | { type: 'seek'; time: number },
    ) => listener(payload);
    ipcRenderer.on('system-video-window:host:command', wrapped);
    return () => ipcRenderer.removeListener('system-video-window:host:command', wrapped);
  },
  reportReady: () => ipcRenderer.send('system-video-window:host:ready'),
  reportState: (payload: {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
    muted: boolean;
    ended: boolean;
  }) => ipcRenderer.send('system-video-window:host:state', payload),
  close: () => ipcRenderer.send('system-video-window:host:close'),
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
  onHlsTask: (listener: (payload: {
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
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
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
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:hls-task', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:hls-task', wrapped);
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
  }) => ipcRenderer.invoke('embedded-browser:resource:merge-mse', tabId, payload),
  transcodeCapturedResource: (tabId: string, payload: {
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
  }) => ipcRenderer.invoke('embedded-browser:resource:transcode', tabId, payload),
  downloadHlsManifest: (tabId: string, payload: {
    durationSeconds?: number;
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    outputDirectoryPath?: string;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-hls', tabId, payload),
  startHlsRecording: (tabId: string, payload: {
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
  }) => ipcRenderer.invoke('embedded-browser:resource:start-hls-recording', tabId, payload),
  stopHlsRecording: (tabId: string, payload: {
    requestId?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:stop-hls-recording', tabId, payload),
  discardHlsRecording: (tabId: string, payload: {
    requestId?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:discard-hls-recording', tabId, payload),
  downloadHlsTracks: (tabId: string, payload: {
    audioManifestUrl?: string;
    durationSeconds?: number;
    ffmpegPath?: string;
    headers?: Record<string, string>;
    outputDirectoryPath?: string;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
    videoManifestUrl?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-hls-tracks', tabId, payload),
  downloadHlsPlan: (tabId: string, payload: {
    ffmpegPath?: string;
    manualKeyBase64?: string;
    outputDirectoryPath?: string;
    plan: import('@/features/embedded-browser/resources/model/embedded-browser-hls-manifest').EmbeddedBrowserHlsDownloadPlan;
    requestId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-hls-plan', tabId, payload),
  retryHlsPlanFailed: (tabId: string, payload: {
    requestId?: string;
  }) => ipcRenderer.invoke('embedded-browser:resource:retry-hls-plan-failed', tabId, payload),
  downloadMpdManifest: (tabId: string, payload: {
    ffmpegPath?: string;
    headers?: Record<string, string>;
    manifestUrl?: string;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-mpd', tabId, payload),
  downloadMpdPlan: (tabId: string, payload: {
    ffmpegPath?: string;
    outputDirectoryPath?: string;
    plan: import('@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest').EmbeddedBrowserMpdDownloadPlan;
    requestId?: string;
    selectedAudioRepresentationId?: string;
    selectedVideoRepresentationId?: string;
    suggestedFileName?: string;
    useSystemSaveDialog?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-mpd-plan', tabId, payload),
  downloadDirectFile: (tabId: string, payload: {
    headers?: Record<string, string>;
    outputDirectoryPath?: string;
    suggestedFileName?: string;
    url?: string;
    useSystemSaveDialog?: boolean;
  }) => ipcRenderer.invoke('embedded-browser:resource:download-direct-file', tabId, payload),
  reload: (tabId: string) => ipcRenderer.invoke('embedded-browser:reload', tabId),
  startDeepResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:start-deep-capture', tabId),
  startResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:start', tabId),
  stopResourceCapture: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:stop', tabId),
  clearCapturedResources: (tabId: string) => ipcRenderer.invoke('embedded-browser:resource:clear', tabId),
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('embedded-browser:set-bounds', bounds),
  getCookies: (filter?: { domain?: string; name?: string; url?: string; path?: string }) =>
    ipcRenderer.invoke('embedded-browser:cookie:get', filter),
  removeCookie: (url: string, name: string) =>
    ipcRenderer.invoke('embedded-browser:cookie:remove', url, name),
  removeCookiesByDomain: (domain: string) =>
    ipcRenderer.invoke('embedded-browser:cookie:remove-domain', domain),
  removeAllCookies: () =>
    ipcRenderer.invoke('embedded-browser:cookie:remove-all'),
  getResourceCaptureRules: () =>
    ipcRenderer.invoke('embedded-browser:resource-capture-rules:get') as Promise<EmbeddedBrowserCaptureRuleSet>,
  updateResourceCaptureRules: (ruleSet: EmbeddedBrowserCaptureRuleSet) =>
    ipcRenderer.invoke('embedded-browser:resource-capture-rules:update', ruleSet) as Promise<EmbeddedBrowserCaptureRuleSet>,
  resetResourceCaptureRules: () =>
    ipcRenderer.invoke('embedded-browser:resource-capture-rules:reset') as Promise<EmbeddedBrowserCaptureRuleSet>,
  getExternalToolSettings: () =>
    ipcRenderer.invoke('embedded-browser:external-tools:get') as Promise<EmbeddedBrowserExternalToolSettings>,
  updateExternalToolSettings: (settings: EmbeddedBrowserExternalToolSettings) =>
    ipcRenderer.invoke('embedded-browser:external-tools:update', settings) as Promise<EmbeddedBrowserExternalToolSettings>,
  resetExternalToolSettings: () =>
    ipcRenderer.invoke('embedded-browser:external-tools:reset') as Promise<EmbeddedBrowserExternalToolSettings>,
  listEnabledExternalTools: () =>
    ipcRenderer.invoke('embedded-browser:external-tools:list-enabled') as Promise<EmbeddedBrowserExternalToolOption[]>,
  dispatchExternalTool: (toolKey: EmbeddedBrowserExternalToolKey, payload: EmbeddedBrowserExternalToolDispatchPayload) =>
    ipcRenderer.invoke('embedded-browser:external-tools:dispatch', toolKey, payload) as Promise<void>,
  listPasswords: () =>
    ipcRenderer.invoke('embedded-browser:password:list'),
  getDecryptedPassword: (id: string) =>
    ipcRenderer.invoke('embedded-browser:password:get-decrypted', id),
  saveCapturedCredential: (credentialRequestId: string) =>
    ipcRenderer.invoke('embedded-browser:password:save-captured', credentialRequestId),
  deletePassword: (id: string) =>
    ipcRenderer.invoke('embedded-browser:password:delete', id),
  deleteAllPasswords: () =>
    ipcRenderer.invoke('embedded-browser:password:delete-all'),
  blacklistDomain: (domain: string) =>
    ipcRenderer.invoke('embedded-browser:password:blacklist-domain', domain),
  isBlacklistedDomain: (domain: string) =>
    ipcRenderer.invoke('embedded-browser:password:is-blacklisted', domain),
  autoFillPassword: (tabId: string, passwordId: string) =>
    ipcRenderer.invoke('embedded-browser:password:auto-fill', tabId, passwordId),
  onCredentialCaptured: (listener: (payload: {
    credentialRequestId: string;
    domain: string;
    username: string;
    pageUrl: string;
    tabId: string;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      credentialRequestId: string;
      domain: string;
      username: string;
      pageUrl: string;
      tabId: string;
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:credential-captured', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:credential-captured', wrapped);
  },
  onCredentialAutoFilled: (listener: (payload: {
    tabId: string;
    domain: string;
    filledUsername: string;
    alternatives: Array<{ id: string; username: string }>;
  }) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: {
      tabId: string;
      domain: string;
      filledUsername: string;
      alternatives: Array<{ id: string; username: string }>;
    }) => {
      listener(payload);
    };
    ipcRenderer.on('embedded-browser:credential-autofilled', wrapped);
    return () => ipcRenderer.removeListener('embedded-browser:credential-autofilled', wrapped);
  },
});

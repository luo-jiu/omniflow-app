/// <reference types="vite-plugin-electron/electron-env" />

declare const __OMNIFLOW_UPDATE_BASE_URL__: string

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
    openTextFile: (options?: {
      filters?: Array<{
        name: string;
        extensions: string[];
      }>;
    }) => Promise<{
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
    writeTextFile: (filePath: string, content: string) => Promise<string>;
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
    getDownloadDirectory: () => Promise<string>;
    saveDownloadFile: (defaultFileName: string, options?: {
      filters?: Array<{
        name: string;
        extensions: string[];
      }>;
    }) => Promise<{
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
    createStagedTextFile: (fileName: string, content: string) => Promise<{
      filePath: string;
      size: number;
    }>;
    createStagedBinaryFile: (fileName: string, base64: string) => Promise<{
      filePath: string;
      size: number;
    }>;
    createTempImportDirectory: () => Promise<string>;
    getTempImportFileInfo: (filePath: string) => Promise<{
      filePath: string;
      name: string;
      size: number;
    }>;
    cleanupStagedTextFile: (stagedPath: string) => Promise<boolean>;
    cleanupTempImportPath: (targetPath: string) => Promise<boolean>;
    fileTransferGetDownloadUrlEnvironment: () => Promise<import('@/features/file-transfer/model/file-transfer').FileTransferDownloadUrlEnvironment | null>;
    fileTransferRegisterInternalDropClaim: (input: {
      claimId: string;
      fileName: string;
    }) => void;
    fileTransferResolveDownloadUrlClaim: (input: {
      claimId: string;
      fileName: string;
      mimeType?: string;
      sourceUrl: string;
    }) => Promise<boolean>;
    fileTransferRejectDownloadUrlClaim: (input: {
      claimId: string;
      error: string;
      fileName?: string;
    }) => Promise<boolean>;
    processMediaFile: (payload: {
      ffmpegPath?: string;
      inputFileName?: string;
      inputUrl: string;
      operation: 'extract-audio' | 'compress-video';
      outputDirectoryPath?: string;
    }) => Promise<{
      commandArgs?: string[];
      error?: string;
      ffmpegPath?: string;
      ok: boolean;
      outputPath?: string;
    }>;
    prepareImagePreview: (payload: {
      nodeId?: number;
      libraryId?: number;
      url: string;
      fileName?: string;
      ext?: string;
      mimeType?: string;
      fileSize?: number;
      sourceVersion?: string;
    }) => Promise<{
      ok: boolean;
      cacheKey?: string;
      error?: string;
      metadataRows: Array<{
        label: string;
        value: string;
      }>;
      originalSize?: number;
      previewDataUrl?: string;
      previewPath?: string;
      previewUrl?: string;
    }>;
    onViewerZoomShortcut: (listener: (payload: {
      action: 'zoom-in' | 'zoom-out' | 'reset';
    }) => void) => () => void;
    onUploadProgress: (listener: (payload: {
      uploadId: string;
      partNumber: number;
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
    uploadPresignedPut: (args: {
      uploadId: string;
      partNumber: number;
      presignedUrl: string;
      filePath: string;
      byteOffset: number;
      byteLength: number;
      contentType?: string;
    }) => Promise<{
      status: number;
      etag: string;
      body: string;
    }>;
    uploadAbort: (uploadId: string) => Promise<boolean>;
    uploadFormData: (
      url: string,
      filePath: string,
      formDataParams?: Record<string, string>,
      headers?: Record<string, string>,
      uploadId?: string,
    ) => Promise<{
      status: number;
      body: any;
    }>;
    uploadFormDataAbort: (uploadId: string) => Promise<boolean>;
  };

  electronAppUpdate?: {
    getState: () => Promise<import('@/features/app-update/types').AppUpdateSnapshot>;
    check: () => Promise<import('@/features/app-update/types').AppUpdateSnapshot>;
    download: () => Promise<import('@/features/app-update/types').AppUpdateSnapshot>;
    install: () => Promise<import('@/features/app-update/types').AppUpdateSnapshot>;
    onStateChange: (
      listener: (snapshot: import('@/features/app-update/types').AppUpdateSnapshot) => void,
    ) => () => void;
  };

  electronAIService?: {
    list: () => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    revealApiKey: (id: string) => Promise<string>;
    save: (
      input: import('@/features/ai-services/ai-service.types').AIServiceSaveInput,
    ) => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    setActive: (id: string) => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    reorder: (orderedIds: string[]) => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    duplicate: (id: string) => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    delete: (id: string) => Promise<import('@/features/ai-services/ai-service.types').AIServiceSnapshot>;
    listModels: () => Promise<string[]>;
    beginRun: (
      profileId: string,
    ) => Promise<import('@/features/ai-services/ai-service.types').AIServiceRunSessionHandle>;
    endRun: (runSessionId: string) => Promise<boolean>;
    complete: (
      input: import('@/features/ai-services/ai-service.types').AIServiceCompletionInput,
    ) => Promise<string>;
  };

  electronAgent?: {
    startChat: (
      input: import('@/shared/agent/agent.types').AgentChatRequest,
    ) => Promise<import('@/shared/agent/agent.types').AgentChatStartResult>;
    stopChat: (sessionId: string) => Promise<boolean>;
    releaseOwner: () => Promise<boolean>;
    resolveToolApproval: (
      input: import('@/shared/agent/agent.types').AgentToolApprovalDecisionRequest,
    ) => Promise<import('@/shared/agent/agent.types').AgentToolApprovalDecisionResult>;
    completeToolExecution: (
      input: import('@/shared/agent/agent.types').AgentToolExecutionCompletion,
    ) => Promise<boolean>;
    markToolExecutionCommitted: (
      input: import('@/shared/agent/agent.types').AgentToolExecutionCommit,
    ) => Promise<boolean>;
    reportToolExecutionProgress: (
      input: import('@/shared/agent/agent.types').AgentToolExecutionProgressRequest,
    ) => Promise<boolean>;
    inspectMedia: (
      input: import('@/shared/agent/agent.types').AgentMediaInspectionRequest,
    ) => Promise<import('@/shared/agent/agent.types').AgentToolResult>;
    extractMediaAudio: (
      input: import('@/shared/agent/agent.types').AgentMediaAudioExtractionRequest,
    ) => Promise<import('@/shared/agent/agent.types').AgentMediaAudioExtractionResult>;
    releaseMediaArtifact: (
      input: import('@/shared/agent/agent.types').AgentMediaArtifactReleaseRequest,
    ) => Promise<boolean>;
    listSessions: (
      ownerScope: import('@/shared/agent/agent.types').AgentOwnerScope,
      libraryId: number,
      query?: string,
      cursor?: import('@/shared/agent/agent.types').AgentSessionCursor,
    ) => Promise<import('@/shared/agent/agent.types').AgentSessionPage>;
    getSession: (
      ownerScope: import('@/shared/agent/agent.types').AgentOwnerScope,
      libraryId: number,
      sessionId: string,
    ) => Promise<import('@/shared/agent/agent.types').AgentSessionSnapshot>;
    renameSession: (
      ownerScope: import('@/shared/agent/agent.types').AgentOwnerScope,
      libraryId: number,
      sessionId: string,
      title: string,
    ) => Promise<import('@/shared/agent/agent.types').AgentSessionSummary>;
    deleteSession: (
      ownerScope: import('@/shared/agent/agent.types').AgentOwnerScope,
      libraryId: number,
      sessionId: string,
    ) => Promise<boolean>;
    onEvent: (
      listener: (event: import('@/shared/agent/agent.types').AgentChatStreamEvent) => void,
    ) => () => void;
  };

  electronQQMusicLyrics?: {
    status: () => Promise<import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsStatus>;
    search: (
      input: import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsSearchInput,
    ) => Promise<import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsOperation<
      import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsSong[]
    >>;
    preview: (
      songId: number,
    ) => Promise<import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsOperation<
      import('@/shared/qqmusic-lyrics/qqmusic-lyrics.types').QQMusicLyricsPreview
    >>;
  };

  electronWindow: {
    platform: 'darwin' | 'win32' | 'linux' | 'unknown';
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    activate: (temporaryOnTop?: boolean) => Promise<boolean>;
    setThemeSource: (source: 'light' | 'dark' | 'system') => void;
  };

  electronOverlay: {
    open: <T = unknown>(type: string, props: unknown) => Promise<T>;
  };

  electronOverlayHost: {
    onShow: (listener: (spec: { requestId: string; type: string; props: unknown }) => void) => () => void;
    onDismissFromMain: (listener: (payload: { requestId: string }) => void) => () => void;
    resolve: (requestId: string, result: unknown) => void;
    dismiss: (requestId: string, reason?: string) => void;
    reportReady: () => void;
  };

  electronSystemVideo?: {
    open: (payload: {
      src: string;
      title: string;
      currentTime: number;
      duration?: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
    }) => Promise<boolean>;
    close: () => Promise<boolean>;
    play: () => Promise<boolean>;
    pause: () => Promise<boolean>;
    seek: (time: number) => Promise<boolean>;
    onState: (listener: (payload: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
      ended: boolean;
    }) => void) => () => void;
    onClosed: (listener: (payload: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
      ended: boolean;
    } | null) => void) => () => void;
  };

  electronSystemVideoHost?: {
    onInit: (listener: (payload: {
      src: string;
      title: string;
      currentTime: number;
      duration?: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
    }) => void) => () => void;
    onCommand: (listener: (payload: { type: 'play' } | { type: 'pause' } | { type: 'seek'; time: number }) => void) => () => void;
    reportReady: () => void;
    reportState: (payload: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      volume: number;
      muted: boolean;
      ended: boolean;
    }) => void;
    close: () => void;
  };
}

type EmbeddedBrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
  session: boolean;
};

type EmbeddedBrowserCookieFilter = {
  domain?: string;
  name?: string;
  url?: string;
  path?: string;
};

type EmbeddedBrowserSavedPasswordEntry = {
  id: string;
  domain: string;
  username: string;
  pageUrl: string;
  createdAt: number;
  updatedAt: number;
};

type EmbeddedBrowserCapturedCredentialEvent = {
  credentialRequestId: string;
  domain: string;
  username: string;
  pageUrl: string;
  tabId: string;
};

type EmbeddedBrowserAutoFilledEvent = {
  tabId: string;
  domain: string;
  filledUsername: string;
  alternatives: Array<{ id: string; username: string }>;
};

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
  audioResourceKey: string;
  audioSizeBytes: number;
  autoSeekToBufferedEnd: boolean;
  autoDownloadOnComplete: boolean;
  capturedMediaSizeBytes: number;
  clearCacheOnComplete: boolean;
  currentFileName: string;
  isCaptureComplete: boolean;
  manualFileName: string;
  primaryResourceKey: string;
  regexWarning: string;
  regexRule: string;
  restartAlwaysFromBeginning: boolean;
  selectorWarning: string;
  selectorRule: string;
  streamCount: number;
  trimExtraMediaHeaders: boolean;
  videoResourceKey: string;
  videoSizeBytes: number;
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
    onLibraryFileDropResult: (
      listener: (payload: import('@/features/file-transfer/model/file-transfer').LibraryFileBrowserDropResult) => void,
    ) => () => void;
    stagePageDrag: (
      input: import('@/features/file-transfer/model/browser-drag-transfer').EmbeddedBrowserStagePageDragRequest,
    ) => Promise<import('@/features/file-transfer/model/browser-drag-transfer').EmbeddedBrowserStagedPageDragFile[]>;
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
    saveCapturedResource: (tabId: string, payload: {
      resourceKey?: string;
      suggestedFileName?: string;
    }) => Promise<{
      cancelled?: boolean;
      error?: string;
      ok: boolean;
      outputPath?: string;
    }>;
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
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
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
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    downloadHlsManifest: (tabId: string, payload: {
      durationSeconds?: number;
      ffmpegPath?: string;
      headers?: Record<string, string>;
      manifestUrl?: string;
      outputDirectoryPath?: string;
      requestId?: string;
      suggestedFileName?: string;
      useSystemSaveDialog?: boolean;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
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
    }) => Promise<{
      cancelled?: boolean;
      error?: string;
      ok: boolean;
      requestId?: string;
    }>;
    stopHlsRecording: (tabId: string, payload: {
      requestId?: string;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    discardHlsRecording: (tabId: string, payload: {
      requestId?: string;
    }) => Promise<{
      error?: string;
      ok: boolean;
    }>;
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
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    downloadHlsPlan: (tabId: string, payload: {
      ffmpegPath?: string;
      manualKeyBase64?: string;
      outputDirectoryPath?: string;
      plan: import('@/features/embedded-browser/resources/model/embedded-browser-hls-manifest').EmbeddedBrowserHlsDownloadPlan;
      requestId?: string;
      suggestedFileName?: string;
      useSystemSaveDialog?: boolean;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    retryHlsPlanFailed: (tabId: string, payload: {
      requestId?: string;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    downloadMpdManifest: (tabId: string, payload: {
      ffmpegPath?: string;
      headers?: Record<string, string>;
      manifestUrl?: string;
      outputDirectoryPath?: string;
      suggestedFileName?: string;
      useSystemSaveDialog?: boolean;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    downloadMpdPlan: (tabId: string, payload: {
      ffmpegPath?: string;
      outputDirectoryPath?: string;
      plan: import('@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest').EmbeddedBrowserMpdDownloadPlan;
      requestId?: string;
      selectedAudioRepresentationId?: string;
      selectedVideoRepresentationId?: string;
      suggestedFileName?: string;
      useSystemSaveDialog?: boolean;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    downloadDirectFile: (tabId: string, payload: {
      headers?: Record<string, string>;
      outputDirectoryPath?: string;
      suggestedFileName?: string;
      url?: string;
      useSystemSaveDialog?: boolean;
    }) => Promise<EmbeddedBrowserCapturedResourceMergeResponse>;
    getCatchToolkitState: (tabId: string) => Promise<EmbeddedBrowserCatchToolkitState | null>;
    updateCatchToolkitState: (
      tabId: string,
      payload: Partial<EmbeddedBrowserCatchToolkitState>,
    ) => Promise<EmbeddedBrowserCatchToolkitState | null>;
    clearCatchMediaCache: (tabId: string) => Promise<boolean>;
    clearCacheAndReload: (tabId: string) => Promise<boolean>;
    resetPageStorageAndReload: (tabId: string) => Promise<boolean>;
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
    }) => void) => () => void;
    onResourceCaptured: (listener: (payload: EmbeddedBrowserCapturedResource) => void) => () => void;
    openTab: (tabId: string, url?: string) => Promise<void>;
    reload: (tabId: string) => Promise<void>;
    setBounds: (bounds: EmbeddedBrowserBounds) => Promise<void>;
    startDeepResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    startResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    stopResourceCapture: (tabId: string) => Promise<EmbeddedBrowserResourceCaptureSnapshot>;
    getCookies: (filter?: EmbeddedBrowserCookieFilter) => Promise<EmbeddedBrowserCookie[]>;
    removeCookie: (url: string, name: string) => Promise<void>;
    removeCookiesByDomain: (domain: string) => Promise<void>;
    removeAllCookies: () => Promise<void>;
    getResourceCaptureRules: () => Promise<import('@/features/embedded-browser/resources/model/embedded-browser-capture-rules').EmbeddedBrowserCaptureRuleSet>;
    updateResourceCaptureRules: (
      ruleSet: import('@/features/embedded-browser/resources/model/embedded-browser-capture-rules').EmbeddedBrowserCaptureRuleSet,
    ) => Promise<import('@/features/embedded-browser/resources/model/embedded-browser-capture-rules').EmbeddedBrowserCaptureRuleSet>;
    resetResourceCaptureRules: () => Promise<import('@/features/embedded-browser/resources/model/embedded-browser-capture-rules').EmbeddedBrowserCaptureRuleSet>;
    getExternalToolSettings: () => Promise<import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolSettings>;
    updateExternalToolSettings: (
      settings: import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolSettings,
    ) => Promise<import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolSettings>;
    resetExternalToolSettings: () => Promise<import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolSettings>;
    listEnabledExternalTools: () => Promise<import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolOption[]>;
    dispatchExternalTool: (
      toolKey: import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolKey,
      payload: import('@/features/embedded-browser/external-tools/model/embedded-browser-external-tools').EmbeddedBrowserExternalToolDispatchPayload,
    ) => Promise<void>;
    listPasswords: () => Promise<EmbeddedBrowserSavedPasswordEntry[]>;
    getDecryptedPassword: (id: string) => Promise<string>;
    saveCapturedCredential: (credentialRequestId: string) => Promise<EmbeddedBrowserSavedPasswordEntry>;
    deletePassword: (id: string) => Promise<boolean>;
    deleteAllPasswords: () => Promise<void>;
    blacklistDomain: (domain: string) => Promise<void>;
    isBlacklistedDomain: (domain: string) => Promise<boolean>;
    autoFillPassword: (tabId: string, passwordId: string) => Promise<{ username: string } | null>;
    onCredentialCaptured: (listener: (payload: EmbeddedBrowserCapturedCredentialEvent) => void) => () => void;
    onCredentialAutoFilled: (listener: (payload: EmbeddedBrowserAutoFilledEvent) => void) => () => void;
  };
}

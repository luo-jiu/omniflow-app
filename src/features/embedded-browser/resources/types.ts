export type EmbeddedBrowserCapturedResourceKind =
  | 'manifest'
  | 'media'
  | 'image'
  | 'subtitle'
  | 'document'
  | 'key'
  | 'other';

export type EmbeddedBrowserCapturedResourceSource = 'network' | 'probe';

export type EmbeddedBrowserCapturedResource = {
  capturedAt: number;
  contentLength?: number;
  ext?: string;
  id: string;
  kind: EmbeddedBrowserCapturedResourceKind;
  method?: string;
  mimeType?: string;
  pageUrl?: string;
  referer?: string;
  resourceKey?: string;
  requestHeaders?: Record<string, string>;
  resourceType?: string;
  source: EmbeddedBrowserCapturedResourceSource;
  statusCode?: number;
  streamType?: 'audio' | 'video';
  tabId: string;
  url: string;
};

export type EmbeddedBrowserResourceCaptureSnapshot = {
  deepCaptureEnabled: boolean;
  enabled: boolean;
  resources: EmbeddedBrowserCapturedResource[];
};

export type EmbeddedBrowserCatchToolkitState = {
  audioResourceKey: string;
  audioSizeBytes: number;
  autoSeekToBufferedEnd: boolean;
  autoDownloadOnComplete: boolean;
  capturedMediaSizeBytes: number;
  clearCacheOnComplete: boolean;
  currentFileName: string;
  diagnostics: {
    appendBufferCount: number;
    frameCount?: number;
    frameUrl: string;
    hookErrors: number;
    installedAt: number;
    lastAppendAt: number;
    lastError: string;
    mediaSourceAvailable: boolean;
    mediaSourceHooked: boolean;
    sourceBufferCount: number;
  };
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

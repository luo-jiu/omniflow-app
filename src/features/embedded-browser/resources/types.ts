export type EmbeddedBrowserCapturedResourceKind =
  | 'manifest'
  | 'media'
  | 'image'
  | 'subtitle'
  | 'document'
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

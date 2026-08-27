export const EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE = 'application/x-omniflow-browser-page-drag';

export type EmbeddedBrowserPageDragSourceKind = 'image' | 'link' | 'media' | 'unknown';

export interface EmbeddedBrowserPageDragSource {
  capturedAt: number;
  mimeType?: string;
  pageUrl: string;
  /** Main-only opaque authority id when the source was captured in this tab. */
  resourceId?: string;
  sessionId: string;
  sourceKind: EmbeddedBrowserPageDragSourceKind;
  sourceUrl: string;
  suggestedFileName?: string;
  tabId: string;
}

export interface EmbeddedBrowserPageDragFallbackResource {
  mimeType?: string;
  pageUrl?: string;
  sourceKind?: EmbeddedBrowserPageDragSourceKind;
  sourceUrl: string;
  suggestedFileName?: string;
}

export interface EmbeddedBrowserStagePageDragRequest {
  fallbackResources?: EmbeddedBrowserPageDragFallbackResource[];
  sessionId?: string;
  tabId?: string;
}

export interface EmbeddedBrowserStagedPageDragFile {
  cleanupPath: string;
  fileName: string;
  filePath: string;
  mimeType?: string;
  size: number;
  sourceUrl: string;
}

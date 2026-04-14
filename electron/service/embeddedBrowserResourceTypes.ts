export type EmbeddedBrowserCapturedResourceKind = 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other'
export type EmbeddedBrowserCapturedResourceSource = 'network' | 'probe'
export type EmbeddedBrowserCapturedRequestHeaders = Record<string, string>
export type EmbeddedBrowserCapturedStreamType = 'audio' | 'video'

export type EmbeddedBrowserCapturedResource = {
  capturedAt: number
  contentLength?: number
  ext?: string
  id: string
  kind: EmbeddedBrowserCapturedResourceKind
  method?: string
  mimeType?: string
  pageUrl?: string
  referer?: string
  resourceKey?: string
  requestHeaders?: EmbeddedBrowserCapturedRequestHeaders
  resourceType?: string
  source: EmbeddedBrowserCapturedResourceSource
  statusCode?: number
  streamType?: EmbeddedBrowserCapturedStreamType
  tabId: string
  url: string
}

export type EmbeddedBrowserResourceCaptureSnapshot = {
  deepCaptureEnabled: boolean
  enabled: boolean
  resources: EmbeddedBrowserCapturedResource[]
}

import type { BrowserWindow } from 'electron'
import type { EmbeddedBrowserHlsDownloadPlan } from '@/features/embedded-browser/resources/model/embedded-browser-hls-manifest'

export type EmbeddedBrowserMainControllerOptions = {
  debugEnabled: boolean
  getMainWindow: () => BrowserWindow | null
}

export type EmbeddedBrowserStatePayload = {
  canGoBack?: boolean
  canGoForward?: boolean
  details?: string
  iconSourceUrl?: string
  iconUrl?: string
  message?: string
  meta?: string[]
  state?: 'idle' | 'loading' | 'ready' | 'error'
  tabId?: string
  title?: string
  url?: string
}

export type EmbeddedBrowserFaviconResolvePayload = {
  iconUrl?: string
  pageUrl?: string
}

export type EmbeddedBrowserFaviconResolveResult = {
  dataUrl: string
  iconUrl: string
}

export type EmbeddedBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type EmbeddedBrowserCapturedResourceMergePayload = {
  audioResource?: EmbeddedBrowserCapturedResourceMergeTrackPayload
  audioResourceKey?: string
  ffmpegPath?: string
  outputDirectoryPath?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
  videoResource?: EmbeddedBrowserCapturedResourceMergeTrackPayload
  videoResourceKey?: string
}

export type EmbeddedBrowserCapturedResourceMergeTrackPayload = {
  fileName?: string
  mimeType?: string
  requestHeaders?: Record<string, string>
  resourceKey?: string
  streamType?: 'audio' | 'video'
  url?: string
}

export type EmbeddedBrowserCapturedResourceMergeResponse = {
  cancelled?: boolean
  error?: string
  ffmpegPath?: string
  ok: boolean
  outputPath?: string
}

export type EmbeddedBrowserCapturedResourceTranscodeFormat = string

export type EmbeddedBrowserCapturedResourceTranscodePayload = {
  ffmpegPath?: string
  outputDirectoryPath?: string
  outputFormat?: EmbeddedBrowserCapturedResourceTranscodeFormat
  resource?: EmbeddedBrowserCapturedResourceMergeTrackPayload
  resourceKey?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserCapturedResourceTranscodeResponse = EmbeddedBrowserCapturedResourceMergeResponse

export type EmbeddedBrowserCapturedResourceSavePayload = {
  resourceKey?: string
  suggestedFileName?: string
}

export type EmbeddedBrowserCapturedResourceSaveResponse = {
  cancelled?: boolean
  error?: string
  ok: boolean
  outputPath?: string
}

export type EmbeddedBrowserHlsDownloadPayload = {
  ffmpegPath?: string
  headers?: Record<string, string>
  manifestUrl?: string
  outputDirectoryPath?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserHlsDownloadResponse = {
  cancelled?: boolean
  error?: string
  ffmpegPath?: string
  ok: boolean
  outputPath?: string
}

export type EmbeddedBrowserHlsPlanDownloadPayload = {
  ffmpegPath?: string
  outputDirectoryPath?: string
  plan: EmbeddedBrowserHlsDownloadPlan
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserHlsPlanDownloadResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserMpdDownloadPayload = EmbeddedBrowserHlsDownloadPayload

export type EmbeddedBrowserMpdDownloadResponse = EmbeddedBrowserHlsDownloadResponse

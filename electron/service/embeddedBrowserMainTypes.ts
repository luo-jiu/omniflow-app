import type { BrowserWindow } from 'electron'
import type { EmbeddedBrowserHlsDownloadPlan } from '@/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import type { EmbeddedBrowserMpdDownloadPlan } from '@/features/embedded-browser/resources/model/embedded-browser-mpd-manifest'

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
  audioResourceId?: string
  ffmpegPath?: string
  outputDirectoryPath?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
  videoResourceId?: string
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
  resourceId?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserCapturedResourceTranscodeResponse = EmbeddedBrowserCapturedResourceMergeResponse

export type EmbeddedBrowserCapturedResourceSavePayload = {
  resourceId?: string
  suggestedFileName?: string
}

export type EmbeddedBrowserCapturedResourceSaveResponse = {
  cancelled?: boolean
  error?: string
  ok: boolean
  outputPath?: string
}

export type EmbeddedBrowserHlsDownloadPayload = {
  durationSeconds?: number
  ffmpegPath?: string
  headers?: Record<string, string>
  manifestUrl?: string
  outputDirectoryPath?: string
  resourceId?: string
  requestId?: string
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
  manualKeyBase64?: string
  outputDirectoryPath?: string
  plan: EmbeddedBrowserHlsDownloadPlan
  resourceId?: string
  requestId?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserHlsPlanDownloadResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserHlsPlanRetryPayload = {
  requestId?: string
}

export type EmbeddedBrowserHlsPlanRetryResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserHlsRetrySessionCleanupPayload = {
  requestId?: string
}

export type EmbeddedBrowserHlsRecordingStartPayload = {
  ffmpegPath?: string
  headers?: Record<string, string>
  manifestUrl?: string
  manualKeyBase64?: string
  outputDirectoryPath?: string
  pageUrl?: string
  resourceId?: string
  requestId?: string
  suggestedFileName?: string
  suggestedThreadCount?: number
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserHlsRecordingStartResponse = {
  cancelled?: boolean
  error?: string
  ok: boolean
  requestId?: string
}

export type EmbeddedBrowserHlsRecordingStopPayload = {
  requestId?: string
}

export type EmbeddedBrowserHlsRecordingStopResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserHlsRecordingDiscardPayload = {
  requestId?: string
}

export type EmbeddedBrowserHlsRecordingDiscardResponse = {
  error?: string
  ok: boolean
}

export type EmbeddedBrowserHlsTrackMergePayload = {
  audioManifestUrl?: string
  durationSeconds?: number
  ffmpegPath?: string
  headers?: Record<string, string>
  outputDirectoryPath?: string
  requestId?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
  videoManifestUrl?: string
}

export type EmbeddedBrowserHlsTrackMergeResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserDirectFileDownloadPayload = {
  headers?: Record<string, string>
  outputDirectoryPath?: string
  suggestedFileName?: string
  url?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserCapturedResourceDownloadPayload = {
  outputDirectoryPath?: string
  resourceId: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserDirectFileDownloadResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserHlsTaskEventPayload = {
  bytesReceived?: number
  bytesTotal?: number
  completedFragments?: number
  durationSeconds?: number
  error?: string
  etaSeconds?: number
  ffmpegSpeedText?: string
  failedFragments?: number[]
  manifestUrl: string
  message?: string
  mode: 'direct-manifest' | 'local-plan'
  outputPath?: string
  processedSeconds?: number
  requestId?: string
  speedBps?: number
  stage:
    | 'preparing'
    | 'downloading-fragments'
    | 'rewriting-playlist'
    | 'ffmpeg'
    | 'completed'
    | 'error'
  status: 'running' | 'success' | 'error'
  tabId: string
  totalFragments?: number
  usingManualKey?: boolean
}

export type EmbeddedBrowserMpdDownloadPayload = EmbeddedBrowserHlsDownloadPayload

export type EmbeddedBrowserMpdDownloadResponse = EmbeddedBrowserHlsDownloadResponse

export type EmbeddedBrowserMpdPlanDownloadPayload = {
  ffmpegPath?: string
  outputDirectoryPath?: string
  plan: EmbeddedBrowserMpdDownloadPlan
  resourceId?: string
  requestId?: string
  selectedAudioRepresentationId?: string
  selectedVideoRepresentationId?: string
  suggestedFileName?: string
  useSystemSaveDialog?: boolean
}

export type EmbeddedBrowserMpdPlanDownloadResponse = EmbeddedBrowserMpdDownloadResponse

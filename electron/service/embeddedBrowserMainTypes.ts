import type { BrowserWindow } from 'electron'

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
  audioResourceKey?: string
  ffmpegPath?: string
  suggestedFileName?: string
  videoResourceKey?: string
}

export type EmbeddedBrowserCapturedResourceMergeResponse = {
  cancelled?: boolean
  error?: string
  ffmpegPath?: string
  ok: boolean
  outputPath?: string
}

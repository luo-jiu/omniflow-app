export type EmbeddedBrowserCatchToolkitStatePayload = {
  audioResourceKey: string
  audioSizeBytes: number
  autoSeekToBufferedEnd: boolean
  autoDownloadOnComplete: boolean
  capturedMediaSizeBytes: number
  clearCacheOnComplete: boolean
  currentFileName: string
  diagnostics: {
    appendBufferCount: number
    frameCount?: number
    frameUrl: string
    hookErrors: number
    installedAt: number
    lastAppendAt: number
    lastError: string
    mediaSourceAvailable: boolean
    mediaSourceHooked: boolean
    sourceBufferCount: number
  }
  isCaptureComplete: boolean
  manualFileName: string
  primaryResourceKey: string
  regexWarning: string
  regexRule: string
  restartAlwaysFromBeginning: boolean
  saveEveryGigabyte: boolean
  selectorWarning: string
  selectorRule: string
  streamCount: number
  trimExtraMediaHeaders: boolean
  videoResourceKey: string
  videoSizeBytes: number
}

export function createEmbeddedBrowserCatchToolkitGetStateScript() {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.getCatchToolkitState === 'function'
        ? probe.getCatchToolkitState
        : null
      return handler ? handler() : null
    })()
  `
}

export function createEmbeddedBrowserCatchToolkitUpdateStateScript(
  payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>,
) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe.updateCatchToolkitState === 'function'
        ? probe.updateCatchToolkitState
        : null
      return handler ? handler(${JSON.stringify(payload)}) : null
    })()
  `
}

export function createEmbeddedBrowserCatchToolkitActionScript(
  action: 'clearCatchMediaCache' | 'downloadCatchMedia' | 'restartCatchMediaCapture',
) {
  return `
    (() => {
      const probe = window.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__
      const handler = probe && typeof probe[${JSON.stringify(action)}] === 'function'
        ? probe[${JSON.stringify(action)}]
        : null
      return handler ? handler() : false
    })()
  `
}

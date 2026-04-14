export type EmbeddedBrowserCatchToolkitStatePayload = {
  autoSeekToBufferedEnd: boolean
  autoDownloadOnComplete: boolean
  capturedMediaSizeBytes: number
  clearCacheOnComplete: boolean
  currentFileName: string
  isCaptureComplete: boolean
  manualFileName: string
  regexWarning: string
  regexRule: string
  restartAlwaysFromBeginning: boolean
  selectorWarning: string
  selectorRule: string
  streamCount: number
  trimExtraMediaHeaders: boolean
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

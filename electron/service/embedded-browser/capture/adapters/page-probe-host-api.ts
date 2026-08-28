/**
 * Stable page-global contract for capture actions.
 *
 * Capability owners wrap these methods for their own resource IDs. The base
 * implementation delegates only to the current MSE owner.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// This body fragment is compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserPageProbeHostApiBody() {
  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return clearCatchMediaCacheInternal()
    },
    downloadCatchMedia() {
      return downloadCatchMediaInternal()
    },
    drainResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      return normalizedResourceKey.startsWith('mse-stream:')
        ? drainMseResource(normalizedResourceKey)
        : null
    },
    exportResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      return normalizedResourceKey.startsWith('mse-stream:')
        ? exportMseResource(normalizedResourceKey)
        : false
    },
    getCatchToolkitState() {
      return buildCatchToolkitState()
    },
    installedAt: Date.now(),
    openResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      return normalizedResourceKey.startsWith('mse-stream:')
        ? openMseResource(normalizedResourceKey)
        : false
    },
    readResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      return normalizedResourceKey.startsWith('mse-stream:')
        ? readMseResource(normalizedResourceKey)
        : Promise.resolve(null)
    },
    restartCatchMediaCapture() {
      return restartCatchMediaCaptureInternal()
    },
    seen,
    updateCatchToolkitState(payload: Partial<ProbeCatchToolkitState>) {
      for (const key of [
        'autoDownloadOnComplete',
        'autoSeekToBufferedEnd',
        'clearCacheOnComplete',
        'restartAlwaysFromBeginning',
        'trimExtraMediaHeaders',
      ] as const) {
        if (typeof payload[key] === 'boolean') catchToolkitProjection[key] = payload[key]
      }
      for (const key of ['manualFileName', 'regexRule', 'selectorRule'] as const) {
        if (typeof payload[key] === 'string') catchToolkitProjection[key] = payload[key]
      }
      return buildCatchToolkitState()
    },
  }
}

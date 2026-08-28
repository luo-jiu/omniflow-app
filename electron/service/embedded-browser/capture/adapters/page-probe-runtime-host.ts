/**
 * Page action behavior adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under GPL-3.0-only
 *
 * Platform host API for the embedded page probe. Algorithm owners install or
 * wrap these handlers while main continues to authorize opaque resource IDs.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// This body fragment is compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserPageProbeRuntimeHostBody() {
  function openProbeResource(resourceKey: string) {
    const resource = probeResources.get(resourceKey)
    if (!resource?.blobUrl) {
      return false
    }
    if (!openWindow) {
      return false
    }
    openWindow(resource.blobUrl, '_blank', 'noopener,noreferrer')
    return true
  }

  function exportProbeResource(resourceKey: string) {
    const resource = probeResources.get(resourceKey)
    if (!resource?.blobUrl) {
      return false
    }
    if (typeof document === 'undefined') {
      return false
    }
    const anchor = document.createElement('a')
    anchor.href = resource.blobUrl
    anchor.download = resource.fileName
    anchor.click()
    anchor.remove()
    return true
  }

  function readProbeResource(resourceKey: string) {
    const resource = probeResources.get(resourceKey)
    if (!resource) {
      return Promise.resolve(null)
    }
    return Promise.resolve({
      base64: resource.base64,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      resourceKey,
      streamType: resource.streamType,
    })
  }

  function consumeWorkerRelayMessage(data: unknown) {
    if (!data || typeof data !== 'object') {
      return false
    }
    const envelope = (data as Record<string, unknown>)[workerRelayKey] as ProbeRelayEnvelope | undefined
    if (!envelope || typeof envelope !== 'object' || !('type' in envelope)) {
      return false
    }
    if (isWorkerScope) {
      return relayEnvelope(envelope)
    }
    if (envelope.type === 'capture') {
      emit(envelope.payload, true)
      return true
    }
    if (envelope.type === 'generated-resource') {
      emitGeneratedResource(envelope.payload, true)
      return true
    }
    return false
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__.push(
    consumeWorkerRelayMessage,
    exportProbeResource,
    openProbeResource,
    readProbeResource,
  )

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return clearCatchMediaCacheInternal()
    },
    downloadCatchMedia() {
      return downloadCatchMediaInternal()
    },
    drainResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      if (normalizedResourceKey.startsWith('mse-stream:')) {
        return drainMseResource(normalizedResourceKey)
      }
      return null
    },
    exportResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      if (normalizedResourceKey.startsWith('mse-stream:')) {
        return exportMseResource(normalizedResourceKey)
      }
      if (normalizedResourceKey.startsWith('probe-resource:')) {
        return exportProbeResource(normalizedResourceKey)
      }
      return false
    },
    getCatchToolkitState() {
      return buildCatchToolkitState()
    },
    installedAt: Date.now(),
    openResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      if (normalizedResourceKey.startsWith('mse-stream:')) {
        return openMseResource(normalizedResourceKey)
      }
      if (normalizedResourceKey.startsWith('probe-resource:')) {
        return openProbeResource(normalizedResourceKey)
      }
      return false
    },
    readResource(resourceKey: string) {
      const normalizedResourceKey = String(resourceKey || '')
      if (normalizedResourceKey.startsWith('mse-stream:')) {
        return readMseResource(normalizedResourceKey)
      }
      if (normalizedResourceKey.startsWith('probe-resource:')) {
        return readProbeResource(normalizedResourceKey)
      }
      return Promise.resolve(null)
    },
    restartCatchMediaCapture() {
      return restartCatchMediaCaptureInternal()
    },
    seen,
    updateCatchToolkitState(payload: Partial<ProbeCatchToolkitState>) {
      if (typeof payload.autoSeekToBufferedEnd === 'boolean') {
        catchToolkitState.autoSeekToBufferedEnd = payload.autoSeekToBufferedEnd
      }
      if (typeof payload.autoDownloadOnComplete === 'boolean') {
        catchToolkitState.autoDownloadOnComplete = payload.autoDownloadOnComplete
      }
      if (typeof payload.clearCacheOnComplete === 'boolean') {
        catchToolkitState.clearCacheOnComplete = payload.clearCacheOnComplete
      }
      if (typeof payload.manualFileName === 'string') {
        catchToolkitState.manualFileName = payload.manualFileName
      }
      if (typeof payload.regexRule === 'string') {
        catchToolkitState.regexRule = evaluateRegexRule(payload.regexRule).rule
      }
      if (typeof payload.restartAlwaysFromBeginning === 'boolean') {
        catchToolkitState.restartAlwaysFromBeginning = payload.restartAlwaysFromBeginning
      }
      if (typeof payload.selectorRule === 'string') {
        catchToolkitState.selectorRule = evaluateSelectorRule(payload.selectorRule).rule
      }
      if (typeof payload.trimExtraMediaHeaders === 'boolean') {
        catchToolkitState.trimExtraMediaHeaders = payload.trimExtraMediaHeaders
      }
      persistCatchToolkitState()
      if (!isWorkerScope) {
        ensureTrackedMediaObserver()
      }
      return buildCatchToolkitState()
    },
  }
}

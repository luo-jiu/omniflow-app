/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserResourceProbePageActionsBody() {
  function attachTrackedMediaElement(element: HTMLMediaElement) {
    if (trackedMediaElements.has(element)) {
      return
    }
    trackedMediaElements.add(element)

    element.addEventListener('progress', () => {
      if (!catchToolkitState.autoSeekToBufferedEnd) {
        return
      }
      try {
        if (!element.buffered || element.buffered.length === 0) {
          return
        }
        const bufferedEnd = element.buffered.end(element.buffered.length - 1)
        const targetTime = Math.max(bufferedEnd - 5, 0)
        const duration = Number.isFinite(element.duration) ? element.duration : 0
        if (duration > 0 && bufferedEnd >= duration) {
          return
        }
        if (Math.abs(element.currentTime - targetTime) > 1) {
          element.currentTime = targetTime
        }
      } catch {
        // ignore seek failures caused by sparse or transient buffer ranges
      }
    })

    const attemptRestartFromBeginning = () => {
      if (!catchToolkitState.restartAlwaysFromBeginning || autoRestartHandledMediaElements.has(element)) {
        return
      }
      try {
        autoRestartHandledMediaElements.add(element)
        clearCatchMediaCacheInternal()
        element.currentTime = 0
      } catch {
        // ignore media elements that cannot be controlled programmatically
      }
    }

    element.addEventListener('play', () => {
      attemptRestartFromBeginning()
    }, { once: true })

    const initialRestartTimer = window.setInterval(() => {
      if (autoRestartHandledMediaElements.has(element) || !catchToolkitState.restartAlwaysFromBeginning) {
        window.clearInterval(initialRestartTimer)
        return
      }
      if (!element.paused) {
        attemptRestartFromBeginning()
        window.clearInterval(initialRestartTimer)
      }
    }, 500)
    window.setTimeout(() => {
      window.clearInterval(initialRestartTimer)
    }, 5000)
  }

  function bindTrackedMediaElements() {
    if (typeof document === 'undefined') {
      return
    }
    document.querySelectorAll('video, audio').forEach((node) => {
      if (node instanceof HTMLMediaElement) {
        attachTrackedMediaElement(node)
      }
    })
  }

  function ensureTrackedMediaObserver() {
    if (isWorkerScope || typeof MutationObserver === 'undefined' || trackedMediaObserver || typeof document === 'undefined') {
      return
    }
    bindTrackedMediaElements()
    trackedMediaObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return
          }
          if (node instanceof HTMLMediaElement) {
            attachTrackedMediaElement(node)
            return
          }
          node.querySelectorAll('video, audio').forEach((childNode) => {
            if (childNode instanceof HTMLMediaElement) {
              attachTrackedMediaElement(childNode)
            }
          })
        })
      })
    })
    trackedMediaObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    })
  }

  function clearCatchMediaCacheInternal() {
    let cleared = false
    mseStreams.forEach((stream) => {
      if (stream.blobUrl) {
        URL.revokeObjectURL(stream.blobUrl)
        stream.blobUrl = ''
      }
      if (isCaptureComplete) {
        cleared = cleared || stream.buffers.length > 0
        stream.buffers = []
        stream.bufferCount = 0
        stream.lastReportedBufferCount = 0
        stream.lastReportedBytes = 0
        stream.totalBytes = 0
        emitMseStream(stream.streamId)
        return
      }
      if (stream.buffers.length > 1) {
        const firstChunk = stream.buffers[0]
        stream.buffers = firstChunk ? [firstChunk] : []
        stream.bufferCount = stream.buffers.length
        stream.totalBytes = firstChunk?.byteLength || 0
        stream.lastReportedBufferCount = stream.bufferCount
        stream.lastReportedBytes = stream.totalBytes
        cleared = true
        emitMseStream(stream.streamId)
      }
    })
    isCaptureComplete = false
    return cleared
  }

  function downloadCatchMediaInternal() {
    if (typeof document === 'undefined') {
      return false
    }
    const downloadableStreams = Array.from(mseStreams.values()).filter((stream) => stream.buffers.length > 0)
    if (downloadableStreams.length === 0) {
      return false
    }

    const baseName = resolveCatchToolkitFileName()
    downloadableStreams.forEach((stream) => {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers)
      const blob = new Blob(playableBuffers, { type: stream.mimeType })
      const anchor = document.createElement('a')
      const blobUrl = URL.createObjectURL(blob)
      const extension = guessExtensionFromMimeType(stream.mimeType, stream.streamType)
      const fileSuffix = downloadableStreams.length > 1 && stream.streamType
        ? `-${stream.streamType}`
        : ''
      anchor.href = blobUrl
      anchor.download = `${baseName}${fileSuffix}.${extension}`
      anchor.click()
      anchor.remove()
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl)
      }, 1000)
    })

    if (catchToolkitState.clearCacheOnComplete) {
      setTimeout(() => {
        clearCatchMediaCacheInternal()
      }, 0)
    }

    return true
  }

  function restartCatchMediaCaptureInternal() {
    if (typeof document === 'undefined') {
      return false
    }
    clearCatchMediaCacheInternal()
    let restarted = false
    document.querySelectorAll('video, audio').forEach((node) => {
      if (!(node instanceof HTMLMediaElement)) {
        return
      }
      try {
        node.currentTime = 0
        void node.play().catch(() => undefined)
        restarted = true
      } catch {
        // ignore media elements that cannot be controlled programmatically
      }
    })
    return restarted
  }

  function createMseResourceKey(streamId: string) {
    return `mse-stream:${streamId}`
  }

  function emitMseStream(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream) {
      return
    }
    emit({
      contentLength: stream.totalBytes,
      ext: guessExtensionFromMimeType(stream.mimeType, stream.streamType),
      kind: 'media',
      mimeType: stream.mimeType,
      resourceKey: createMseResourceKey(streamId),
      resourceType: 'mse-stream',
      source: 'probe',
      streamType: stream.streamType,
      url: stream.blobUrl || `mse://capturing/${streamId}`,
    })
  }

  function finalizeMseStream(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream || stream.buffers.length === 0) {
      return false
    }
    if (stream.blobUrl) {
      URL.revokeObjectURL(stream.blobUrl)
      stream.blobUrl = ''
    }
    try {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers)
      stream.blobUrl = URL.createObjectURL(new Blob(playableBuffers, { type: stream.mimeType }))
      emitMseStream(streamId)
      return true
    } catch {
      return false
    }
  }

  function ensureMseStreamBlobUrl(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream) {
      return ''
    }
    if (!stream.blobUrl) {
      finalizeMseStream(streamId)
    }
    return stream.blobUrl
  }

  function createMseExportName(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream) {
      return 'media.bin'
    }
    const baseName = resolveCatchToolkitFileName()
    const streamSuffix = stream.streamType ? `-${stream.streamType}` : ''
    const extension = guessExtensionFromMimeType(stream.mimeType, stream.streamType)
    return `${baseName}${streamSuffix}.${extension}`
  }

  function exportMseResource(resourceKey: string) {
    const streamId = String(resourceKey || '').replace(/^mse-stream:/, '')
    const blobUrl = ensureMseStreamBlobUrl(streamId)
    if (!blobUrl) {
      return false
    }
    if (typeof document === 'undefined') {
      return false
    }
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = createMseExportName(streamId)
    anchor.click()
    anchor.remove()
    if (catchToolkitState.clearCacheOnComplete) {
      setTimeout(() => {
        clearCatchMediaCacheInternal()
      }, 0)
    }
    return true
  }

  function openMseResource(resourceKey: string) {
    const streamId = String(resourceKey || '').replace(/^mse-stream:/, '')
    const blobUrl = ensureMseStreamBlobUrl(streamId)
    if (!blobUrl) {
      return false
    }
    if (!openWindow) {
      return false
    }
    openWindow(blobUrl, '_blank', 'noopener,noreferrer')
    return true
  }

  async function readMseResource(resourceKey: string) {
    const streamId = String(resourceKey || '').replace(/^mse-stream:/, '')
    const stream = mseStreams.get(streamId)
    if (!stream || stream.buffers.length === 0) {
      return null
    }
    try {
      const playableBuffers = normalizeBuffersForPlayback(stream.buffers)
      const blob = new Blob(playableBuffers, { type: stream.mimeType })
      const buffer = await blob.arrayBuffer()
      return {
        base64: arrayBufferToBase64(buffer),
        fileName: createMseExportName(streamId),
        mimeType: stream.mimeType,
        resourceKey,
        streamType: stream.streamType,
      }
    } catch {
      return null
    }
  }

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


  if (!isWorkerScope) {
    ensureTrackedMediaObserver()
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    clearCatchMediaCache() {
      return clearCatchMediaCacheInternal()
    },
    downloadCatchMedia() {
      return downloadCatchMediaInternal()
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

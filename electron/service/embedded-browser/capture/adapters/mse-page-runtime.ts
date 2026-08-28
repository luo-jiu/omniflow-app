/**
 * MSE behavior adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under GPL-3.0-only
 *
 * Current OmniFlow behavior is extracted from the mixed legacy probe here.
 * The dedicated Cat Catch MSE port will replace this adapter at its own cutover.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, prefer-const */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserMsePageRuntimeCoreBody() {
  const probeDiagnostics = {
    appendBufferCount: 0,
    hookErrors: 0,
    mediaSourceAvailable: typeof globalScope.MediaSource !== 'undefined',
    mediaSourceHooked: false,
    sourceBufferCount: 0,
    lastAppendAt: 0,
    lastError: '',
  }
  const MSE_FLUSH_THRESHOLD_BYTES = 50 * 1024 * 1024
  const mseStreams = new Map<string, {
    blobUrl: string
    bufferCount: number
    buffers: ArrayBuffer[]
    flushTimer: number | null
    flushedBytes: number
    lastReportedBufferCount: number
    lastReportedBytes: number
    mimeType: string
    retainedBytes: number
    streamId: string
    streamType?: 'audio' | 'video'
    totalBytes: number
  }>()
  const mediaSourceStreams = new WeakMap<MediaSource, string[]>()
  let mseSequence = 0
  let isCaptureComplete = false
  const trackedMediaElements = new WeakSet<HTMLMediaElement>()
  const autoRestartHandledMediaElements = new WeakSet<HTMLMediaElement>()
  let trackedMediaObserver: MutationObserver | null = null

  function buildCatchToolkitState(): ProbeCatchToolkitState {
    const capturedMediaSizeBytes = Array.from(mseStreams.values()).reduce((totalBytes, stream) => {
      return totalBytes + Math.max(0, Number(stream.totalBytes || 0))
    }, 0)
    const sortedStreams = Array.from(mseStreams.values())
      .filter((stream) => stream.buffers.length > 0 || stream.totalBytes > 0)
      .sort((left, right) => {
        const sizeDelta = Math.max(0, Number(right.totalBytes || 0)) - Math.max(0, Number(left.totalBytes || 0))
        if (sizeDelta !== 0) {
          return sizeDelta
        }
        return String(left.streamId).localeCompare(String(right.streamId))
      })
    const primaryStream = sortedStreams[0]
    const audioStream = sortedStreams.find((stream) => stream.streamType === 'audio')
    const videoStream = sortedStreams.find((stream) => stream.streamType === 'video')
    return {
      audioResourceKey: audioStream ? createMseResourceKey(audioStream.streamId) : '',
      audioSizeBytes: audioStream ? Math.max(0, Number(audioStream.totalBytes || 0)) : 0,
      autoSeekToBufferedEnd: catchToolkitProjection.autoSeekToBufferedEnd,
      autoDownloadOnComplete: catchToolkitProjection.autoDownloadOnComplete,
      capturedMediaSizeBytes,
      clearCacheOnComplete: catchToolkitProjection.clearCacheOnComplete,
      currentFileName: resolveMseCaptureFileName(),
      diagnostics: {
        appendBufferCount: probeDiagnostics.appendBufferCount,
        frameUrl: currentLocationHref,
        hookErrors: probeDiagnostics.hookErrors,
        installedAt: globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?.installedAt || Date.now(),
        lastAppendAt: probeDiagnostics.lastAppendAt,
        lastError: probeDiagnostics.lastError,
        mediaSourceAvailable: probeDiagnostics.mediaSourceAvailable,
        mediaSourceHooked: probeDiagnostics.mediaSourceHooked,
        sourceBufferCount: probeDiagnostics.sourceBufferCount,
      },
      isCaptureComplete,
      manualFileName: catchToolkitProjection.manualFileName,
      primaryResourceKey: primaryStream ? createMseResourceKey(primaryStream.streamId) : '',
      regexWarning: catchToolkitProjection.regexWarning,
      regexRule: catchToolkitProjection.regexRule,
      restartAlwaysFromBeginning: catchToolkitProjection.restartAlwaysFromBeginning,
      selectorWarning: catchToolkitProjection.selectorWarning,
      selectorRule: catchToolkitProjection.selectorRule,
      streamCount: mseStreams.size,
      trimExtraMediaHeaders: catchToolkitProjection.trimExtraMediaHeaders,
      videoResourceKey: videoStream ? createMseResourceKey(videoStream.streamId) : '',
      videoSizeBytes: videoStream ? Math.max(0, Number(videoStream.totalBytes || 0)) : 0,
    }
  }

  function isWebmHeaderChunk(chunk: ArrayBuffer) {
    const data = getChunkBytes(chunk)
    return (
      data.length > 4
      && data[0] === 0x1A
      && data[1] === 0x45
      && data[2] === 0xDF
      && data[3] === 0xA3
    )
  }

  function normalizeBuffersForPlayback(buffers: ArrayBuffer[]) {
    if (!catchToolkitProjection.trimExtraMediaHeaders) {
      return buffers
    }
    if (!Array.isArray(buffers) || buffers.length <= 1) {
      return buffers
    }
    let lastHeaderIndex = -1
    buffers.forEach((chunk, index) => {
      if (isMp4HeaderChunk(chunk) || isWebmHeaderChunk(chunk)) {
        lastHeaderIndex = index
      }
    })
    if (lastHeaderIndex > 0) {
      return buffers.slice(lastHeaderIndex)
    }
    return buffers
  }

  function clearMseFlushTimer(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream || stream.flushTimer == null) {
      return
    }
    clearTimeout(stream.flushTimer)
    stream.flushTimer = null
  }

  function emitMseStreamReset(streamId: string) {
    emitProbeConsolePayload({
      capturedAt: Date.now(),
      event: 'mse-reset',
      pageUrl: currentLocationHref,
      resourceKey: createMseResourceKey(streamId),
    })
  }

  function flushMseStreamBuffers(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream || stream.buffers.length === 0) {
      return 0
    }
    clearMseFlushTimer(streamId)
    const combinedBuffer = combineArrayBuffers(stream.buffers)
    const flushedBytes = combinedBuffer.byteLength
    if (!flushedBytes) {
      return 0
    }
    emitProbeConsolePayload({
      base64: arrayBufferToBase64(combinedBuffer),
      capturedAt: Date.now(),
      event: 'mse-flush',
      fileName: `${resolveMseCaptureFileName()}${stream.streamType ? `-${stream.streamType}` : ''}.${guessExtensionFromMimeType(stream.mimeType, stream.streamType)}`,
      mimeType: stream.mimeType,
      pageUrl: currentLocationHref,
      resourceKey: createMseResourceKey(streamId),
      streamType: stream.streamType,
    })
    stream.buffers = []
    stream.retainedBytes = 0
    stream.flushedBytes += flushedBytes
    stream.lastReportedBufferCount = stream.bufferCount
    stream.lastReportedBytes = stream.totalBytes
    return flushedBytes
  }

  function scheduleMseStreamFlush(streamId: string) {
    const stream = mseStreams.get(streamId)
    if (!stream || stream.flushTimer != null) {
      return
    }
    stream.flushTimer = setTimeout(() => {
      const latestStream = mseStreams.get(streamId)
      if (!latestStream) {
        return
      }
      latestStream.flushTimer = null
      flushMseStreamBuffers(streamId)
    }, 0) as unknown as number
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__.push(
    autoRestartHandledMediaElements,
    buildCatchToolkitState,
    clearMseFlushTimer,
    emitMseStreamReset,
    flushMseStreamBuffers,
    isCaptureComplete,
    isWebmHeaderChunk,
    mediaSourceStreams,
    mseSequence,
    mseStreams,
    normalizeBuffersForPlayback,
    probeDiagnostics,
    scheduleMseStreamFlush,
    trackedMediaElements,
    trackedMediaObserver,
  )
}

export function embeddedBrowserMsePageActionsBody() {
  function attachTrackedMediaElement(element: HTMLMediaElement) {
    if (trackedMediaElements.has(element)) {
      return
    }
    trackedMediaElements.add(element)

    element.addEventListener('progress', () => {
      if (!catchToolkitProjection.autoSeekToBufferedEnd) {
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
      if (!catchToolkitProjection.restartAlwaysFromBeginning || autoRestartHandledMediaElements.has(element)) {
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
      if (autoRestartHandledMediaElements.has(element) || !catchToolkitProjection.restartAlwaysFromBeginning) {
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
    const observerTarget = document.body || document.documentElement
    if (!observerTarget) {
      window.setTimeout(() => {
        ensureTrackedMediaObserver()
      }, 250)
      return
    }
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
    trackedMediaObserver.observe(observerTarget, {
      childList: true,
      subtree: true,
    })
  }

  function clearCatchMediaCacheInternal() {
    let cleared = false
    mseStreams.forEach((stream) => {
      clearMseFlushTimer(stream.streamId)
      if (stream.blobUrl) {
        URL.revokeObjectURL(stream.blobUrl)
        stream.blobUrl = ''
      }
      emitMseStreamReset(stream.streamId)
      stream.flushedBytes = 0
      if (isCaptureComplete) {
        cleared = cleared || stream.buffers.length > 0
        stream.buffers = []
        stream.bufferCount = 0
        stream.lastReportedBufferCount = 0
        stream.lastReportedBytes = 0
        stream.retainedBytes = 0
        stream.totalBytes = 0
        emitMseStream(stream.streamId)
        return
      }
      if (stream.buffers.length > 1) {
        const firstChunk = stream.buffers[0]
        stream.buffers = firstChunk ? [firstChunk] : []
        stream.bufferCount = stream.buffers.length
        stream.retainedBytes = firstChunk?.byteLength || 0
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

    const baseName = resolveMseCaptureFileName()
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

    if (catchToolkitProjection.clearCacheOnComplete) {
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
    const baseName = resolveMseCaptureFileName()
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
    if (catchToolkitProjection.clearCacheOnComplete) {
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

  function drainMseResource(resourceKey: string) {
    const streamId = String(resourceKey || '').replace(/^mse-stream:/, '')
    const stream = mseStreams.get(streamId)
    if (!stream) {
      return null
    }
    clearMseFlushTimer(streamId)
    const retainedBuffers = normalizeBuffersForPlayback(stream.buffers)
    const retainedBuffer = retainedBuffers.length > 0
      ? combineArrayBuffers(retainedBuffers)
      : null
    stream.buffers = []
    stream.retainedBytes = 0
    stream.lastReportedBufferCount = stream.bufferCount
    stream.lastReportedBytes = stream.totalBytes
    emitMseStream(streamId)
    return {
      base64: retainedBuffer && retainedBuffer.byteLength > 0 ? arrayBufferToBase64(retainedBuffer) : undefined,
      fileName: createMseExportName(streamId),
      mimeType: stream.mimeType,
      resourceKey,
      streamType: stream.streamType,
    }
  }

  if (!isWorkerScope) {
    ensureTrackedMediaObserver()
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__.push(
    attachTrackedMediaElement,
    bindTrackedMediaElements,
    clearCatchMediaCacheInternal,
    createMseExportName,
    createMseResourceKey,
    downloadCatchMediaInternal,
    drainMseResource,
    emitMseStream,
    ensureMseStreamBlobUrl,
    ensureTrackedMediaObserver,
    exportMseResource,
    finalizeMseStream,
    openMseResource,
    readMseResource,
    restartCatchMediaCaptureInternal,
  )
}

export function embeddedBrowserMsePageRuntimeHooksBody() {
  const mediaSourceConstructor = globalScope.MediaSource
  if (mediaSourceConstructor?.prototype?.addSourceBuffer) {
    const originalAddSourceBuffer = mediaSourceConstructor.prototype.addSourceBuffer
    mediaSourceConstructor.prototype.addSourceBuffer = new Proxy(originalAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList) as SourceBuffer & {
          appendBuffer?: SourceBuffer['appendBuffer']
        }
        try {
          probeDiagnostics.mediaSourceHooked = true
          probeDiagnostics.sourceBufferCount += 1
          ensureTrackedMediaObserver()
          isCaptureComplete = false
          const mediaSource = thisArg as MediaSource
          const mimeType = String(argumentsList?.[0] || '').trim()
          const normalizedMimeType = mimeType.split(';')[0]?.trim().toLowerCase() || ''
          const streamType = normalizedMimeType.startsWith('audio/')
            ? 'audio'
            : normalizedMimeType.startsWith('video/')
              ? 'video'
              : undefined
          const streamId = `${Date.now()}-${++mseSequence}`
          const existingStreamIds = mediaSourceStreams.get(mediaSource) || []
          existingStreamIds.push(streamId)
          mediaSourceStreams.set(mediaSource, existingStreamIds)
          mseStreams.set(streamId, {
            blobUrl: '',
            bufferCount: 0,
            buffers: [],
            flushTimer: null,
            flushedBytes: 0,
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: mimeType || (streamType === 'audio' ? 'audio/mp4' : 'video/mp4'),
            retainedBytes: 0,
            streamId,
            streamType,
            totalBytes: 0,
          })

          emitMseStream(streamId)

          if (sourceBuffer && typeof sourceBuffer.appendBuffer === 'function') {
            const originalAppendBuffer = sourceBuffer.appendBuffer
            sourceBuffer.appendBuffer = new Proxy(originalAppendBuffer, {
              apply(appendTarget, appendThisArg, appendArgumentsList) {
                const appendResult = Reflect.apply(appendTarget, appendThisArg, appendArgumentsList)
                const stream = mseStreams.get(streamId)
                if (!stream) {
                  return appendResult
                }
                const chunk = cloneChunk(appendArgumentsList?.[0])
                if (!chunk || chunk.byteLength === 0) {
                  return appendResult
                }
                stream.buffers.push(chunk)
                stream.bufferCount += 1
                stream.retainedBytes += chunk.byteLength
                stream.totalBytes += chunk.byteLength
                probeDiagnostics.appendBufferCount += 1
                probeDiagnostics.lastAppendAt = Date.now()
                const shouldReport = (
                  stream.bufferCount <= 3
                  || stream.bufferCount - stream.lastReportedBufferCount >= 8
                  || stream.totalBytes - stream.lastReportedBytes >= 1024 * 512
                )
                if (shouldReport) {
                  stream.lastReportedBufferCount = stream.bufferCount
                  stream.lastReportedBytes = stream.totalBytes
                  emitMseStream(streamId)
                }
                if (stream.retainedBytes >= MSE_FLUSH_THRESHOLD_BYTES) {
                  scheduleMseStreamFlush(streamId)
                }
                return appendResult
              },
            })
          }
        } catch (error) {
          probeDiagnostics.hookErrors += 1
          probeDiagnostics.lastError = error instanceof Error ? error.message : String(error)
          // ignore MSE hook failures and keep playback usable
        }
        return sourceBuffer
      },
    })
  }

  if (mediaSourceConstructor?.prototype?.endOfStream) {
    const originalEndOfStream = mediaSourceConstructor.prototype.endOfStream
    mediaSourceConstructor.prototype.endOfStream = new Proxy(originalEndOfStream, {
      apply(target, thisArg, argumentsList) {
        const result = Reflect.apply(target, thisArg, argumentsList)
        try {
          isCaptureComplete = true
          const streamIds = mediaSourceStreams.get(thisArg as MediaSource) || []
          streamIds.forEach((streamId) => {
            finalizeMseStream(streamId)
          })
          if (catchToolkitProjection.autoDownloadOnComplete) {
            return result
          }
          if (catchToolkitProjection.clearCacheOnComplete) {
            setTimeout(() => {
              clearCatchMediaCacheInternal()
            }, 0)
          }
        } catch {
          // ignore MSE hook failures and keep playback usable
        }
        return result
      },
    })
  }
}

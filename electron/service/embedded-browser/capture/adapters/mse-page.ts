import {
  createMseRuntimeInstallerSource,
  type InstallMseRuntimeInput,
  type MseFlushEvent,
  type MseRuntime,
  type MseStreamSnapshot,
} from '../../cat-catch-port/mse/runtime'

type MsePageToolkitPreferences = {
  autoDownloadOnComplete: boolean
  autoSeekToBufferedEnd: boolean
  clearCacheOnComplete: boolean
  manualFileName: string
  regexRule: string
  regexWarning: string
  restartAlwaysFromBeginning: boolean
  saveEveryGigabyte: boolean
  selectorRule: string
  selectorWarning: string
  trimExtraMediaHeaders: boolean
}

type MsePageHostProbe = {
  clearCatchMediaCache?: () => boolean
  downloadCatchMedia?: () => boolean
  drainResource?: (resourceKey: string) => Record<string, unknown> | null
  exportResource?: (resourceKey: string) => boolean
  getCatchToolkitState?: () => Record<string, unknown>
  openResource?: (resourceKey: string) => boolean
  readResource?: (resourceKey: string) => Promise<Record<string, unknown> | null>
  restartCatchMediaCapture?: () => boolean
}

type MsePageScope = typeof globalThis & {
  MediaSource?: InstallMseRuntimeInput['scope']['MediaSource']
}

export type MsePageAdapter = {
  clear: () => boolean
  dispose: () => void
  download: () => boolean
  drainResource: (resourceKey: string) => Record<string, unknown> | null
  ensureTrackedMediaObserver: () => void
  exportResource: (resourceKey: string) => boolean
  getState: () => Record<string, unknown>
  isDisposed: () => boolean
  openResource: (resourceKey: string) => boolean
  readResource: (resourceKey: string) => Promise<Record<string, unknown> | null>
  restart: () => boolean
  runtime: MseRuntime
}

export type InstallMsePageAdapterInput = {
  arrayBufferToBase64: (buffer: ArrayBuffer) => string
  combineArrayBuffers: (buffers: ArrayBuffer[]) => ArrayBuffer
  document?: Document
  emitCapture: (payload: Record<string, unknown>) => void
  emitControl: (payload: Record<string, unknown>) => void
  guessExtension: (mimeType: string, streamType?: 'audio' | 'video') => string
  hostProbe: MsePageHostProbe
  largeOutputThresholdBytes?: number
  installRuntime: (input: InstallMseRuntimeInput) => MseRuntime
  preferences: MsePageToolkitPreferences
  resolveFileName: () => string
  scope: MsePageScope
}

/** Thin page adapter for the fixed Cat Catch MSE runtime. */
export function installMsePageAdapter(input: InstallMsePageAdapterInput): MsePageAdapter {
  const adapterSentinel = '__OMNIFLOW_CAT_CATCH_MSE_PAGE_ADAPTER_V1__'
  const flushThresholdBytes = 8 * 1024 * 1024
  const largeOutputThresholdBytes = Number.isFinite(Number(input.largeOutputThresholdBytes))
    && Number(input.largeOutputThresholdBytes) > 0
    ? Math.floor(Number(input.largeOutputThresholdBytes))
    : 1024 * 1024 * 1024
  const scopeRecord = input.scope as unknown as Record<string, unknown>
  const current = scopeRecord[adapterSentinel] as MsePageAdapter | undefined
  if (current && !current.isDisposed()) return current

  const blobUrls = new Map<string, string>()
  const lastReports = new Map<string, { bufferCount: number; totalBytes: number }>()
  const trackedMediaElements = new WeakSet<HTMLMediaElement>()
  const restartedMediaElements = new WeakSet<HTMLMediaElement>()
  let disposed = false
  let lastAppendAt = 0
  let lastAppendBufferCount = 0
  let lastError = ''
  let autoDownloadScheduled = false
  let lastLargeOutputThreshold = 0
  let observer: MutationObserver | null = null

  const createResourceKey = (streamId: string) => `mse-stream:${streamId}`
  const resolveStreamId = (resourceKey: string) => {
    const normalized = String(resourceKey || '')
    return normalized.startsWith('mse-stream:')
      ? normalized.slice('mse-stream:'.length)
      : ''
  }
  const streamFileName = (stream: Pick<MseStreamSnapshot, 'mimeType' | 'streamType'>) => {
    const suffix = stream.streamType ? `-${stream.streamType}` : ''
    return `${input.resolveFileName()}${suffix}.${input.guessExtension(stream.mimeType, stream.streamType)}`
  }
  const revokeBlobUrl = (streamId: string) => {
    const blobUrl = blobUrls.get(streamId)
    if (!blobUrl) return
    blobUrls.delete(streamId)
    try {
      input.scope.URL.revokeObjectURL(blobUrl)
    } catch {
      // The document may already have released its URL registry.
    }
  }
  const getBytes = (chunk: ArrayBuffer) => new input.scope.Uint8Array(chunk)
  const isHeaderChunk = (chunk: ArrayBuffer) => {
    const data = getBytes(chunk)
    return (
      data.length > 8
      && data[4] === 0x66
      && data[5] === 0x74
      && data[6] === 0x79
      && data[7] === 0x70
    ) || (
      data.length > 4
      && data[0] === 0x1A
      && data[1] === 0x45
      && data[2] === 0xDF
      && data[3] === 0xA3
    )
  }
  const normalizeBuffers = (buffers: ArrayBuffer[]) => {
    if (!input.preferences.trimExtraMediaHeaders || buffers.length <= 1) return buffers
    let lastHeaderIndex = -1
    buffers.forEach((chunk, index) => {
      if (isHeaderChunk(chunk)) lastHeaderIndex = index
    })
    return lastHeaderIndex > 0 ? buffers.slice(lastHeaderIndex) : buffers
  }
  const emitStream = (stream: MseStreamSnapshot) => {
    input.emitCapture({
      contentLength: stream.totalBytes,
      ext: input.guessExtension(stream.mimeType, stream.streamType),
      kind: 'media',
      mimeType: stream.mimeType,
      resourceKey: createResourceKey(stream.streamId),
      resourceType: 'mse-stream',
      source: 'probe',
      streamType: stream.streamType,
      url: blobUrls.get(stream.streamId) || `mse://capturing/${stream.streamId}`,
    })
  }
  const shouldReport = (stream: MseStreamSnapshot) => {
    const previous = lastReports.get(stream.streamId)
    return !previous
      || stream.bufferCount <= 3
      || stream.bufferCount - previous.bufferCount >= 8
      || stream.totalBytes - previous.totalBytes >= 512 * 1024
  }
  const reportStream = (stream: MseStreamSnapshot, force = false) => {
    if (!force && !shouldReport(stream)) return
    lastReports.set(stream.streamId, {
      bufferCount: stream.bufferCount,
      totalBytes: stream.totalBytes,
    })
    emitStream(stream)
  }
  const flushToMain = (event: MseFlushEvent) => {
    const combined = input.combineArrayBuffers(normalizeBuffers(event.chunks))
    if (combined.byteLength === 0) return false
    const trimBeforeHeader = input.preferences.trimExtraMediaHeaders
      && event.chunks.some(isHeaderChunk)
    input.emitControl({
      base64: input.arrayBufferToBase64(combined),
      capturedAt: Date.now(),
      event: 'mse-flush',
      fileName: streamFileName(event),
      mimeType: event.mimeType,
      resourceKey: createResourceKey(event.streamId),
      streamType: event.streamType,
      trimBeforeHeader,
    })
    return true
  }

  function maybeEmitLargeOutputSave(stream: MseStreamSnapshot) {
    if (!input.preferences.saveEveryGigabyte || stream.flushedBytes <= 0) return
    const reachedThreshold = Math.floor(runtime.getSnapshot().totalBytes / largeOutputThresholdBytes)
    if (reachedThreshold <= lastLargeOutputThreshold) return
    lastLargeOutputThreshold = reachedThreshold
    input.emitControl({
      event: 'mse-save',
      resourceKey: createResourceKey(stream.streamId),
      streamType: stream.streamType,
    })
  }

  const runtime: MseRuntime = input.installRuntime({
    flushThresholdBytes,
    onComplete: ({ streamIds }) => {
      for (const streamId of streamIds) {
        const stream = runtime.getSnapshot().streams.find(item => item.streamId === streamId)
        if (stream) reportStream(stream, true)
      }
      if (input.preferences.autoDownloadOnComplete) {
        if (!autoDownloadScheduled) {
          autoDownloadScheduled = true
          const hasFlushedStream = streamIds.some((streamId) => (
            Boolean(runtime.getSnapshot().streams.find(stream => stream.streamId === streamId)?.flushedBytes)
          ))
          if (hasFlushedStream) {
            const resourceKey = streamIds[0] ? createResourceKey(streamIds[0]) : ''
            if (resourceKey) {
              input.emitControl({
                event: 'mse-complete',
                resourceKey,
              })
            }
          } else {
            input.scope.setTimeout(() => adapter.download(), 500)
          }
        }
      } else if (input.preferences.clearCacheOnComplete) {
        input.scope.setTimeout(() => adapter.clear(), 0)
      }
    },
    onError: (error) => {
      lastError = error instanceof Error ? error.message : String(error)
    },
    onFlush: flushToMain,
    onReset: (event) => {
      revokeBlobUrl(event.streamId)
      input.emitControl({
        capturedAt: Date.now(),
        event: 'mse-reset',
        resourceKey: createResourceKey(event.streamId),
      })
    },
    onStreamChanged: (stream) => {
      const snapshot = runtime?.getSnapshot()
      if (snapshot && snapshot.appendBufferCount !== lastAppendBufferCount) {
        lastAppendBufferCount = snapshot.appendBufferCount
        lastAppendAt = Date.now()
      }
      reportStream(stream)
      maybeEmitLargeOutputSave(stream)
    },
    scope: {
      ArrayBuffer: input.scope.ArrayBuffer,
      MediaSource: input.scope.MediaSource,
      Uint8Array: input.scope.Uint8Array,
    },
  })

  const getStream = (streamId: string) => (
    runtime.getSnapshot().streams.find(stream => stream.streamId === streamId) || null
  )
  const buildState = () => {
    const snapshot = runtime.getSnapshot()
    const sortedStreams = [...snapshot.streams].sort((left, right) => (
      right.totalBytes - left.totalBytes || left.streamId.localeCompare(right.streamId)
    ))
    const primaryStream = sortedStreams[0]
    const audioStream = sortedStreams.find(stream => stream.streamType === 'audio')
    const videoStream = sortedStreams.find(stream => stream.streamType === 'video')
    return {
      audioResourceKey: audioStream ? createResourceKey(audioStream.streamId) : '',
      audioSizeBytes: audioStream?.totalBytes || 0,
      autoDownloadOnComplete: input.preferences.autoDownloadOnComplete,
      autoSeekToBufferedEnd: input.preferences.autoSeekToBufferedEnd,
      capturedMediaSizeBytes: snapshot.totalBytes,
      clearCacheOnComplete: input.preferences.clearCacheOnComplete,
      currentFileName: input.resolveFileName(),
      diagnostics: {
        appendBufferCount: snapshot.appendBufferCount,
        frameUrl: String(input.scope.location?.href || ''),
        hookErrors: lastError ? 1 : 0,
        installedAt: Number((input.hostProbe as { installedAt?: number }).installedAt || Date.now()),
        lastAppendAt,
        lastError,
        mediaSourceAvailable: typeof input.scope.MediaSource !== 'undefined',
        mediaSourceHooked: Boolean(runtime.nativeAddSourceBuffer),
        sourceBufferCount: snapshot.sourceBufferCount,
      },
      isCaptureComplete: snapshot.isComplete,
      manualFileName: input.preferences.manualFileName,
      primaryResourceKey: primaryStream ? createResourceKey(primaryStream.streamId) : '',
      regexWarning: input.preferences.regexWarning,
      regexRule: input.preferences.regexRule,
      restartAlwaysFromBeginning: input.preferences.restartAlwaysFromBeginning,
      saveEveryGigabyte: input.preferences.saveEveryGigabyte,
      selectorWarning: input.preferences.selectorWarning,
      selectorRule: input.preferences.selectorRule,
      streamCount: snapshot.streamCount,
      trimExtraMediaHeaders: input.preferences.trimExtraMediaHeaders,
      videoResourceKey: videoStream ? createResourceKey(videoStream.streamId) : '',
      videoSizeBytes: videoStream?.totalBytes || 0,
    }
  }
  const createBlobUrl = (streamId: string) => {
    const currentUrl = blobUrls.get(streamId)
    if (currentUrl) return currentUrl
    const stream = getStream(streamId)
    const buffers = runtime.readStream(streamId)
    if (!stream || !buffers?.length || stream.flushedBytes > 0) return ''
    const blobUrl = input.scope.URL.createObjectURL(new input.scope.Blob(
      normalizeBuffers(buffers),
      { type: stream.mimeType },
    ))
    blobUrls.set(streamId, blobUrl)
    reportStream(stream, true)
    return blobUrl
  }
  const readResource = async (resourceKey: string) => {
    const streamId = resolveStreamId(resourceKey)
    const stream = getStream(streamId)
    const buffers = runtime.readStream(streamId)
    if (!stream || !buffers?.length) return null
    const combined = input.combineArrayBuffers(normalizeBuffers(buffers))
    return {
      base64: input.arrayBufferToBase64(combined),
      fileName: streamFileName(stream),
      mimeType: stream.mimeType,
      resourceKey,
      streamType: stream.streamType,
    }
  }
  const drainResource = (resourceKey: string) => {
    const streamId = resolveStreamId(resourceKey)
    const drained = runtime.drainStream(streamId)
    if (!drained) return null
    const buffers = normalizeBuffers(drained.chunks)
    const combined = buffers.length ? input.combineArrayBuffers(buffers) : null
    return {
      base64: combined?.byteLength ? input.arrayBufferToBase64(combined) : undefined,
      fileName: streamFileName(drained),
      mimeType: drained.mimeType,
      resourceKey,
      streamType: drained.streamType,
    }
  }
  const exportResource = (resourceKey: string) => {
    if (!input.document) return false
    const streamId = resolveStreamId(resourceKey)
    const stream = getStream(streamId)
    const blobUrl = createBlobUrl(streamId)
    if (!stream || !blobUrl) return false
    const anchor = input.document.createElement('a')
    anchor.href = blobUrl
    anchor.download = streamFileName(stream)
    anchor.click()
    anchor.remove()
    if (input.preferences.clearCacheOnComplete) {
      input.scope.setTimeout(() => adapter.clear(), 0)
    }
    return true
  }
  const openResource = (resourceKey: string) => {
    const blobUrl = createBlobUrl(resolveStreamId(resourceKey))
    if (!blobUrl || typeof input.scope.open !== 'function') return false
    input.scope.open(blobUrl, '_blank', 'noopener,noreferrer')
    return true
  }
  const clear = () => {
    autoDownloadScheduled = false
    lastLargeOutputThreshold = 0
    for (const streamId of blobUrls.keys()) revokeBlobUrl(streamId)
    return runtime.clear()
  }
  const download = () => {
    const streams = runtime.getSnapshot().streams
    if (!streams.length || streams.some(stream => stream.flushedBytes > 0)) return false
    let downloaded = false
    for (const stream of streams) {
      downloaded = exportResource(createResourceKey(stream.streamId)) || downloaded
    }
    return downloaded
  }
  const attachMediaElement = (element: HTMLMediaElement) => {
    if (trackedMediaElements.has(element)) return
    trackedMediaElements.add(element)
    element.addEventListener('progress', () => {
      if (!input.preferences.autoSeekToBufferedEnd) return
      try {
        if (!element.buffered?.length) return
        const bufferedEnd = element.buffered.end(0)
        const duration = Number.isFinite(element.duration) ? element.duration : 0
        if (duration > 0 && bufferedEnd >= duration) return
        const targetTime = Math.max(bufferedEnd - 5, 0)
        if (Math.abs(element.currentTime - targetTime) > 1) element.currentTime = targetTime
      } catch {
        // Sparse buffer ranges can disappear while they are inspected.
      }
    })
    const restartFromBeginning = () => {
      if (!input.preferences.restartAlwaysFromBeginning || restartedMediaElements.has(element)) return
      restartedMediaElements.add(element)
      clear()
      try {
        element.currentTime = 0
      } catch {
        // Some page-owned media elements reject programmatic seeking.
      }
    }
    element.addEventListener('play', restartFromBeginning, { once: true })
  }
  const ensureTrackedMediaObserver = () => {
    if (!input.document || observer || typeof input.scope.MutationObserver === 'undefined') return
    input.document.querySelectorAll('video, audio').forEach((node) => {
      if (node instanceof input.scope.HTMLMediaElement) attachMediaElement(node)
    })
    const target = input.document.body || input.document.documentElement
    if (!target) return
    observer = new input.scope.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof input.scope.Element)) continue
          if (node instanceof input.scope.HTMLMediaElement) attachMediaElement(node)
          node.querySelectorAll('video, audio').forEach((child) => {
            if (child instanceof input.scope.HTMLMediaElement) attachMediaElement(child)
          })
        }
      }
    })
    observer.observe(target, { childList: true, subtree: true })
  }
  const restart = () => {
    if (!input.document) return false
    clear()
    let restarted = false
    input.document.querySelectorAll('video, audio').forEach((node) => {
      if (!(node instanceof input.scope.HTMLMediaElement)) return
      try {
        node.currentTime = 0
        void node.play().catch(() => undefined)
        restarted = true
      } catch {
        // Ignore elements that cannot be controlled by the page runtime.
      }
    })
    return restarted
  }

  const adapter: MsePageAdapter = {
    clear,
    dispose() {
      if (disposed) return
      disposed = true
      autoDownloadScheduled = false
      observer?.disconnect()
      observer = null
      for (const streamId of blobUrls.keys()) revokeBlobUrl(streamId)
      runtime.dispose()
      if (scopeRecord[adapterSentinel] === adapter) delete scopeRecord[adapterSentinel]
    },
    download,
    drainResource,
    ensureTrackedMediaObserver,
    exportResource,
    getState: buildState,
    isDisposed: () => disposed,
    openResource,
    readResource,
    restart,
    runtime,
  }
  ensureTrackedMediaObserver()
  Object.defineProperty(scopeRecord, adapterSentinel, {
    configurable: true,
    value: adapter,
  })
  return adapter
}

export function createMsePageAdapterBodySource() {
  return [
    `const installMseRuntime = ${createMseRuntimeInstallerSource()};`,
    `const installMsePageAdapter = (${installMsePageAdapter.toString()});`,
    'const msePageAdapter = installMsePageAdapter({',
    '  arrayBufferToBase64,',
    '  combineArrayBuffers,',
    "  document: typeof document === 'undefined' ? undefined : document,",
    '  emitCapture: emit,',
    '  emitControl: emitProbeConsolePayload,',
    '  guessExtension: guessExtensionFromMimeType,',
    '  hostProbe: globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__,',
    '  installRuntime: installMseRuntime,',
    '  preferences: catchToolkitProjection,',
    '  resolveFileName: resolveMseCaptureFileName,',
    '  scope: globalScope,',
    '});',
  ].join('\n')
}

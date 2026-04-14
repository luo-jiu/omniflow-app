/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
export const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:'

export function createEmbeddedBrowserResourceProbeScript() {
  return `(${embeddedBrowserResourceProbe.toString()})(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX)});`
}

function embeddedBrowserResourceProbe(consolePrefix: string) {
  const globalScope = window as Window & {
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?: {
      exportResource?: (resourceKey: string) => boolean
      installedAt: number
      openResource?: (resourceKey: string) => boolean
      readResource?: (resourceKey: string) => Promise<null | {
        base64: string
        fileName: string
        mimeType?: string
        resourceKey: string
        streamType?: 'audio' | 'video'
      }>
      seen: Set<string>
    }
  }

  if (globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__) {
    return 'already-installed'
  }

  const seen = new Set<string>()
  const mseStreams = new Map<string, {
    blobUrl: string
    bufferCount: number
    buffers: ArrayBuffer[]
    lastReportedBufferCount: number
    lastReportedBytes: number
    mimeType: string
    streamId: string
    streamType?: 'audio' | 'video'
    totalBytes: number
  }>()
  const mediaSourceStreams = new WeakMap<MediaSource, string[]>()
  let mseSequence = 0

  const manifestExtensions = new Set(['m3u8', 'mpd'])
  const mediaExtensions = new Set([
    'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'ogv',
    'webm', 'mkv', 'mov', 'avi', 'ts', 'flv',
  ])
  const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
  const subtitleExtensions = new Set(['vtt', 'srt', 'ass', 'ssa', 'ttml'])
  const dataUrlPattern = /^data:(application|video|audio)\//i
  const likelyUrlPattern = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i
  const manifestPattern = /(m3u8|mpd)(\?|$)/i
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv)(\?|$)/i
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|$)/i
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml)(\?|$)/i
  const pdfPattern = /\.pdf(\?|$)/i
  const originalConsoleInfo = typeof console.info === 'function'
    ? console.info.bind(console)
    : console.log.bind(console)

  function toAbsoluteUrl(input: unknown): string {
    if (typeof input !== 'string') {
      return ''
    }
    const value = input.trim()
    if (!value || value.startsWith('data:')) {
      return ''
    }
    if (value.startsWith('//')) {
      return `${location.protocol}${value}`
    }
    if (value.startsWith('blob:')) {
      return value
    }
    try {
      if (likelyUrlPattern.test(value)) {
        return new URL(value, location.href).toString()
      }
      if (/^https?:\/\//i.test(value)) {
        return value
      }
    } catch {
      return ''
    }
    return ''
  }

  function getExtension(url: string): string {
    try {
      const pathname = new URL(url, location.href).pathname || ''
      const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/i)
      return match?.[1] || ''
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)
      return match?.[1] || ''
    }
  }

  function classifyKind(url: string, mimeType?: string): 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'other' {
    const extension = getExtension(url)
    const normalizedMimeType = String(mimeType || '').split(';')[0]?.trim().toLowerCase()
    if (
      manifestExtensions.has(extension)
      || normalizedMimeType.includes('mpegurl')
      || normalizedMimeType.includes('dash+xml')
      || manifestPattern.test(url)
    ) {
      return 'manifest'
    }
    if (
      mediaExtensions.has(extension)
      || normalizedMimeType.startsWith('video/')
      || normalizedMimeType.startsWith('audio/')
      || mediaPattern.test(url)
      || url.startsWith('blob:')
    ) {
      return 'media'
    }
    if (imageExtensions.has(extension) || normalizedMimeType.startsWith('image/') || imagePattern.test(url)) {
      return 'image'
    }
    if (subtitleExtensions.has(extension) || normalizedMimeType.includes('text/vtt') || subtitlePattern.test(url)) {
      return 'subtitle'
    }
    if (extension === 'pdf' || normalizedMimeType === 'application/pdf' || pdfPattern.test(url)) {
      return 'document'
    }
    return 'other'
  }

  function guessExtensionFromMimeType(
    mimeType: string,
    streamType?: 'audio' | 'video',
  ) {
    const normalizedMimeType = String(mimeType || '').split(';')[0]?.trim().toLowerCase()
    if (normalizedMimeType === 'audio/mp4') {
      return 'm4a'
    }
    if (normalizedMimeType === 'video/mp4') {
      return 'mp4'
    }
    if (normalizedMimeType === 'audio/mpeg') {
      return 'mp3'
    }
    if (normalizedMimeType === 'audio/aac') {
      return 'aac'
    }
    if (normalizedMimeType.endsWith('/webm')) {
      return 'webm'
    }
    if (normalizedMimeType.endsWith('/ogg')) {
      return 'ogg'
    }
    if (normalizedMimeType.endsWith('/wav')) {
      return 'wav'
    }
    if (streamType === 'audio') {
      return 'm4a'
    }
    return 'mp4'
  }

  function sanitizeFileName(input: string) {
    const safeName = String(input || '').replace(/[\\/:*?"<>|]+/g, '_').trim()
    return safeName || 'media'
  }

  function cloneChunk(input: unknown) {
    if (input instanceof ArrayBuffer) {
      return input.slice(0)
    }
    if (ArrayBuffer.isView(input)) {
      return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    }
    return null
  }

  function arrayBufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    let binary = ''
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length))
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  function isMp4HeaderChunk(chunk: ArrayBuffer) {
    const data = new Uint8Array(chunk)
    return (
      data.length > 8
      && data[4] === 0x66
      && data[5] === 0x74
      && data[6] === 0x79
      && data[7] === 0x70
    )
  }

  function isWebmHeaderChunk(chunk: ArrayBuffer) {
    const data = new Uint8Array(chunk)
    return (
      data.length > 4
      && data[0] === 0x1A
      && data[1] === 0x45
      && data[2] === 0xDF
      && data[3] === 0xA3
    )
  }

  function normalizeBuffersForPlayback(buffers: ArrayBuffer[]) {
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

  function emit(payload: {
    contentLength?: number
    ext?: string
    kind?: 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'other'
    mimeType?: string
    resourceKey?: string
    resourceType?: string
    source: 'probe'
    streamType?: 'audio' | 'video'
    url: string
  }) {
    if (!payload.url) {
      return
    }
    if (payload.resourceType !== 'mse-stream') {
      const dedupeKey = `${payload.resourceKey || payload.source}:${payload.resourceType || 'unknown'}:${payload.url}`
      if (seen.has(dedupeKey)) {
        return
      }
      seen.add(dedupeKey)
      if (seen.size > 2000) {
        seen.clear()
        seen.add(dedupeKey)
      }
    }
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify({
        capturedAt: Date.now(),
        contentLength: payload.contentLength,
        ext: payload.ext,
        kind: payload.kind || classifyKind(payload.url, payload.mimeType),
        mimeType: payload.mimeType,
        pageUrl: location.href,
        resourceKey: payload.resourceKey,
        resourceType: payload.resourceType || 'probe',
        source: payload.source,
        streamType: payload.streamType,
        url: payload.url,
      }))
    } catch {
      // ignore probe transport failures
    }
  }

  function inferStreamTypeFromPath(path: string[]) {
    const normalizedPath = path.map((item) => String(item || '').toLowerCase())
    if (normalizedPath.some((item) => item === 'audio' || item.includes('audio'))) {
      return 'audio' as const
    }
    if (normalizedPath.some((item) => item === 'video' || item.includes('video'))) {
      return 'video' as const
    }
    return undefined
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
    const baseName = sanitizeFileName(document.title || location.hostname || 'media')
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
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = createMseExportName(streamId)
    anchor.click()
    anchor.remove()
    return true
  }

  function openMseResource(resourceKey: string) {
    const streamId = String(resourceKey || '').replace(/^mse-stream:/, '')
    const blobUrl = ensureMseStreamBlobUrl(streamId)
    if (!blobUrl) {
      return false
    }
    window.open(blobUrl, '_blank', 'noopener,noreferrer')
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

  const mediaSourceConstructor = window.MediaSource
  if (mediaSourceConstructor?.prototype?.addSourceBuffer) {
    const originalAddSourceBuffer = mediaSourceConstructor.prototype.addSourceBuffer
    mediaSourceConstructor.prototype.addSourceBuffer = new Proxy(originalAddSourceBuffer, {
      apply(target, thisArg, argumentsList) {
        const sourceBuffer = Reflect.apply(target, thisArg, argumentsList) as SourceBuffer & {
          appendBuffer?: SourceBuffer['appendBuffer']
        }
        try {
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
            lastReportedBufferCount: 0,
            lastReportedBytes: 0,
            mimeType: mimeType || (streamType === 'audio' ? 'audio/mp4' : 'video/mp4'),
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
                stream.totalBytes += chunk.byteLength
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
                return appendResult
              },
            })
          }
        } catch {
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
          const streamIds = mediaSourceStreams.get(thisArg as MediaSource) || []
          streamIds.forEach((streamId) => {
            finalizeMseStream(streamId)
          })
        } catch {
          // ignore MSE hook failures and keep playback usable
        }
        return result
      },
    })
  }

  function reportCandidate(
    input: unknown,
    meta?: { mimeType?: string; resourceType?: string; streamType?: 'audio' | 'video' },
  ) {
    if (typeof input !== 'string') {
      return
    }
    const value = input.trim()
    if (!value) {
      return
    }
    if (dataUrlPattern.test(value)) {
      return
    }
    const absoluteUrl = toAbsoluteUrl(value)
    if (!absoluteUrl) {
      return
    }
    emit({
      kind: classifyKind(absoluteUrl, meta?.mimeType),
      mimeType: meta?.mimeType,
      resourceType: meta?.resourceType,
      source: 'probe',
      streamType: meta?.streamType,
      url: absoluteUrl,
    })
  }

  function walkValue(value: unknown, depth = 0, visited = new WeakSet<object>(), path: string[] = []) {
    if (depth > 6 || value == null) {
      return
    }
    if (typeof value === 'string') {
      reportCandidate(value, {
        resourceType: 'json',
        streamType: inferStreamTypeFromPath(path),
      })
      return
    }
    if (typeof value !== 'object') {
      return
    }
    const objectValue = value as object
    if (visited.has(objectValue)) {
      return
    }
    visited.add(objectValue)

    if (Array.isArray(value)) {
      value.slice(0, 80).forEach((item, index) => {
        walkValue(item, depth + 1, visited, path.concat(String(index)))
      })
      return
    }

    Object.keys(value as Record<string, unknown>).slice(0, 80).forEach((key) => {
      walkValue((value as Record<string, unknown>)[key], depth + 1, visited, path.concat(key))
    })
  }

  const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null
  if (originalFetch) {
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input)
      reportCandidate(requestUrl, { resourceType: 'fetch' })
      const response = await originalFetch(input, init)
      reportCandidate(response.url || requestUrl, {
        mimeType: response.headers.get('content-type') || undefined,
        resourceType: 'fetch',
      })
      return response
    }
  }

  const xhrUrlKey = '__OMNIFLOW_RESOURCE_PROBE_XHR_URL__'
  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
    ;(this as XMLHttpRequest & Record<string, unknown>)[xhrUrlKey] = typeof url === 'string' ? url : String(url)
    return originalOpen.apply(this, arguments as any)
  }

  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('loadend', function () {
      const rawUrl = (this as XMLHttpRequest & Record<string, unknown>)[xhrUrlKey]
      const responseUrl = this.responseURL || (typeof rawUrl === 'string' ? rawUrl : '')
      reportCandidate(responseUrl, {
        mimeType: this.getResponseHeader('content-type') || undefined,
        resourceType: 'xhr',
      })
    }, { once: true })
    return originalSend.apply(this, arguments as any)
  }

  const originalJSONParse = JSON.parse.bind(JSON)
  JSON.parse = function () {
    const value = originalJSONParse.apply(this, arguments as any)
    walkValue(value)
    return value
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
    exportResource(resourceKey: string) {
      if (!String(resourceKey || '').startsWith('mse-stream:')) {
        return false
      }
      return exportMseResource(resourceKey)
    },
    installedAt: Date.now(),
    openResource(resourceKey: string) {
      if (!String(resourceKey || '').startsWith('mse-stream:')) {
        return false
      }
      return openMseResource(resourceKey)
    },
    readResource(resourceKey: string) {
      if (!String(resourceKey || '').startsWith('mse-stream:')) {
        return Promise.resolve(null)
      }
      return readMseResource(resourceKey)
    },
    seen,
  }

  return 'installed'
}

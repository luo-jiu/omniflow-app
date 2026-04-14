/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
export const EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:'

export function createEmbeddedBrowserResourceProbeScript() {
  return `(${embeddedBrowserResourceProbe.toString()})(${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX)});`
}

function embeddedBrowserResourceProbe(consolePrefix: string) {
  type ProbeResourceKind = 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other'
  type ProbeStreamType = 'audio' | 'video'
  type ProbeEmitPayload = {
    contentLength?: number
    ext?: string
    kind?: ProbeResourceKind
    mimeType?: string
    resourceKey?: string
    resourceType?: string
    source: 'probe'
    streamType?: ProbeStreamType
    url: string
  }
  type ProbeGeneratedResourcePayload = {
    base64: string
    ext: string
    kind: 'manifest' | 'key'
    mimeType: string
    resourceType: 'inline-manifest' | 'key'
    signature: string
    streamType?: ProbeStreamType
  }
  type ProbeRelayEnvelope =
    | { payload: ProbeEmitPayload; type: 'capture' }
    | { payload: ProbeGeneratedResourcePayload; type: 'generated-resource' }

  const globalScope = globalThis as typeof globalThis & {
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?: {
      exportResource?: (resourceKey: string) => boolean
      installedAt: number
      openResource?: (resourceKey: string) => boolean
      readResource?: (resourceKey: string) => Promise<null | {
        base64: string
        fileName: string
        mimeType?: string
        resourceKey: string
        streamType?: ProbeStreamType
      }>
      seen: Set<string>
    }
  }
  const isWorkerScope = typeof document === 'undefined'
    && typeof (globalScope as typeof globalScope & { importScripts?: unknown }).importScripts === 'function'
  const currentLocationHref = typeof globalScope.location?.href === 'string' ? globalScope.location.href : ''
  const currentLocationHost = typeof globalScope.location?.hostname === 'string' ? globalScope.location.hostname : 'resource'
  const currentLocationProtocol = typeof globalScope.location?.protocol === 'string' ? globalScope.location.protocol : 'https:'
  const currentDocumentTitle = typeof document !== 'undefined' && typeof document.title === 'string'
    ? document.title
    : ''
  const workerRelayKey = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__'
  const openWindow = typeof globalScope.open === 'function'
    ? globalScope.open.bind(globalScope)
    : null

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
  const probeResources = new Map<string, {
    base64: string
    blobUrl: string
    contentLength: number
    fileName: string
    mimeType?: string
    streamType?: 'audio' | 'video'
  }>()
  const probeResourceKeysBySignature = new Map<string, string>()
  const mediaSourceStreams = new WeakMap<MediaSource, string[]>()
  let mseSequence = 0
  let probeResourceSequence = 0

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
  const originalJSONParse = JSON.parse.bind(JSON)
  const originalConsoleInfo = typeof console.info === 'function'
    ? console.info.bind(console)
    : console.log.bind(console)
  let m3u8Accumulator = ''

  function toAbsoluteUrl(input: unknown): string {
    if (typeof input !== 'string') {
      return ''
    }
    const value = input.trim()
    if (!value || value.startsWith('data:')) {
      return ''
    }
    if (value.startsWith('//')) {
      return `${currentLocationProtocol}${value}`
    }
    if (value.startsWith('blob:')) {
      return value
    }
    try {
      if (likelyUrlPattern.test(value)) {
        return new URL(value, currentLocationHref).toString()
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
      const pathname = new URL(url, currentLocationHref).pathname || ''
      const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/i)
      return match?.[1] || ''
    } catch {
      const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)
      return match?.[1] || ''
    }
  }

  function classifyKind(url: string, mimeType?: string): 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other' {
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

  function textToBase64(text: string) {
    return arrayBufferToBase64(new TextEncoder().encode(text).buffer)
  }

  function base64ToArrayBuffer(base64: string) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes.buffer
  }

  function isLikelyBase64Key(value: string) {
    const normalizedValue = String(value || '').trim()
    return normalizedValue.length === 24
      && normalizedValue.endsWith('==')
      && /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedValue)
  }

  function isLikelyHexKey(value: string) {
    return /^[A-Fa-f0-9]{32}$/.test(String(value || '').trim())
  }

  function getBaseUrl(url: string) {
    try {
      const currentUrl = new URL(url, currentLocationHref)
      const parts = currentUrl.toString().split('/')
      parts.pop()
      return `${parts.join('/')}/`
    } catch {
      return ''
    }
  }

  function addBaseUrl(baseUrl: string, m3u8Text: string) {
    if (!baseUrl || !m3u8Text) {
      return m3u8Text
    }
    return m3u8Text.split('\n').map((line) => {
      const currentLine = line.trim()
      if (!currentLine || currentLine.startsWith('#')) {
        if (currentLine.includes('URI="')) {
          return currentLine.replace(/URI="(.*)"/, (_input, keyUrl) => {
            if (toAbsoluteUrl(keyUrl)) {
              return `URI="${keyUrl}"`
            }
            return `URI="${baseUrl}${keyUrl}"`
          })
        }
        return line
      }
      if (toAbsoluteUrl(currentLine)) {
        return currentLine
      }
      if (currentLine.startsWith('/')) {
        try {
          const parsedBaseUrl = new URL(baseUrl)
          return `${parsedBaseUrl.protocol}//${parsedBaseUrl.host}${currentLine}`
        } catch {
          return `${baseUrl}${currentLine.replace(/^\//, '')}`
        }
      }
      return `${baseUrl}${currentLine}`
    }).join('\n')
  }

  function parseMaybeJson(value: string) {
    const normalizedValue = String(value || '').trim()
    if (!normalizedValue || !/^[\[{]/.test(normalizedValue)) {
      return null
    }
    try {
      return originalJSONParse(normalizedValue)
    } catch {
      return null
    }
  }

  function decodeDataUrlText(value: string) {
    const normalizedValue = String(value || '').trim()
    if (!dataUrlPattern.test(normalizedValue)) {
      return ''
    }
    const commaIndex = normalizedValue.indexOf(',')
    if (commaIndex === -1) {
      return ''
    }
    const metadata = normalizedValue.slice(0, commaIndex)
    const data = normalizedValue.slice(commaIndex + 1)
    try {
      if (/;base64/i.test(metadata)) {
        return new TextDecoder().decode(base64ToArrayBuffer(data))
      }
      return decodeURIComponent(data)
    } catch {
      return ''
    }
  }

  function isRepeatedExpansion(buffer: ArrayBuffer, chunkSize = 16) {
    if (buffer.byteLength <= chunkSize || buffer.byteLength % chunkSize !== 0) {
      return null
    }
    const bytes = new Uint8Array(buffer)
    const firstChunk = bytes.slice(0, chunkSize)
    for (let offset = chunkSize; offset < bytes.length; offset += chunkSize) {
      for (let index = 0; index < chunkSize; index += 1) {
        if (bytes[offset + index] !== firstChunk[index]) {
          return null
        }
      }
    }
    return firstChunk.buffer
  }

  function normalizePotentialKeyBuffer(buffer: ArrayBuffer) {
    if (buffer.byteLength === 16) {
      return buffer.slice(0)
    }
    if (buffer.byteLength === 32) {
      const repeatedBuffer = isRepeatedExpansion(buffer, 16)
      return repeatedBuffer || buffer.slice(0, 16)
    }
    if (buffer.byteLength === 128 || buffer.byteLength === 256) {
      return isRepeatedExpansion(buffer, 16)
    }
    return null
  }

  function createProbeResourceKey() {
    probeResourceSequence += 1
    return `probe-resource:${Date.now()}-${probeResourceSequence}`
  }

  function createProbeResourceFileName(kind: 'manifest' | 'key', ext: string) {
    const fileStem = kind === 'key'
      ? `${currentDocumentTitle || currentLocationHost || 'resource'}-key`
      : currentDocumentTitle || currentLocationHost || 'resource'
    return `${sanitizeFileName(fileStem)}.${ext}`
  }

  function createProbeBlobResource(input: {
    base64: string
    ext: string
    kind: 'manifest' | 'key'
    mimeType: string
    signature: string
    streamType?: 'audio' | 'video'
  }) {
    const existingKey = probeResourceKeysBySignature.get(input.signature)
    if (existingKey) {
      const existingResource = probeResources.get(existingKey)
      if (existingResource) {
        return {
          contentLength: existingResource.contentLength,
          fileName: existingResource.fileName,
          resourceKey: existingKey,
          url: existingResource.blobUrl,
        }
      }
    }

    const blob = new Blob([base64ToArrayBuffer(input.base64)], { type: input.mimeType })
    const resourceKey = createProbeResourceKey()
    const fileName = createProbeResourceFileName(input.kind, input.ext)
    const blobUrl = URL.createObjectURL(blob)
    probeResourceKeysBySignature.set(input.signature, resourceKey)
    probeResources.set(resourceKey, {
      base64: input.base64,
      blobUrl,
      contentLength: blob.size,
      fileName,
      mimeType: input.mimeType,
      streamType: input.streamType,
    })
    return {
      contentLength: blob.size,
      fileName,
      resourceKey,
      url: blobUrl,
    }
  }

  function relayEnvelope(envelope: ProbeRelayEnvelope) {
    if (!isWorkerScope || typeof globalScope.postMessage !== 'function') {
      return false
    }
    try {
      globalScope.postMessage({ [workerRelayKey]: envelope })
      return true
    } catch {
      return false
    }
  }

  function emitGeneratedResource(input: ProbeGeneratedResourcePayload, fromRelay = false) {
    if (isWorkerScope && !fromRelay) {
      relayEnvelope({ payload: input, type: 'generated-resource' })
      return
    }
    const resource = createProbeBlobResource(input)
    emit({
      contentLength: resource.contentLength,
      ext: input.ext,
      kind: input.kind,
      mimeType: input.mimeType,
      resourceKey: resource.resourceKey,
      resourceType: input.resourceType,
      source: 'probe',
      streamType: input.streamType,
      url: resource.url,
    }, fromRelay)
  }

  function emitKeyCandidateFromBuffer(buffer: ArrayBuffer, ext = 'key') {
    const normalizedKeyBuffer = normalizePotentialKeyBuffer(buffer)
    if (!normalizedKeyBuffer) {
      return false
    }
    const base64 = arrayBufferToBase64(normalizedKeyBuffer)
    emitGeneratedResource({
      base64,
      ext,
      kind: 'key',
      mimeType: 'application/octet-stream',
      resourceType: 'key',
      signature: `key:${base64}`,
    })
    return true
  }

  function emitKeyCandidateFromBase64(base64: string) {
    if (!isLikelyBase64Key(base64)) {
      return false
    }
    try {
      const keyBuffer = base64ToArrayBuffer(base64)
      if (keyBuffer.byteLength !== 16) {
        return false
      }
      emitGeneratedResource({
        base64,
        ext: 'base64key',
        kind: 'key',
        mimeType: 'application/octet-stream',
        resourceType: 'key',
        signature: `key:${base64}`,
      })
      return true
    } catch {
      return false
    }
  }

  function emitKeyCandidateFromHex(hex: string) {
    const normalizedValue = String(hex || '').trim().toLowerCase()
    if (!isLikelyHexKey(normalizedValue)) {
      return false
    }
    const bytes = new Uint8Array(16)
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(normalizedValue.slice(index * 2, index * 2 + 2), 16)
    }
    emitGeneratedResource({
      base64: arrayBufferToBase64(bytes.buffer),
      ext: 'key',
      kind: 'key',
      mimeType: 'application/octet-stream',
      resourceType: 'key',
      signature: `key:${normalizedValue}`,
    })
    return true
  }

  function emitInlineManifest(text: string, ext: 'm3u8' | 'mpd', baseUrl?: string) {
    const normalizedText = ext === 'm3u8' ? addBaseUrl(getBaseUrl(baseUrl || currentLocationHref), text) : text
    emitGeneratedResource({
      base64: textToBase64(normalizedText),
      ext,
      kind: 'manifest',
      mimeType: ext === 'm3u8' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml',
      resourceType: 'inline-manifest',
      signature: `${ext}:${normalizedText}`,
    })
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

  function emit(payload: ProbeEmitPayload, fromRelay = false) {
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
    if (isWorkerScope && !fromRelay) {
      relayEnvelope({ payload, type: 'capture' })
      return
    }
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify({
        capturedAt: Date.now(),
        contentLength: payload.contentLength,
        ext: payload.ext,
        kind: payload.kind || classifyKind(payload.url, payload.mimeType),
        mimeType: payload.mimeType,
        pageUrl: currentLocationHref,
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
    const baseName = sanitizeFileName(currentDocumentTitle || currentLocationHost || 'media')
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

  const nativeWorker = globalScope.Worker
  if (typeof nativeWorker === 'function') {
    globalScope.Worker = new Proxy(nativeWorker, {
      construct(target, argumentsList, newTarget) {
        const [scriptURL, options] = argumentsList as [string | URL, WorkerOptions | undefined]

        const createInjectedWorkerUrl = () => {
          const originalUrl = typeof scriptURL === 'string' ? scriptURL : String(scriptURL)
          const absoluteUrl = toAbsoluteUrl(originalUrl) || originalUrl
          if (!absoluteUrl) {
            return ''
          }

          const bootstrapSource = `;(${embeddedBrowserResourceProbe.toString()})(${JSON.stringify(consolePrefix)});\n`
          let workerSource = ''

          if (options?.type === 'module') {
            workerSource = `${bootstrapSource}import ${JSON.stringify(absoluteUrl)};\n`
          } else {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', absoluteUrl, false)
            xhr.send()
            if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) {
              return ''
            }
            workerSource = `${bootstrapSource}${xhr.responseText}`
          }

          return URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        }

        let injectedUrl = ''
        try {
          injectedUrl = createInjectedWorkerUrl()
        } catch {
          injectedUrl = ''
        }

        const worker = injectedUrl
          ? Reflect.construct(target, [injectedUrl, options], newTarget) as Worker
          : Reflect.construct(target, argumentsList, newTarget) as Worker

        worker.addEventListener('message', (event) => {
          if (consumeWorkerRelayMessage(event.data)) {
            event.stopImmediatePropagation()
          }
        }, { capture: true })

        if (injectedUrl) {
          setTimeout(() => {
            URL.revokeObjectURL(injectedUrl)
          }, 60_000)
        }

        return worker
      },
    }) as typeof Worker
    globalScope.Worker.toString = function () {
      return nativeWorker.toString()
    }
  }

  const mediaSourceConstructor = globalScope.MediaSource
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
    meta?: { baseUrl?: string; mimeType?: string; resourceType?: string; streamType?: 'audio' | 'video' },
  ) {
    if (typeof input !== 'string') {
      return
    }
    const value = input.trim()
    if (!value) {
      return
    }
    if (emitKeyCandidateFromBase64(value)) {
      return
    }
    const sanitizedHexValue = value.split('\u0010').join('').trim()
    if (emitKeyCandidateFromHex(sanitizedHexValue)) {
      return
    }
    if (dataUrlPattern.test(value)) {
      const decodedDataUrlText = decodeDataUrlText(value)
      decodedDataUrlText && reportCandidate(decodedDataUrlText, meta)
      return
    }
    const parsedJson = parseMaybeJson(value)
    if (parsedJson) {
      walkValue(parsedJson)
      return
    }
    const uppercaseValue = value.toUpperCase()
    if (uppercaseValue.startsWith('#EXTM3U') || uppercaseValue.includes('#EXTINF:')) {
      emitInlineManifest(value, 'm3u8', meta?.baseUrl)
      return
    }
    if (value.toLowerCase().includes('urn:mpeg:dash:schema:mpd') || (value.includes('<MPD') && value.includes('</MPD>'))) {
      emitInlineManifest(value, 'mpd', meta?.baseUrl)
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
    if (value instanceof ArrayBuffer) {
      emitKeyCandidateFromBuffer(value)
      return
    }
    if (ArrayBuffer.isView(value)) {
      emitKeyCandidateFromBuffer(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      return
    }
    if (typeof value === 'string') {
      reportCandidate(value, {
        baseUrl: currentLocationHref,
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
      if (
        value.length === 16
        && value.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 255)
      ) {
        emitKeyCandidateFromBuffer(Uint8Array.from(value).buffer)
        return
      }
      value.slice(0, 80).forEach((item, index) => {
        walkValue(item, depth + 1, visited, path.concat(String(index)))
      })
      return
    }

    Object.keys(value as Record<string, unknown>).slice(0, 80).forEach((key) => {
      walkValue((value as Record<string, unknown>)[key], depth + 1, visited, path.concat(key))
    })
  }

  const originalFetch = typeof globalScope.fetch === 'function' ? globalScope.fetch.bind(globalScope) : null
  if (originalFetch) {
    globalScope.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
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
      const clonedResponse = response.clone()
      void clonedResponse.arrayBuffer()
        .then((buffer) => {
          if (!buffer.byteLength) {
            return
          }
          if (emitKeyCandidateFromBuffer(buffer)) {
            return
          }
          const decodedText = new TextDecoder().decode(buffer)
          if (!decodedText.trim()) {
            return
          }
          reportCandidate(decodedText, {
            baseUrl: response.url || requestUrl,
            mimeType: response.headers.get('content-type') || undefined,
            resourceType: 'fetch-body',
          })
        })
        .catch(() => undefined)
      return response
    }
    globalScope.fetch.toString = function () {
      return originalFetch.toString()
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
      if (this.status < 200 || this.status >= 400) {
        return
      }
      const rawUrl = (this as XMLHttpRequest & Record<string, unknown>)[xhrUrlKey]
      const responseUrl = this.responseURL || (typeof rawUrl === 'string' ? rawUrl : '')
      reportCandidate(responseUrl, {
        mimeType: this.getResponseHeader('content-type') || undefined,
        resourceType: 'xhr',
      })
      if (this.response instanceof ArrayBuffer) {
        if (emitKeyCandidateFromBuffer(this.response)) {
          return
        }
        const decodedText = new TextDecoder().decode(this.response)
        decodedText && reportCandidate(decodedText, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
        return
      }
      if (typeof this.response === 'string') {
        reportCandidate(this.response, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
        return
      }
      if (this.response && typeof this.response === 'object') {
        walkValue(this.response)
        return
      }
      if (typeof this.responseText === 'string' && this.responseText.trim()) {
        reportCandidate(this.responseText, {
          baseUrl: responseUrl,
          mimeType: this.getResponseHeader('content-type') || undefined,
          resourceType: 'xhr-body',
        })
      }
    }, { once: true })
    return originalSend.apply(this, arguments as any)
  }
  XMLHttpRequest.prototype.open.toString = function () {
    return originalOpen.toString()
  }
  XMLHttpRequest.prototype.send.toString = function () {
    return originalSend.toString()
  }

  JSON.parse = function () {
    const value = originalJSONParse.apply(this, arguments as any)
    walkValue(value)
    return value
  }
  JSON.parse.toString = function () {
    return originalJSONParse.toString()
  }

  const originalBtoa = btoa
  ;((globalScope as unknown) as { btoa: typeof btoa }).btoa = function (this: unknown, data: string) {
    const base64 = originalBtoa.apply(this, arguments as any)
    emitKeyCandidateFromBase64(base64)
    reportCandidate(data, { baseUrl: currentLocationHref, resourceType: 'btoa' })
    return base64
  }
  btoa.toString = function () {
    return originalBtoa.toString()
  }

  const originalAtob = atob
  ;((globalScope as unknown) as { atob: typeof atob }).atob = function (this: unknown, base64: string) {
    const decoded = originalAtob.apply(this, arguments as any)
    emitKeyCandidateFromBase64(base64)
    reportCandidate(decoded, { baseUrl: currentLocationHref, resourceType: 'atob' })
    return decoded
  }
  atob.toString = function () {
    return originalAtob.toString()
  }

  const originalFromCharCode = String.fromCharCode
  String.fromCharCode = new Proxy(originalFromCharCode, {
    apply(target, thisArg, argumentsList) {
      const value = Reflect.apply(target, thisArg, argumentsList) as string
      if (value.length >= 7) {
        if (value.startsWith('#EXTM3U') || value.includes('#EXTINF:')) {
          m3u8Accumulator += value
          if (m3u8Accumulator.includes('#EXT-X-ENDLIST')) {
            const completedManifest = m3u8Accumulator.split('#EXT-X-ENDLIST')[0] + '#EXT-X-ENDLIST'
            emitInlineManifest(completedManifest, 'm3u8', currentLocationHref)
            m3u8Accumulator = ''
          }
        }
        const normalizedValue = value.split('\u0010').join('').trim()
        emitKeyCandidateFromHex(normalizedValue)
      }
      return value
    },
  })
  String.fromCharCode.toString = function () {
    return originalFromCharCode.toString()
  }

  const originalArraySlice = Array.prototype.slice
  Array.prototype.slice = function (this: unknown[]) {
    const sliced = originalArraySlice.apply(this, arguments as any)
    if (
      Array.isArray(sliced)
      && sliced.length === 16
      && sliced.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 255)
    ) {
      emitKeyCandidateFromBuffer(Uint8Array.from(sliced).buffer)
    }
    return sliced
  }
  Array.prototype.slice.toString = function () {
    return originalArraySlice.toString()
  }

  const originalArrayJoin = Array.prototype.join
  Array.prototype.join = function () {
    const joined = originalArrayJoin.apply(this, arguments as any)
    if (typeof joined === 'string') {
      if (joined.startsWith('#EXTM3U') || joined.includes('#EXTINF:')) {
        reportCandidate(joined, { baseUrl: currentLocationHref, resourceType: 'array-join' })
      }
      emitKeyCandidateFromBase64(joined)
    }
    return joined
  }
  Array.prototype.join.toString = function () {
    return originalArrayJoin.toString()
  }

  const originalDataView = globalScope.DataView as typeof DataView | undefined
  if (typeof originalDataView === 'function') {
    const wrappedDataView = function (buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number) {
      const instance = new originalDataView(buffer, byteOffset, byteLength)
      const emitViewBuffer = () => {
        const slicedBuffer = instance.buffer.slice(instance.byteOffset, instance.byteOffset + instance.byteLength)
        emitKeyCandidateFromBuffer(slicedBuffer)
      }

      ;(['setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32'] as const).forEach((methodName) => {
        const originalMethod = instance[methodName]
        if (typeof originalMethod !== 'function') {
          return
        }
        instance[methodName] = function (this: DataView) {
          const result = originalMethod.apply(this, arguments as any)
          emitViewBuffer()
          return result
        } as typeof originalMethod
      })

      emitViewBuffer()
      return instance
    } as unknown as typeof DataView

    ;(wrappedDataView as unknown as { prototype: DataView }).prototype = originalDataView.prototype
    wrappedDataView.toString = function () {
      return originalDataView.toString()
    }
    globalScope.DataView = wrappedDataView
  }

  function createSubarrayWrapper(
    originalSubarray: (begin?: number, end?: number) => ArrayBufferView,
  ) {
    return function (this: ArrayBufferView) {
      const subarray = originalSubarray.apply(this, arguments as any)
      if (subarray?.byteLength === 16) {
        emitKeyCandidateFromBuffer(subarray.buffer.slice(subarray.byteOffset, subarray.byteOffset + subarray.byteLength))
      }
      return subarray
    }
  }

  const originalInt8ArraySubarray = Int8Array.prototype.subarray
  Int8Array.prototype.subarray = createSubarrayWrapper(originalInt8ArraySubarray) as typeof Int8Array.prototype.subarray
  Int8Array.prototype.subarray.toString = function () {
    return originalInt8ArraySubarray.toString()
  }

  const originalUint8ArraySubarray = Uint8Array.prototype.subarray
  Uint8Array.prototype.subarray = createSubarrayWrapper(originalUint8ArraySubarray) as typeof Uint8Array.prototype.subarray
  Uint8Array.prototype.subarray.toString = function () {
    return originalUint8ArraySubarray.toString()
  }

  const originalStringIndexOf = String.prototype.indexOf
  String.prototype.indexOf = function (searchValue: string, fromIndex?: number) {
    const matchIndex = originalStringIndexOf.apply(this, arguments as any)
    if (searchValue === '#EXTM3U' && matchIndex !== -1) {
      const sourceText = String(this)
      reportCandidate(sourceText.slice(Math.max(fromIndex ?? 0, 0)), {
        baseUrl: currentLocationHref,
        resourceType: 'string-indexof',
      })
    }
    return matchIndex
  }
  String.prototype.indexOf.toString = function () {
    return originalStringIndexOf.toString()
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__ = {
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
    seen,
  }

  return 'installed'
}

/**
 * Shared page-host runtime for the embedded browser capture probe.
 *
 * Cat Catch algorithms live in their capability ports. This body only owns
 * the document transport, resource projection, and byte helpers consumed by
 * capability page adapters.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// This body fragment is compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserPageProbeRuntimeCoreBody() {
  const globalScope = globalThis as typeof globalThis & {
    __OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__?: unknown[]
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?: {
      installedAt: number
    }
  }
  if (globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__) {
    return 'already-installed'
  }

  const isWorkerScope = typeof document === 'undefined'
  const currentLocationHref = typeof globalScope.location?.href === 'string'
    ? globalScope.location.href
    : ''
  const currentLocationHost = typeof globalScope.location?.hostname === 'string'
    ? globalScope.location.hostname
    : 'resource'
  const workerRelayKey = '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__'
  const originalConsoleInfo = typeof console.info === 'function'
    ? console.info.bind(console)
    : console.log.bind(console)
  const seen = new Set<string>()
  const manifestExtensions = new Set(['m3u8', 'm3u', 'mpd'])
  const mediaExtensions = new Set([
    'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga',
    'ogv', 'webm', 'mkv', 'mov', 'avi', 'ts', 'flv', 'hlv', 'f4v', 'wma',
    'mpeg', 'wmv', 'asf', 'movie', 'divx', 'mpeg4', 'vid', 'weba', 'opus',
    'acc', '3gp',
  ])
  const imageExtensions = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
  ])
  const subtitleExtensions = new Set([
    'vtt', 'srt', 'ass', 'ssa', 'ttml', 'lrc', 'qrc', 'krc', 'yrc', 'trc',
    'ksc', 'sbv', 'dfxp', 'smi', 'sami', 'scc', 'stl', 'sub', 'idx', 'sup',
    'lyric', 'lyrics', 'webvtt',
  ])
  const keyExtensions = new Set(['key', 'base64key'])
  const manifestPattern = /\.(m3u8|m3u|mpd)(\?|#|$)/i
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp)(\?|#|$)/i
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml|lrc|qrc|krc|yrc|trc|ksc|sbv|dfxp|smi|sami|scc|stl|sub|idx|sup|lyric|lyrics|webvtt)(\?|#|$)/i
  const pdfPattern = /\.pdf(\?|#|$)/i
  const keyPattern = /\.(key|base64key)(\?|#|$)/i
  const catchToolkitProjection = {
    autoDownloadOnComplete: false,
    autoSeekToBufferedEnd: false,
    clearCacheOnComplete: false,
    manualFileName: '',
    regexRule: '',
    regexWarning: '',
    restartAlwaysFromBeginning: false,
    selectorRule: '',
    selectorWarning: '',
    trimExtraMediaHeaders: true,
  }

  function getCurrentDocumentTitle() {
    if (typeof document === 'undefined' || typeof document.title !== 'string') {
      return ''
    }
    return document.title.trim()
  }

  function sanitizeFileName(input: string) {
    const safeName = String(input || '').replace(/[\\/:*?"<>|]+/g, '_').trim()
    return safeName || 'media'
  }

  function resolveMseCaptureFileName() {
    const manualFileName = sanitizeFileName(catchToolkitProjection.manualFileName)
    if (manualFileName && manualFileName !== 'media') {
      return manualFileName
    }

    let candidateName = ''
    const selectorRule = String(catchToolkitProjection.selectorRule || '').trim()
    if (selectorRule && typeof document !== 'undefined') {
      try {
        candidateName = document.querySelector(selectorRule)?.textContent?.trim() || ''
      } catch {
        // Invalid selectors are already surfaced by the target toolkit owner.
      }
    }

    const regexRule = String(catchToolkitProjection.regexRule || '').trim()
    if (regexRule && typeof document !== 'undefined') {
      try {
        const sourceText = candidateName || document.documentElement?.outerHTML || ''
        if (sourceText) {
          const matches = Array.from(sourceText.matchAll(new RegExp(regexRule, 'g')))
          const extractedValues = matches.flatMap((match) => {
            if (match.length > 1) {
              return match.slice(1).filter(item => typeof item === 'string' && item.trim())
            }
            return match[0] ? [match[0]] : []
          })
          if (extractedValues.length > 0) candidateName = extractedValues.join('_')
        }
      } catch {
        // Invalid expressions are already surfaced by the target toolkit owner.
      }
    }

    return sanitizeFileName(
      candidateName || getCurrentDocumentTitle() || currentLocationHost || 'media',
    )
  }

  function getExtension(url: string) {
    try {
      const pathname = new URL(url, currentLocationHref).pathname || ''
      return pathname.toLowerCase().match(/\.([a-z0-9]+)$/i)?.[1] || ''
    } catch {
      return url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)?.[1] || ''
    }
  }

  function classifyKind(
    url: string,
    mimeType?: string,
  ): 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other' {
    const extension = getExtension(url)
    const normalizedMimeType = String(mimeType || '').split(';')[0]?.trim().toLowerCase()
    if (
      manifestExtensions.has(extension)
      || normalizedMimeType.includes('mpegurl')
      || normalizedMimeType.includes('dash+xml')
      || manifestPattern.test(url)
    ) return 'manifest'
    if (
      mediaExtensions.has(extension)
      || normalizedMimeType.startsWith('video/')
      || normalizedMimeType.startsWith('audio/')
      || normalizedMimeType === 'application/ogg'
      || normalizedMimeType === 'application/m4s'
      || mediaPattern.test(url)
      || url.startsWith('blob:')
    ) return 'media'
    if (keyExtensions.has(extension) || keyPattern.test(url)) return 'key'
    if (
      imageExtensions.has(extension)
      || normalizedMimeType.startsWith('image/')
      || imagePattern.test(url)
    ) return 'image'
    if (
      subtitleExtensions.has(extension)
      || normalizedMimeType.includes('text/vtt')
      || normalizedMimeType.includes('subrip')
      || normalizedMimeType.includes('subtitle')
      || normalizedMimeType.includes('ttml+xml')
      || normalizedMimeType === 'text/srt'
      || normalizedMimeType === 'text/x-srt'
      || normalizedMimeType === 'text/x-ass'
      || normalizedMimeType === 'text/x-ssa'
      || subtitlePattern.test(url)
    ) return 'subtitle'
    if (
      extension === 'pdf'
      || normalizedMimeType === 'application/pdf'
      || pdfPattern.test(url)
    ) return 'document'
    return 'other'
  }

  function guessExtensionFromMimeType(
    mimeType: string,
    streamType?: 'audio' | 'video',
  ) {
    const normalizedMimeType = String(mimeType || '').split(';')[0]?.trim().toLowerCase()
    if (normalizedMimeType === 'audio/mp4') return 'm4a'
    if (normalizedMimeType === 'video/mp4') return 'mp4'
    if (normalizedMimeType === 'audio/mpeg') return 'mp3'
    if (normalizedMimeType === 'audio/aac') return 'aac'
    if (normalizedMimeType.endsWith('/webm')) return 'webm'
    if (normalizedMimeType.endsWith('/ogg')) return 'ogg'
    if (normalizedMimeType === 'application/m4s') return 'm4s'
    if (normalizedMimeType.endsWith('/wav')) return 'wav'
    if (streamType === 'audio') return 'm4a'
    return 'mp4'
  }

  function getChunkBytes(input: ArrayBuffer | ArrayBufferView) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input)
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
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

  function combineArrayBuffers(buffers: ArrayBuffer[]) {
    const totalBytes = buffers.reduce((sum, buffer) => sum + (buffer?.byteLength || 0), 0)
    const combined = new Uint8Array(totalBytes)
    let offset = 0
    for (const buffer of buffers) {
      const bytes = getChunkBytes(buffer)
      combined.set(bytes, offset)
      offset += bytes.byteLength
    }
    return combined.buffer
  }

  function emitProbeConsolePayload(payload: Record<string, unknown>) {
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify(payload))
    } catch {
      // Probe transport failures must not alter page behavior.
    }
  }

  function emit(payload: ProbeEmitPayload) {
    if (!payload.url) return
    if (payload.resourceType !== 'mse-stream') {
      const dedupeKey = `${payload.resourceKey || payload.source}:${payload.resourceType || 'unknown'}:${payload.url}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      if (seen.size > 2000) {
        seen.clear()
        seen.add(dedupeKey)
      }
    }
    emitProbeConsolePayload({
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
    })
  }

  globalScope.__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__ = [
    arrayBufferToBase64,
    catchToolkitProjection,
    classifyKind,
    combineArrayBuffers,
    currentLocationHref,
    emit,
    emitProbeConsolePayload,
    getChunkBytes,
    globalScope,
    guessExtensionFromMimeType,
    isWorkerScope,
    resolveMseCaptureFileName,
    seen,
    workerRelayKey,
  ]
}

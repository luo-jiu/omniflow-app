/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under AGPL-3.0
 */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserResourceProbeRuntimeCoreBody() {
  const globalScope = globalThis as typeof globalThis & {
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?: {
      exportResource?: (resourceKey: string) => boolean
      getCatchToolkitState?: () => ProbeCatchToolkitState
      installedAt: number
      clearCatchMediaCache?: () => boolean
      downloadCatchMedia?: () => boolean
      openResource?: (resourceKey: string) => boolean
      readResource?: (resourceKey: string) => Promise<null | {
        base64: string
        fileName: string
        mimeType?: string
        resourceKey: string
        streamType?: ProbeStreamType
      }>
      restartCatchMediaCapture?: () => boolean
      seen: Set<string>
      updateCatchToolkitState?: (payload: Partial<ProbeCatchToolkitState>) => ProbeCatchToolkitState
    }
  }
  const isWorkerScope = typeof document === 'undefined'
    && typeof (globalScope as typeof globalScope & { importScripts?: unknown }).importScripts === 'function'
  const currentLocationHref = typeof globalScope.location?.href === 'string' ? globalScope.location.href : ''
  const currentLocationHost = typeof globalScope.location?.hostname === 'string' ? globalScope.location.hostname : 'resource'
  const currentLocationProtocol = typeof globalScope.location?.protocol === 'string' ? globalScope.location.protocol : 'https:'
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
  const vimeoPlaylistUrls = new Set<string>()
  const mediaSourceStreams = new WeakMap<MediaSource, string[]>()
  let mseSequence = 0
  let probeResourceSequence = 0

  const manifestExtensions = new Set(['m3u8', 'm3u', 'mpd'])
  const mediaExtensions = new Set([
    'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'ogv',
    'webm', 'mkv', 'mov', 'avi', 'ts', 'flv', 'wma', 'mpeg', 'wmv', 'asf', 'movie',
    'divx', 'mpeg4', 'vid', 'weba', 'opus', 'acc',
  ])
  const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
  const subtitleExtensions = new Set(['vtt', 'srt', 'ass', 'ssa', 'ttml'])
  const dataUrlPattern = /^data:(application|video|audio)\//i
  const likelyUrlPattern = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i
  const manifestPattern = /\.(m3u8|m3u|mpd)(\?|#|$)/i
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc)(\?|#|$)/i
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml)(\?|#|$)/i
  const pdfPattern = /\.pdf(\?|#|$)/i
  const vimeoPlaylistPattern = /^https:\/\/[^.]*\.vimeocdn\.com\/exp=.*\/playlist\.json\?/i
  const originalJSONParse = JSON.parse.bind(JSON)
  const originalConsoleInfo = typeof console.info === 'function'
    ? console.info.bind(console)
    : console.log.bind(console)
  const catchToolkitStorageKeys = {
    autoDownloadOnComplete: 'OmniflowCatchToolkit:autoDownloadOnComplete',
    autoSeekToBufferedEnd: 'OmniflowCatchToolkit:autoSeekToBufferedEnd',
    clearCacheOnComplete: 'OmniflowCatchToolkit:clearCacheOnComplete',
    manualFileName: 'OmniflowCatchToolkit:manualFileName',
    regexRule: 'OmniflowCatchToolkit:regexRule',
    restartAlwaysFromBeginning: 'OmniflowCatchToolkit:restartAlwaysFromBeginning',
    selectorRule: 'OmniflowCatchToolkit:selectorRule',
    trimExtraMediaHeaders: 'OmniflowCatchToolkit:trimExtraMediaHeaders',
  } as const
  let m3u8Accumulator = ''
  let isEmittingKeyCandidate = false
  let isCaptureComplete = false
  const catchToolkitState = {
    autoSeekToBufferedEnd: false,
    autoDownloadOnComplete: false,
    clearCacheOnComplete: false,
    manualFileName: '',
    regexRule: '',
    restartAlwaysFromBeginning: false,
    selectorRule: '',
    trimExtraMediaHeaders: true,
  }
  const trackedMediaElements = new WeakSet<HTMLMediaElement>()
  const autoRestartHandledMediaElements = new WeakSet<HTMLMediaElement>()
  let trackedMediaObserver: MutationObserver | null = null

  function readCatchToolkitStorageString(key: string) {
    try {
      if (typeof localStorage === 'undefined') {
        return ''
      }
      return String(localStorage.getItem(key) || '').trim()
    } catch {
      return ''
    }
  }

  function readCatchToolkitStorageChecked(key: string, fallback = false) {
    try {
      if (typeof localStorage === 'undefined') {
        return fallback
      }
      return localStorage.getItem(key) === 'checked'
    } catch {
      return fallback
    }
  }

  function writeCatchToolkitStorageString(key: string, value: string) {
    try {
      if (typeof localStorage === 'undefined') {
        return
      }
      const normalizedValue = String(value || '').trim()
      if (!normalizedValue) {
        localStorage.removeItem(key)
        return
      }
      localStorage.setItem(key, normalizedValue)
    } catch {
      // ignore storage write failures
    }
  }

  function writeCatchToolkitStorageChecked(key: string, checked: boolean) {
    try {
      if (typeof localStorage === 'undefined') {
        return
      }
      localStorage.setItem(key, checked ? 'checked' : '')
    } catch {
      // ignore storage write failures
    }
  }

  function evaluateSelectorRule(rule: string) {
    const normalizedRule = String(rule || '').trim()
    if (!normalizedRule) {
      return {
        rule: '',
        warning: '',
      }
    }
    if (typeof document === 'undefined') {
      return {
        rule: normalizedRule,
        warning: '',
      }
    }
    try {
      const matchedNode = document.querySelector(normalizedRule)
      const matchedText = matchedNode?.textContent?.trim() || ''
      return {
        rule: normalizedRule,
        warning: matchedText ? '' : '表达式暂时没有命中可用内容',
      }
    } catch {
      return {
        rule: '',
        warning: '选择器语法错误',
      }
    }
  }

  function evaluateRegexRule(rule: string) {
    const normalizedRule = String(rule || '').trim()
    if (!normalizedRule) {
      return {
        rule: '',
        warning: '',
      }
    }
    try {
      new RegExp(normalizedRule, 'g')
      return {
        rule: normalizedRule,
        warning: '',
      }
    } catch {
      return {
        rule: '',
        warning: '正则表达式错误',
      }
    }
  }

  function hydrateCatchToolkitStateFromStorage() {
    if (isWorkerScope) {
      return
    }
    catchToolkitState.autoDownloadOnComplete = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoDownloadOnComplete,
      catchToolkitState.autoDownloadOnComplete,
    )
    catchToolkitState.autoSeekToBufferedEnd = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoSeekToBufferedEnd,
      catchToolkitState.autoSeekToBufferedEnd,
    )
    catchToolkitState.clearCacheOnComplete = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.clearCacheOnComplete,
      catchToolkitState.clearCacheOnComplete,
    )
    catchToolkitState.manualFileName = readCatchToolkitStorageString(catchToolkitStorageKeys.manualFileName)
    catchToolkitState.restartAlwaysFromBeginning = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.restartAlwaysFromBeginning,
      catchToolkitState.restartAlwaysFromBeginning,
    )
    catchToolkitState.trimExtraMediaHeaders = readCatchToolkitStorageChecked(
      catchToolkitStorageKeys.trimExtraMediaHeaders,
      catchToolkitState.trimExtraMediaHeaders,
    )
    catchToolkitState.selectorRule = evaluateSelectorRule(
      readCatchToolkitStorageString(catchToolkitStorageKeys.selectorRule),
    ).rule
    catchToolkitState.regexRule = evaluateRegexRule(
      readCatchToolkitStorageString(catchToolkitStorageKeys.regexRule),
    ).rule
  }

  function persistCatchToolkitState() {
    if (isWorkerScope) {
      return
    }
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoDownloadOnComplete,
      catchToolkitState.autoDownloadOnComplete,
    )
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.autoSeekToBufferedEnd,
      catchToolkitState.autoSeekToBufferedEnd,
    )
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.clearCacheOnComplete,
      catchToolkitState.clearCacheOnComplete,
    )
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.manualFileName,
      catchToolkitState.manualFileName,
    )
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.regexRule,
      catchToolkitState.regexRule,
    )
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.restartAlwaysFromBeginning,
      catchToolkitState.restartAlwaysFromBeginning,
    )
    writeCatchToolkitStorageString(
      catchToolkitStorageKeys.selectorRule,
      catchToolkitState.selectorRule,
    )
    writeCatchToolkitStorageChecked(
      catchToolkitStorageKeys.trimExtraMediaHeaders,
      catchToolkitState.trimExtraMediaHeaders,
    )
  }

  hydrateCatchToolkitStateFromStorage()

  function getCurrentDocumentTitle() {
    if (typeof document === 'undefined' || typeof document.title !== 'string') {
      return ''
    }
    return document.title.trim()
  }

  function resolveCatchToolkitFileName() {
    const manualFileName = sanitizeFileName(catchToolkitState.manualFileName)
    if (manualFileName && manualFileName !== 'media') {
      return manualFileName
    }

    let candidateName = ''
    const selectorRule = String(catchToolkitState.selectorRule || '').trim()
    if (selectorRule && typeof document !== 'undefined') {
      try {
        const matchedNode = document.querySelector(selectorRule)
        const matchedText = matchedNode?.textContent?.trim() || ''
        if (matchedText) {
          candidateName = matchedText
        }
      } catch {
        // ignore invalid selector syntax and fall back to other rules
      }
    }

    const regexRule = String(catchToolkitState.regexRule || '').trim()
    if (regexRule && typeof document !== 'undefined') {
      try {
        const sourceText = candidateName || document.documentElement?.outerHTML || ''
        if (sourceText) {
          const expression = new RegExp(regexRule, 'g')
          const matches = Array.from(sourceText.matchAll(expression))
          const extractedValues = matches.flatMap((match) => {
            if (match.length > 1) {
              return match.slice(1).filter((item) => typeof item === 'string' && item.trim())
            }
            return match[0] ? [match[0]] : []
          })
          if (extractedValues.length > 0) {
            candidateName = extractedValues.join('_')
          }
        }
      } catch {
        // ignore invalid regular expressions and fall back to the title
      }
    }

    return sanitizeFileName(candidateName || getCurrentDocumentTitle() || currentLocationHost || 'media')
  }

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
      if (
        likelyUrlPattern.test(value)
        || manifestPattern.test(value)
        || mediaPattern.test(value)
        || imagePattern.test(value)
        || subtitlePattern.test(value)
        || pdfPattern.test(value)
      ) {
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

  function buildCatchToolkitState(): ProbeCatchToolkitState {
    const selectorEvaluation = evaluateSelectorRule(catchToolkitState.selectorRule)
    const regexEvaluation = evaluateRegexRule(catchToolkitState.regexRule)
    const capturedMediaSizeBytes = Array.from(mseStreams.values()).reduce((totalBytes, stream) => {
      return totalBytes + Math.max(0, Number(stream.totalBytes || 0))
    }, 0)
    return {
      autoSeekToBufferedEnd: catchToolkitState.autoSeekToBufferedEnd,
      autoDownloadOnComplete: catchToolkitState.autoDownloadOnComplete,
      capturedMediaSizeBytes,
      clearCacheOnComplete: catchToolkitState.clearCacheOnComplete,
      currentFileName: resolveCatchToolkitFileName(),
      isCaptureComplete,
      manualFileName: catchToolkitState.manualFileName,
      regexWarning: regexEvaluation.warning,
      regexRule: regexEvaluation.rule,
      restartAlwaysFromBeginning: catchToolkitState.restartAlwaysFromBeginning,
      selectorWarning: selectorEvaluation.warning,
      selectorRule: selectorEvaluation.rule,
      streamCount: mseStreams.size,
      trimExtraMediaHeaders: catchToolkitState.trimExtraMediaHeaders,
    }
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
      && !normalizedValue.startsWith('AAAAAAAAAAAAAAAAAAAA')
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

  function uint32ArrayToUint8Array(input: Uint32Array) {
    const bytes = new Uint8Array(16)
    for (let index = 0; index < 4; index += 1) {
      const value = input[index] || 0
      bytes[index * 4] = (value >> 24) & 0xff
      bytes[index * 4 + 1] = (value >> 16) & 0xff
      bytes[index * 4 + 2] = (value >> 8) & 0xff
      bytes[index * 4 + 3] = value & 0xff
    }
    return bytes
  }

  function uint16ArrayToUint8Array(input: Uint16Array) {
    const bytes = new Uint8Array(16)
    for (let index = 0; index < 8; index += 1) {
      const value = input[index] || 0
      bytes[index * 2] = (value >> 8) & 0xff
      bytes[index * 2 + 1] = value & 0xff
    }
    return bytes
  }

  function createProbeResourceKey() {
    probeResourceSequence += 1
    return `probe-resource:${Date.now()}-${probeResourceSequence}`
  }

  function createProbeResourceFileName(kind: 'manifest' | 'key', ext: string) {
    const fileStem = kind === 'key'
      ? `${getCurrentDocumentTitle() || currentLocationHost || 'resource'}-key`
      : getCurrentDocumentTitle() || currentLocationHost || 'resource'
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
    if (isEmittingKeyCandidate) {
      return false
    }
    if (isMp4HeaderChunk(buffer)) {
      return false
    }
    isEmittingKeyCandidate = true
    try {
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
    } finally {
      isEmittingKeyCandidate = false
    }
  }

  function emitKeyCandidateFromBase64(base64: string) {
    if (isEmittingKeyCandidate) {
      return false
    }
    if (!isLikelyBase64Key(base64)) {
      return false
    }
    isEmittingKeyCandidate = true
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
    } finally {
      isEmittingKeyCandidate = false
    }
  }

  function emitKeyCandidateFromHex(hex: string) {
    if (isEmittingKeyCandidate) {
      return false
    }
    const normalizedValue = String(hex || '').trim().toLowerCase()
    if (!isLikelyHexKey(normalizedValue)) {
      return false
    }
    isEmittingKeyCandidate = true
    try {
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
    } finally {
      isEmittingKeyCandidate = false
    }
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

  function createVimeoManifestBlobUrl(text: string, signature: string) {
    const resource = createProbeBlobResource({
      base64: textToBase64(text),
      ext: 'm3u8',
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      signature,
    })
    return resource.url
  }

  function emitVimeoPlaylistManifest(originalUrl: string, payload: unknown) {
    const normalizedOriginalUrl = String(originalUrl || '').trim()
    if (!normalizedOriginalUrl || !vimeoPlaylistPattern.test(normalizedOriginalUrl) || vimeoPlaylistUrls.has(normalizedOriginalUrl)) {
      return false
    }
    const data = typeof payload === 'string' ? parseMaybeJson(payload) : payload
    if (!data || typeof data !== 'object') {
      return false
    }
    const playlist = data as Record<string, unknown>
    if (typeof playlist.base_url !== 'string' || !Array.isArray(playlist.video)) {
      return false
    }

    try {
      const parsedUrl = new URL(normalizedOriginalUrl)
      const pathBase = parsedUrl.pathname.slice(0, parsedUrl.pathname.lastIndexOf('/') + 1)
      const baseUrl = new URL(`${parsedUrl.origin}${pathBase}${playlist.base_url}`).href
      const masterLines = ['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-VERSION:3']

      const createStreamManifestUrl = (stream: Record<string, unknown>) => {
        const segments = Array.isArray(stream.segments) ? stream.segments : []
        if (segments.length === 0) {
          return ''
        }
        const streamBaseUrl = String(stream.base_url || '')
        const manifestLines = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-TARGETDURATION:${Number(stream.duration) || 0}`,
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-PLAYLIST-TYPE:VOD',
        ]
        if (typeof stream.init_segment === 'string' && stream.init_segment) {
          manifestLines.push(`#EXT-X-MAP:URI="data:application/octet-stream;base64,${stream.init_segment}"`)
        } else if (typeof stream.init_segment_url === 'string' && stream.init_segment_url) {
          manifestLines.push(`#EXT-X-MAP:URI="${baseUrl}${streamBaseUrl}${stream.init_segment_url}"`)
        }

        segments.forEach((segment) => {
          if (!segment || typeof segment !== 'object') {
            return
          }
          const currentSegment = segment as Record<string, unknown>
          const segmentUrl = String(currentSegment.url || '')
          if (!segmentUrl) {
            return
          }
          const start = Number(currentSegment.start) || 0
          const end = Number(currentSegment.end) || start
          manifestLines.push(`#EXTINF:${Math.max(end - start, 0)},`)
          manifestLines.push(`${baseUrl}${streamBaseUrl}${segmentUrl}`)
        })
        manifestLines.push('#EXT-X-ENDLIST')
        const manifestText = manifestLines.join('\n')
        return createVimeoManifestBlobUrl(manifestText, `vimeo-stream:${manifestText}`)
      }

      playlist.video.forEach((stream) => {
        if (!stream || typeof stream !== 'object') {
          return
        }
        const currentStream = stream as Record<string, unknown>
        const streamUrl = createStreamManifestUrl(currentStream)
        if (!streamUrl) {
          return
        }
        masterLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${Number(currentStream.bitrate) || 0},RESOLUTION=${Number(currentStream.width) || 0}x${Number(currentStream.height) || 0},CODECS="${String(currentStream.codecs || '')}"`,
        )
        masterLines.push(streamUrl)
      })

      const audioStreams = Array.isArray(playlist.audio) ? playlist.audio : []
      audioStreams.forEach((stream) => {
        if (!stream || typeof stream !== 'object') {
          return
        }
        const currentStream = stream as Record<string, unknown>
        const streamUrl = createStreamManifestUrl(currentStream)
        if (!streamUrl) {
          return
        }
        masterLines.push(
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${String(currentStream.id || '')}",NAME="${String(currentStream.bitrate || '')}",URI="${streamUrl}"`,
        )
      })

      if (masterLines.length <= 3) {
        return false
      }
      const masterText = masterLines.join('\n')
      vimeoPlaylistUrls.add(normalizedOriginalUrl)
      emitGeneratedResource({
        base64: textToBase64(masterText),
        ext: 'm3u8',
        kind: 'manifest',
        mimeType: 'application/vnd.apple.mpegurl',
        resourceType: 'inline-manifest',
        signature: `vimeo-master:${masterText}`,
      })
      return true
    } catch {
      return false
    }
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
    if (!catchToolkitState.trimExtraMediaHeaders) {
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

}

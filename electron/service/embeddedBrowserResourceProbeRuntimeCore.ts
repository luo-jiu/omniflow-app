/**
 * Core logic adapted from cat-catch (https://github.com/xifangczy/cat-catch)
 * Licensed under GPL-3.0-only
 */
/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, no-extra-semi */
// These body fragments are compiled to JavaScript, sliced, and injected into the page runtime.
// @ts-nocheck
export function embeddedBrowserResourceProbeRuntimeCoreBody() {
  const globalScope = globalThis as typeof globalThis & {
    __OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__?: {
      exportResource?: (resourceKey: string) => boolean
      getCatchToolkitState?: () => ProbeCatchToolkitState
      installedAt: number
      clearCatchMediaCache?: () => boolean
      drainResource?: (resourceKey: string) => null | {
        base64?: string
        fileName: string
        mimeType?: string
        resourceKey: string
        streamType?: ProbeStreamType
      }
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
  const probeResources = new Map<string, {
    base64: string
    blobUrl: string
    contentLength: number
    fileName: string
    mimeType?: string
    streamType?: 'audio' | 'video'
  }>()
  const probeResourceKeysBySignature = new Map<string, string>()
  let probeResourceSequence = 0

  const manifestExtensions = new Set(['m3u8', 'm3u', 'mpd'])
  const mediaExtensions = new Set([
    'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'ogv',
    'webm', 'mkv', 'mov', 'avi', 'ts', 'flv', 'hlv', 'f4v', 'wma', 'mpeg', 'wmv',
    'asf', 'movie', 'divx', 'mpeg4', 'vid', 'weba', 'opus', 'acc', '3gp',
  ])
  const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
  const subtitleExtensions = new Set([
    'vtt', 'srt', 'ass', 'ssa', 'ttml', 'lrc', 'qrc', 'krc', 'yrc', 'trc', 'ksc',
    'sbv', 'dfxp', 'smi', 'sami', 'scc', 'stl', 'sub', 'idx', 'sup', 'lyric',
    'lyrics', 'webvtt',
  ])
  const keyExtensions = new Set(['key', 'base64key'])
  const dataUrlPattern = /^data:(application|video|audio)\//i
  const likelyUrlPattern = /^(https?:\/\/|blob:|\/\/|\/|\.\/|\.\.\/)/i
  const manifestPattern = /\.(m3u8|m3u|mpd)(\?|#|$)/i
  const mediaPattern = /\.(mp4|m4v|m4a|m4s|mp3|aac|flac|wav|ogg|oga|ogv|webm|mkv|mov|avi|ts|flv|hlv|f4v|wma|mpeg|wmv|asf|movie|divx|mpeg4|vid|weba|opus|acc|3gp)(\?|#|$)/i
  const imagePattern = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico)(\?|#|$)/i
  const subtitlePattern = /\.(vtt|srt|ass|ssa|ttml|lrc|qrc|krc|yrc|trc|ksc|sbv|dfxp|smi|sami|scc|stl|sub|idx|sup|lyric|lyrics|webvtt)(\?|#|$)/i
  const pdfPattern = /\.pdf(\?|#|$)/i
  const keyPattern = /\.(key|base64key)(\?|#|$)/i
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
  let isEmittingKeyCandidate = false
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
        || keyPattern.test(value)
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
      || normalizedMimeType === 'application/ogg'
      || normalizedMimeType === 'application/m4s'
      || mediaPattern.test(url)
      || url.startsWith('blob:')
    ) {
      return 'media'
    }
    if (keyExtensions.has(extension) || keyPattern.test(url)) {
      return 'key'
    }
    if (imageExtensions.has(extension) || normalizedMimeType.startsWith('image/') || imagePattern.test(url)) {
      return 'image'
    }
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
    ) {
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
    if (normalizedMimeType === 'application/m4s') {
      return 'm4s'
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
      return input
    }
    if (ArrayBuffer.isView(input)) {
      return input
    }
    return null
  }

  function getChunkBytes(input: ArrayBuffer | ArrayBufferView) {
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input)
    }
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

  function emitProbeConsolePayload(payload: Record<string, unknown>) {
    try {
      originalConsoleInfo(consolePrefix + JSON.stringify(payload))
    } catch {
      // ignore probe transport failures
    }
  }

  function combineArrayBuffers(buffers: ArrayBuffer[]) {
    const totalBytes = buffers.reduce((sum, buffer) => sum + (buffer?.byteLength || 0), 0)
    const combined = new Uint8Array(totalBytes)
    let offset = 0
    buffers.forEach((buffer) => {
      const bytes = getChunkBytes(buffer)
      combined.set(bytes, offset)
      offset += bytes.byteLength
    })
    return combined.buffer
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

  function parseMaybeJson(value: string) {
    const normalizedValue = String(value || '').trim()
    if (!normalizedValue || (normalizedValue[0] !== '{' && normalizedValue[0] !== '[')) {
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

  function isMp4HeaderChunk(chunk: ArrayBuffer) {
    const data = getChunkBytes(chunk)
    return (
      data.length > 8
      && data[4] === 0x66
      && data[5] === 0x74
      && data[6] === 0x79
      && data[7] === 0x70
    )
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

  ;(globalScope as typeof globalScope & {
    __OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__?: unknown[]
  }).__OMNIFLOW_EMBEDDED_BROWSER_PROBE_CORE_KEEP_ALIVE__ = [
    arrayBufferToBase64,
    base64ToArrayBuffer,
    catchToolkitState,
    catchToolkitStorageKeys,
    classifyKind,
    cloneChunk,
    currentLocationHost,
    currentLocationHref,
    currentLocationProtocol,
    dataUrlPattern,
    decodeDataUrlText,
    emit,
    emitGeneratedResource,
    emitKeyCandidateFromBase64,
    emitKeyCandidateFromBuffer,
    emitKeyCandidateFromHex,
    getChunkBytes,
    getCurrentDocumentTitle,
    getExtension,
    globalScope,
    guessExtensionFromMimeType,
    hydrateCatchToolkitStateFromStorage,
    imageExtensions,
    imagePattern,
    inferStreamTypeFromPath,
    isEmittingKeyCandidate,
    isLikelyBase64Key,
    isLikelyHexKey,
    isMp4HeaderChunk,
    isRepeatedExpansion,
    isWorkerScope,
    keyExtensions,
    keyPattern,
    likelyUrlPattern,
    manifestExtensions,
    manifestPattern,
    mediaExtensions,
    mediaPattern,
    normalizePotentialKeyBuffer,
    openWindow,
    originalConsoleInfo,
    originalJSONParse,
    pdfPattern,
    persistCatchToolkitState,
    probeResourceKeysBySignature,
    probeResourceSequence,
    probeResources,
    readCatchToolkitStorageChecked,
    readCatchToolkitStorageString,
    relayEnvelope,
    resolveCatchToolkitFileName,
    sanitizeFileName,
    seen,
    subtitleExtensions,
    subtitlePattern,
    textToBase64,
    toAbsoluteUrl,
    uint16ArrayToUint8Array,
    uint32ArrayToUint8Array,
    workerRelayKey,
    writeCatchToolkitStorageChecked,
    writeCatchToolkitStorageString,
  ]
}

import { webContents, type OnBeforeSendHeadersListenerDetails, type Session } from 'electron'

export type EmbeddedBrowserCapturedResourceKind = 'manifest' | 'media' | 'image' | 'subtitle' | 'document' | 'key' | 'other'
export type EmbeddedBrowserCapturedResourceSource = 'network' | 'probe'
export type EmbeddedBrowserCapturedRequestHeaders = Record<string, string>
export type EmbeddedBrowserCapturedStreamType = 'audio' | 'video'

export type EmbeddedBrowserCapturedResource = {
  capturedAt: number
  contentLength?: number
  ext?: string
  id: string
  kind: EmbeddedBrowserCapturedResourceKind
  method?: string
  mimeType?: string
  pageUrl?: string
  referer?: string
  resourceKey?: string
  requestHeaders?: EmbeddedBrowserCapturedRequestHeaders
  resourceType?: string
  source: EmbeddedBrowserCapturedResourceSource
  statusCode?: number
  streamType?: EmbeddedBrowserCapturedStreamType
  tabId: string
  url: string
}

export type EmbeddedBrowserResourceCaptureSnapshot = {
  deepCaptureEnabled: boolean
  enabled: boolean
  resources: EmbeddedBrowserCapturedResource[]
}

type EmbeddedBrowserTabCaptureState = {
  deepCaptureEnabled: boolean
  enabled: boolean
  resources: Map<string, EmbeddedBrowserCapturedResource>
}

const manifestExtensions = new Set(['m3u8', 'mpd'])
const mediaExtensions = new Set([
  'mp4', 'm4v', 'm4a', 'm4s', 'mp3', 'aac', 'flac', 'wav', 'ogg', 'oga', 'ogv',
  'webm', 'mkv', 'mov', 'avi', 'ts', 'flv',
])
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'])
const subtitleExtensions = new Set(['vtt', 'srt', 'ass', 'ssa', 'ttml'])
const keyExtensions = new Set(['key', 'base64key'])
const relevantRequestHeaders = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'range',
  'referer',
  'user-agent',
])

const tabCaptureStates = new Map<string, EmbeddedBrowserTabCaptureState>()
const requestContextsByRequestId = new Map<number, {
  referer?: string
  requestHeaders?: EmbeddedBrowserCapturedRequestHeaders
}>()
let embeddedBrowserResourceBridgeInitialized = false
let emitCapturedResource: ((payload: EmbeddedBrowserCapturedResource) => void) | null = null

function createEmptyState(): EmbeddedBrowserTabCaptureState {
  return {
    deepCaptureEnabled: false,
    enabled: false,
    resources: new Map<string, EmbeddedBrowserCapturedResource>(),
  }
}

function getOrCreateTabCaptureState(tabId: string) {
  const normalizedTabId = String(tabId || '').trim()
  if (!normalizedTabId) {
    return null
  }
  const existingState = tabCaptureStates.get(normalizedTabId)
  if (existingState) {
    return existingState
  }
  const nextState = createEmptyState()
  tabCaptureStates.set(normalizedTabId, nextState)
  return nextState
}

function getTabCaptureState(tabId: string) {
  const normalizedTabId = String(tabId || '').trim()
  if (!normalizedTabId) {
    return null
  }
  return tabCaptureStates.get(normalizedTabId) || null
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  if (!headers) {
    return ''
  }
  const targetName = name.toLowerCase()
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== targetName) {
      continue
    }
    if (Array.isArray(headerValue)) {
      return String(headerValue[0] || '')
    }
    return String(headerValue || '')
  }
  return ''
}

function normalizeMimeType(input?: string | null) {
  return String(input || '').split(';')[0]?.trim().toLowerCase() || ''
}

function getResourceExtension(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const match = pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1] || ''
  } catch {
    const match = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/i)
    return match?.[1] || ''
  }
}

function classifyCapturedResource(input: {
  mimeType?: string
  resourceType?: string
  url: string
}): EmbeddedBrowserCapturedResourceKind {
  const normalizedMimeType = normalizeMimeType(input.mimeType)
  const extension = getResourceExtension(input.url)
  if (
    manifestExtensions.has(extension)
    || normalizedMimeType.includes('mpegurl')
    || normalizedMimeType.includes('dash+xml')
  ) {
    return 'manifest'
  }
  if (
    mediaExtensions.has(extension)
    || normalizedMimeType.startsWith('video/')
    || normalizedMimeType.startsWith('audio/')
    || input.resourceType === 'media'
    || String(input.url || '').startsWith('blob:')
  ) {
    return 'media'
  }
  if (imageExtensions.has(extension) || normalizedMimeType.startsWith('image/')) {
    return 'image'
  }
  if (subtitleExtensions.has(extension) || normalizedMimeType.includes('text/vtt')) {
    return 'subtitle'
  }
  if (extension === 'pdf' || normalizedMimeType === 'application/pdf') {
    return 'document'
  }
  if (
    keyExtensions.has(extension)
    || input.resourceType === 'key'
    || normalizedMimeType === 'application/octet-stream'
  ) {
    return 'key'
  }
  return 'other'
}

function shouldCaptureResource(input: {
  kind: EmbeddedBrowserCapturedResourceKind
  resourceType?: string
  url: string
}) {
  if (!input.url || input.url.startsWith('data:')) {
    return false
  }
  if (input.kind !== 'other') {
    return true
  }
  return input.resourceType === 'media' || input.url.startsWith('blob:')
}

function buildResourceKey(
  tabId: string,
  source: EmbeddedBrowserCapturedResourceSource,
  url: string,
  resourceKey?: string,
) {
  if (resourceKey) {
    return `${tabId}::${source}::${resourceKey}`
  }
  return `${tabId}::${source}::${url}`
}

function buildResourceId(
  tabId: string,
  source: EmbeddedBrowserCapturedResourceSource,
  url: string,
  resourceKey?: string,
) {
  return buildResourceKey(tabId, source, url, resourceKey)
}

function toSortedResourceList(resources: Map<string, EmbeddedBrowserCapturedResource>) {
  return Array.from(resources.values()).sort((left, right) => right.capturedAt - left.capturedAt)
}

function createSnapshotFromState(state: EmbeddedBrowserTabCaptureState): EmbeddedBrowserResourceCaptureSnapshot {
  return {
    deepCaptureEnabled: state.deepCaptureEnabled,
    enabled: state.enabled,
    resources: toSortedResourceList(state.resources),
  }
}

function updateCapturedResource(
  tabId: string,
  input: Omit<EmbeddedBrowserCapturedResource, 'id' | 'tabId'>,
) {
  const state = getTabCaptureState(tabId)
  if (!state?.enabled) {
    return null
  }
  const normalizedUrl = String(input.url || '').trim()
  if (!normalizedUrl) {
    return null
  }
  const stableResourceKey = String(input.resourceKey || '').trim() || undefined
  const storageKey = buildResourceKey(tabId, input.source, normalizedUrl, stableResourceKey)
  const previousResource = state.resources.get(storageKey)
  const nextResource: EmbeddedBrowserCapturedResource = {
    ...previousResource,
    ...input,
    ext: input.ext || previousResource?.ext || getResourceExtension(normalizedUrl) || undefined,
    id: buildResourceId(tabId, input.source, normalizedUrl, stableResourceKey),
    kind: input.kind,
    resourceKey: stableResourceKey,
    tabId,
    url: normalizedUrl,
  }
  const changed = JSON.stringify(previousResource) !== JSON.stringify(nextResource)
  if (!changed) {
    return previousResource || null
  }
  state.resources.set(storageKey, nextResource)
  emitCapturedResource?.(nextResource)
  return nextResource
}

function parseContentLength(rawValue: string) {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseContentRangeTotal(rawValue: string) {
  const value = String(rawValue || '').trim()
  if (!value) {
    return undefined
  }
  const match = value.match(/\/(\d+)\s*$/)
  if (!match?.[1]) {
    return undefined
  }
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function inferStreamType(input: {
  mimeType?: string
  resourceType?: string
  streamType?: EmbeddedBrowserCapturedStreamType
  url?: string
}) {
  if (input.streamType) {
    return input.streamType
  }
  const normalizedMimeType = normalizeMimeType(input.mimeType)
  if (normalizedMimeType.startsWith('audio/')) {
    return 'audio' as const
  }
  if (normalizedMimeType.startsWith('video/')) {
    return 'video' as const
  }
  const normalizedUrl = String(input.url || '').toLowerCase()
  if (/(^|[\/_.-])audio([\/_.-]|$)/.test(normalizedUrl)) {
    return 'audio' as const
  }
  if (/(^|[\/_.-])video([\/_.-]|$)/.test(normalizedUrl)) {
    return 'video' as const
  }
  if (input.resourceType === 'media') {
    return 'video' as const
  }
  return undefined
}

function pickRelevantRequestHeaders(headers: OnBeforeSendHeadersListenerDetails['requestHeaders'] | undefined) {
  if (!headers) {
    return undefined
  }
  const result: EmbeddedBrowserCapturedRequestHeaders = {}
  Object.entries(headers).forEach(([headerName, headerValue]) => {
    const normalizedName = headerName.toLowerCase()
    if (!relevantRequestHeaders.has(normalizedName)) {
      return
    }
    const normalizedValue = String(headerValue || '').trim()
    if (!normalizedValue) {
      return
    }
    result[normalizedName] = normalizedValue
  })
  return Object.keys(result).length ? result : undefined
}

export function getEmbeddedBrowserResourceCaptureSnapshot(tabId: string): EmbeddedBrowserResourceCaptureSnapshot {
  const state = getTabCaptureState(tabId)
  return state ? createSnapshotFromState(state) : createSnapshotFromState(createEmptyState())
}

export function startEmbeddedBrowserResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = true
  return createSnapshotFromState(state)
}

export function startEmbeddedBrowserDeepResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = true
  state.deepCaptureEnabled = true
  return createSnapshotFromState(state)
}

export function stopEmbeddedBrowserResourceCapture(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.enabled = false
  state.deepCaptureEnabled = false
  return createSnapshotFromState(state)
}

export function clearEmbeddedBrowserCapturedResources(tabId: string) {
  const state = getOrCreateTabCaptureState(tabId)
  if (!state) {
    return createSnapshotFromState(createEmptyState())
  }
  state.resources.clear()
  return createSnapshotFromState(state)
}

export function disposeEmbeddedBrowserCapturedResources(tabId: string) {
  tabCaptureStates.delete(String(tabId || '').trim())
}

export function isEmbeddedBrowserDeepCaptureEnabled(tabId: string) {
  return Boolean(getTabCaptureState(tabId)?.deepCaptureEnabled)
}

export function recordEmbeddedBrowserProbeResource(
  tabId: string,
  payload: Partial<Omit<EmbeddedBrowserCapturedResource, 'id' | 'tabId' | 'source'>> & {
    source?: EmbeddedBrowserCapturedResourceSource
    url?: string
  },
) {
  const state = getTabCaptureState(tabId)
  if (!state?.enabled || !state.deepCaptureEnabled) {
    return null
  }
  const url = String(payload.url || '').trim()
  if (!url) {
    return null
  }
  const kind = payload.kind || classifyCapturedResource({
    mimeType: payload.mimeType,
    resourceType: payload.resourceType,
    url,
  })
  if (!shouldCaptureResource({ kind, resourceType: payload.resourceType, url })) {
    return null
  }
  return updateCapturedResource(tabId, {
    capturedAt: Number(payload.capturedAt) || Date.now(),
    contentLength: payload.contentLength,
    ext: payload.ext,
    kind,
    method: payload.method,
    mimeType: normalizeMimeType(payload.mimeType),
    pageUrl: payload.pageUrl,
    resourceType: payload.resourceType,
    resourceKey: payload.resourceKey,
    source: payload.source || 'probe',
    statusCode: payload.statusCode,
    streamType: inferStreamType({
      mimeType: payload.mimeType,
      resourceType: payload.resourceType,
      streamType: payload.streamType,
      url,
    }),
    url,
  })
}

export function initializeEmbeddedBrowserResourceBridge(options: {
  browserSession: Session
  emitResource: (payload: EmbeddedBrowserCapturedResource) => void
  resolveTabIdByWebContentsId: (webContentsId: number) => string | null
}) {
  if (embeddedBrowserResourceBridgeInitialized) {
    return
  }
  embeddedBrowserResourceBridgeInitialized = true
  emitCapturedResource = options.emitResource

  options.browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    requestContextsByRequestId.set(details.id, {
      referer: details.referrer || undefined,
      requestHeaders: pickRelevantRequestHeaders(details.requestHeaders),
    })
    callback({ cancel: false, requestHeaders: details.requestHeaders })
  })

  options.browserSession.webRequest.onCompleted((details) => {
    if (!details.webContentsId) {
      requestContextsByRequestId.delete(details.id)
      return
    }
    const tabId = options.resolveTabIdByWebContentsId(details.webContentsId)
    const state = tabId ? getTabCaptureState(tabId) : null
    if (!tabId || !state?.enabled) {
      requestContextsByRequestId.delete(details.id)
      return
    }
    if (details.statusCode < 200 || details.statusCode >= 400) {
      requestContextsByRequestId.delete(details.id)
      return
    }

    const targetWebContents = webContents.fromId(details.webContentsId)
    const url = String(details.url || '').trim()
    const requestContext = requestContextsByRequestId.get(details.id)
    const mimeType = normalizeMimeType(getHeaderValue(details.responseHeaders, 'content-type'))
    const kind = classifyCapturedResource({
      mimeType,
      resourceType: details.resourceType,
      url,
    })
    if (!shouldCaptureResource({ kind, resourceType: details.resourceType, url })) {
      requestContextsByRequestId.delete(details.id)
      return
    }

    updateCapturedResource(tabId, {
      capturedAt: Date.now(),
      contentLength:
        parseContentRangeTotal(getHeaderValue(details.responseHeaders, 'content-range'))
        || parseContentLength(getHeaderValue(details.responseHeaders, 'content-length')),
      ext: getResourceExtension(url) || undefined,
      kind,
      method: details.method || undefined,
      mimeType,
      pageUrl: targetWebContents?.getURL() || undefined,
      referer: requestContext?.referer || details.referrer || undefined,
      requestHeaders: requestContext?.requestHeaders,
      resourceType: details.resourceType || undefined,
      source: 'network',
      statusCode: details.statusCode || undefined,
      streamType: inferStreamType({
        mimeType,
        resourceType: details.resourceType,
        url,
      }),
      url,
    })
    requestContextsByRequestId.delete(details.id)
  })

  options.browserSession.webRequest.onErrorOccurred((details) => {
    requestContextsByRequestId.delete(details.id)
  })
}

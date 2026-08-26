import crypto from 'node:crypto'

const DEFAULT_PENDING_TTL_MS = 60_000
const DEFAULT_CONTEXT_TTL_MS = 30 * 60_000
const DEFAULT_MAX_PENDING_ENTRIES = 1_024
const DEFAULT_MAX_CONTEXT_ENTRIES = 2_048

const DIRECT_PROTECTED_HEADER_NAMES = new Set([
  'referer',
  'origin',
  'cookie',
  'authorization',
  'auth',
  'token',
  'key',
  'access-token',
  'api-key',
  'app-token',
  'authtoken',
  'session-id',
])
const X_PROTECTED_HEADER_KEYWORDS = /(auth|token|sign|key|ticket|session)/

export const NETWORK_CONTEXT_PURPOSES = [
  'external-tool',
  'page-drag-stage',
  'resource-download',
  'resource-inspection',
] as const

export const NETWORK_CONTEXT_INVALIDATION_REASONS = [
  'capacity',
  'expired',
  'release',
  'tab-clear',
  'web-contents-clear',
  'vault-clear',
] as const

export type NetworkContextPurpose = typeof NETWORK_CONTEXT_PURPOSES[number]
export type NetworkContextReplayResourceType = 'xhr' | 'media' | 'image'
export type NetworkContextInvalidationReason =
  typeof NETWORK_CONTEXT_INVALIDATION_REASONS[number]

export type NetworkContextInvalidation = {
  contextRef: string
  reason: NetworkContextInvalidationReason
}

export type NetworkContextInvalidationListener = (
  invalidation: NetworkContextInvalidation,
) => void

export type NetworkRequestHeaderInput = {
  binaryValue?: Uint8Array
  name: string
  value?: string
}

export type NetworkRequestHeadersInput =
  | readonly NetworkRequestHeaderInput[]
  | Readonly<Record<string, string | readonly string[] | undefined>>

export type RecordNetworkRequestInput = {
  navigationGeneration: number
  observedRequestUrl: string
  pageOrigin: string
  requestHeaders: NetworkRequestHeadersInput
  requestId: number | string
  sourceResourceType: string
  tabId: string
  webContentsId: number
}

export type PromoteNetworkRequestInput = {
  navigationGeneration: number
  observedRequestUrl: string
  purposes: readonly NetworkContextPurpose[]
  requestId: number | string
  resourceUrl: string
  sourceResourceType: string
  tabId: string
  webContentsId: number
}

export type FinishNetworkRequestInput = {
  requestId: number | string
  webContentsId: number
}

export type NetworkContextProjection = {
  capabilities: {
    hasAuthorization: boolean
    hasCookie: boolean
  }
  contextRef: string
  headerNames: string[]
}

export type NetworkContextRedemptionInput = {
  contextRef: string
  navigationGeneration: number
  pageOrigin: string
  purpose: NetworkContextPurpose
  replayResourceType: NetworkContextReplayResourceType
  resourceUrl: string
  tabId: string
  webContentsId: number
}

export type NetworkContextRedemption = {
  headers: Array<[name: string, value: string]>
  redirectMode: 'manual'
}

export type NetworkContextVaultOptions = {
  contextTtlMs?: number
  createContextRef?: () => string
  maxContextEntries?: number
  maxPendingEntries?: number
  now?: () => number
  onContextInvalidated?: (invalidation: NetworkContextInvalidation) => void
  pendingTtlMs?: number
}

type NormalizedRequestBinding = {
  navigationGeneration: number
  observedRequestUrl: string
  pageOrigin: string
  requestId: string
  sourceResourceType: string
  tabId: string
  webContentsId: number
}

type ProtectedRequestHeaders = {
  cookie?: string
  headers: Array<[name: string, value: string]>
}

type PendingRequestContext = NormalizedRequestBinding & ProtectedRequestHeaders & {
  expiresAt: number
}

type RetainedNetworkContext = NormalizedRequestBinding & ProtectedRequestHeaders & {
  contextRef: string
  expiresAt: number
  purposes: Set<NetworkContextPurpose>
  resourceUrl: string
}

const supportedPurposeSet = new Set<NetworkContextPurpose>(NETWORK_CONTEXT_PURPOSES)
const supportedReplayResourceTypeSet = new Set<NetworkContextReplayResourceType>([
  'xhr',
  'media',
  'image',
])

function normalizePositiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeRequestId(value: unknown) {
  const requestId = String(value ?? '').trim()
  return requestId || null
}

function normalizeTabId(value: unknown) {
  const tabId = String(value ?? '').trim()
  return tabId || null
}

function normalizeWebContentsId(value: unknown) {
  const webContentsId = Number(value)
  return Number.isInteger(webContentsId) && webContentsId > 0 ? webContentsId : null
}

function normalizeNavigationGeneration(value: unknown) {
  const navigationGeneration = Number(value)
  return Number.isInteger(navigationGeneration) && navigationGeneration >= 0
    ? navigationGeneration
    : null
}

function normalizeSourceResourceType(value: unknown) {
  const resourceType = String(value || '').trim().toLowerCase()
  return resourceType || null
}

function normalizeReplayResourceType(value: unknown): NetworkContextReplayResourceType | null {
  const resourceType = String(value || '').toLowerCase() as NetworkContextReplayResourceType
  return supportedReplayResourceTypeSet.has(resourceType) ? resourceType : null
}

function normalizeHttpUrl(value: unknown) {
  const url = String(value || '').trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return { origin: parsed.origin, url }
  } catch {
    return null
  }
}

function normalizeOrigin(value: unknown) {
  const rawOrigin = String(value || '').trim()
  if (!rawOrigin) return null
  try {
    const origin = new URL(rawOrigin).origin
    return origin && origin !== 'null' ? origin : null
  } catch {
    return null
  }
}

function normalizeRecordBinding(
  input: Omit<RecordNetworkRequestInput, 'requestHeaders'>,
): NormalizedRequestBinding | null {
  const requestId = normalizeRequestId(input.requestId)
  const tabId = normalizeTabId(input.tabId)
  const webContentsId = normalizeWebContentsId(input.webContentsId)
  const navigationGeneration = normalizeNavigationGeneration(input.navigationGeneration)
  const sourceResourceType = normalizeSourceResourceType(input.sourceResourceType)
  const observedRequest = normalizeHttpUrl(input.observedRequestUrl)
  const pageOrigin = normalizeOrigin(input.pageOrigin)
  if (
    !requestId
    || !tabId
    || webContentsId === null
    || navigationGeneration === null
    || !sourceResourceType
    || !observedRequest
    || !pageOrigin
  ) {
    return null
  }
  return {
    navigationGeneration,
    observedRequestUrl: observedRequest.url,
    pageOrigin,
    requestId,
    sourceResourceType,
    tabId,
    webContentsId,
  }
}

function normalizePromoteBinding(input: PromoteNetworkRequestInput) {
  const requestId = normalizeRequestId(input.requestId)
  const tabId = normalizeTabId(input.tabId)
  const webContentsId = normalizeWebContentsId(input.webContentsId)
  const navigationGeneration = normalizeNavigationGeneration(input.navigationGeneration)
  const sourceResourceType = normalizeSourceResourceType(input.sourceResourceType)
  const observedRequest = normalizeHttpUrl(input.observedRequestUrl)
  const resource = normalizeHttpUrl(input.resourceUrl)
  if (
    !requestId
    || !tabId
    || webContentsId === null
    || navigationGeneration === null
    || !sourceResourceType
    || !observedRequest
    || !resource
  ) {
    return null
  }
  return {
    navigationGeneration,
    observedRequestUrl: observedRequest.url,
    requestId,
    resourceUrl: resource.url,
    sourceResourceType,
    tabId,
    webContentsId,
  }
}

function normalizePurposes(values: readonly NetworkContextPurpose[]) {
  if (!Array.isArray(values) || values.length === 0) return null
  const purposes = new Set<NetworkContextPurpose>()
  for (const value of values) {
    if (!supportedPurposeSet.has(value)) return null
    purposes.add(value)
  }
  return purposes.size > 0 ? purposes : null
}

function buildPendingKey(webContentsId: number, requestId: string) {
  return `${webContentsId}\u0000${requestId}`
}

function toHeaderEntries(input: NetworkRequestHeadersInput) {
  if (Array.isArray(input)) {
    return (input as readonly NetworkRequestHeaderInput[]).map(item => ({
      name: item.name,
      value: item.value,
    }))
  }
  const entries: Array<{ name: string; value?: string }> = []
  for (const [name, rawValue] of Object.entries(
    input as Readonly<Record<string, string | readonly string[] | undefined>>,
  )) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) entries.push({ name, value })
    } else {
      entries.push({ name, value: rawValue as string | undefined })
    }
  }
  return entries
}

/**
 * Upstream: xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * Source: js/background.js#getRequestHeaders
 * Reason: Preserve Cat Catch's credential-header allowlist and duplicate ordering.
 * Adaptation: Cookie is separated and every value remains inside this main-only vault.
 * Fixture: none; covered by network.sensitive-header-projection.
 */
function selectProtectedRequestHeaders(input: NetworkRequestHeadersInput): ProtectedRequestHeaders | null {
  const selectedHeaders = new Map<string, string>()
  let cookie: string | undefined
  for (const item of toHeaderEntries(input)) {
    if (!item.name || !item.value) continue
    const name = item.name.toLowerCase()
    const selected = DIRECT_PROTECTED_HEADER_NAMES.has(name)
      || (name.startsWith('x-') && X_PROTECTED_HEADER_KEYWORDS.test(name))
    if (!selected) continue
    if (name === 'cookie') {
      cookie = item.value
      continue
    }
    selectedHeaders.set(name, item.value)
  }
  if (selectedHeaders.size === 0 && cookie === undefined) return null
  return {
    cookie,
    headers: Array.from(selectedHeaders.entries()),
  }
}

function samePromoteBinding(
  pending: PendingRequestContext,
  binding: NonNullable<ReturnType<typeof normalizePromoteBinding>>,
) {
  return pending.navigationGeneration === binding.navigationGeneration
    && pending.observedRequestUrl === binding.observedRequestUrl
    && pending.requestId === binding.requestId
    && pending.sourceResourceType === binding.sourceResourceType
    && pending.tabId === binding.tabId
    && pending.webContentsId === binding.webContentsId
}

function deleteOldestEntry<T>(records: Map<string, T>) {
  const oldest = records.keys().next()
  if (oldest.done) return false
  return records.delete(oldest.value)
}

export class NetworkContextVault {
  private readonly contextTtlMs: number
  private readonly createContextRef: () => string
  private readonly maxContextEntries: number
  private readonly maxPendingEntries: number
  private readonly now: () => number
  private readonly onContextInvalidated: (invalidation: NetworkContextInvalidation) => void
  private readonly pendingTtlMs: number
  private readonly pendingRequests = new Map<string, PendingRequestContext>()
  private readonly retainedContexts = new Map<string, RetainedNetworkContext>()
  private readonly invalidationListeners = new Set<NetworkContextInvalidationListener>()

  constructor(options: NetworkContextVaultOptions = {}) {
    this.contextTtlMs = normalizePositiveNumber(options.contextTtlMs, DEFAULT_CONTEXT_TTL_MS)
    this.createContextRef = options.createContextRef
      || (() => crypto.randomBytes(24).toString('base64url'))
    this.maxContextEntries = normalizePositiveInteger(
      options.maxContextEntries,
      DEFAULT_MAX_CONTEXT_ENTRIES,
    )
    this.maxPendingEntries = normalizePositiveInteger(
      options.maxPendingEntries,
      DEFAULT_MAX_PENDING_ENTRIES,
    )
    this.now = options.now || Date.now
    this.onContextInvalidated = options.onContextInvalidated || (() => {})
    this.pendingTtlMs = normalizePositiveNumber(options.pendingTtlMs, DEFAULT_PENDING_TTL_MS)
  }

  recordRequest(input: RecordNetworkRequestInput) {
    const binding = normalizeRecordBinding(input)
    if (!binding) return false
    const pendingKey = buildPendingKey(binding.webContentsId, binding.requestId)
    const protectedHeaders = selectProtectedRequestHeaders(input.requestHeaders)
    this.pendingRequests.delete(pendingKey)
    if (!protectedHeaders) return false
    while (this.pendingRequests.size >= this.maxPendingEntries) {
      if (!deleteOldestEntry(this.pendingRequests)) break
    }
    const createdAt = this.now()
    this.pendingRequests.set(pendingKey, {
      ...binding,
      ...protectedHeaders,
      expiresAt: createdAt + this.pendingTtlMs,
    })
    return true
  }

  promoteRequest(input: PromoteNetworkRequestInput): NetworkContextProjection | null {
    const binding = normalizePromoteBinding(input)
    if (!binding) return null
    const pendingKey = buildPendingKey(binding.webContentsId, binding.requestId)
    const pending = this.pendingRequests.get(pendingKey)
    if (!pending) return null
    this.pendingRequests.delete(pendingKey)
    const purposes = normalizePurposes(input.purposes)
    if (
      pending.expiresAt <= this.now()
      || !purposes
      || !samePromoteBinding(pending, binding)
      || binding.resourceUrl !== binding.observedRequestUrl
    ) {
      return null
    }

    while (this.retainedContexts.size >= this.maxContextEntries) {
      if (!this.deleteOldestRetainedContext('capacity')) break
    }
    const contextRef = this.createUniqueContextRef()
    const createdAt = this.now()
    this.retainedContexts.set(contextRef, {
      ...pending,
      contextRef,
      expiresAt: createdAt + this.contextTtlMs,
      purposes,
      resourceUrl: binding.resourceUrl,
    })
    const headerNames = pending.headers.map(([name]) => name)
    if (pending.cookie !== undefined) headerNames.push('cookie')
    return {
      capabilities: {
        hasAuthorization: pending.headers.some(([name]) => name === 'authorization'),
        hasCookie: pending.cookie !== undefined,
      },
      contextRef,
      headerNames,
    }
  }

  finishRequest(input: FinishNetworkRequestInput) {
    const requestId = normalizeRequestId(input.requestId)
    const webContentsId = normalizeWebContentsId(input.webContentsId)
    if (!requestId || webContentsId === null) return false
    return this.pendingRequests.delete(buildPendingKey(webContentsId, requestId))
  }

  subscribeContextInvalidations(listener: NetworkContextInvalidationListener) {
    this.invalidationListeners.add(listener)
    return () => {
      this.invalidationListeners.delete(listener)
    }
  }

  redeem(input: NetworkContextRedemptionInput): NetworkContextRedemption | null {
    const contextRef = String(input.contextRef || '').trim()
    const tabId = normalizeTabId(input.tabId)
    const webContentsId = normalizeWebContentsId(input.webContentsId)
    const navigationGeneration = normalizeNavigationGeneration(input.navigationGeneration)
    const replayResourceType = normalizeReplayResourceType(input.replayResourceType)
    const resource = normalizeHttpUrl(input.resourceUrl)
    const pageOrigin = normalizeOrigin(input.pageOrigin)
    if (
      !contextRef
      || !tabId
      || webContentsId === null
      || navigationGeneration === null
      || !replayResourceType
      || !resource
      || !pageOrigin
      || !supportedPurposeSet.has(input.purpose)
    ) {
      return null
    }
    const context = this.retainedContexts.get(contextRef)
    if (context && context.expiresAt <= this.now()) {
      this.deleteRetainedContext(contextRef, 'expired')
      return null
    }
    if (
      !context
      || context.tabId !== tabId
      || context.webContentsId !== webContentsId
      || context.navigationGeneration !== navigationGeneration
      || context.resourceUrl !== resource.url
      || context.pageOrigin !== pageOrigin
      || !context.purposes.has(input.purpose)
    ) {
      return null
    }

    const headers = context.headers.map(([name, value]): [string, string] => [name, value])
    // page-drag-stage uses the owned Electron session's cookie jar instead of replaying a stale Cookie value.
    if (context.cookie !== undefined && input.purpose !== 'page-drag-stage') {
      headers.push(['cookie', context.cookie])
    }
    return { headers, redirectMode: 'manual' }
  }

  release(contextRef: string) {
    return this.deleteRetainedContext(String(contextRef || '').trim(), 'release')
  }

  clearTab(tabId: string) {
    const normalizedTabId = normalizeTabId(tabId)
    if (!normalizedTabId) return 0
    return this.deleteMatching(record => record.tabId === normalizedTabId, 'tab-clear')
  }

  clearWebContents(webContentsId: number) {
    const normalizedWebContentsId = normalizeWebContentsId(webContentsId)
    if (normalizedWebContentsId === null) return 0
    return this.deleteMatching(
      record => record.webContentsId === normalizedWebContentsId,
      'web-contents-clear',
    )
  }

  sweepExpired() {
    const now = this.now()
    let removed = 0
    for (const [key, record] of this.pendingRequests) {
      if (record.expiresAt <= now) {
        this.pendingRequests.delete(key)
        removed += 1
      }
    }
    for (const [contextRef, record] of this.retainedContexts) {
      if (record.expiresAt <= now) {
        this.deleteRetainedContext(contextRef, 'expired')
        removed += 1
      }
    }
    return removed
  }

  clear() {
    const removed = this.pendingRequests.size + this.retainedContexts.size
    this.pendingRequests.clear()
    for (const contextRef of Array.from(this.retainedContexts.keys())) {
      this.deleteRetainedContext(contextRef, 'vault-clear')
    }
    return removed
  }

  private createUniqueContextRef() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const contextRef = String(this.createContextRef() || '').trim()
      if (contextRef && !this.retainedContexts.has(contextRef)) return contextRef
    }
    throw new Error('Unable to allocate a unique network context reference')
  }

  private deleteOldestRetainedContext(reason: NetworkContextInvalidationReason) {
    const oldest = this.retainedContexts.keys().next()
    return !oldest.done && this.deleteRetainedContext(oldest.value, reason)
  }

  private deleteRetainedContext(
    contextRef: string,
    reason: NetworkContextInvalidationReason,
  ) {
    if (!contextRef || !this.retainedContexts.delete(contextRef)) return false
    const invalidation = { contextRef, reason }
    this.onContextInvalidated(invalidation)
    for (const listener of this.invalidationListeners) listener(invalidation)
    return true
  }

  private deleteMatching(
    predicate: (record: PendingRequestContext | RetainedNetworkContext) => boolean,
    retainedReason: NetworkContextInvalidationReason,
  ) {
    let removed = 0
    for (const [key, record] of this.pendingRequests) {
      if (predicate(record)) {
        this.pendingRequests.delete(key)
        removed += 1
      }
    }
    for (const [contextRef, record] of this.retainedContexts) {
      if (predicate(record)) {
        this.deleteRetainedContext(contextRef, retainedReason)
        removed += 1
      }
    }
    return removed
  }
}

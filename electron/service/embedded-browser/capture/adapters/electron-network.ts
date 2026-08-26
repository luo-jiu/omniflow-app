import {
  evaluateCatCatchPageUrlPolicy,
  isCatCatchSpecialPageUrl,
  type CompiledCatCatchUrlFilterRule,
} from '../../cat-catch-port/network/request-url-helpers'
import {
  compileCatCatchRules,
  type CatCatchCompiledRules,
} from '../../cat-catch-port/network/rules'
import {
  classifyOmniFlowNetworkResource,
  type OmniFlowNetworkResourceClassification,
} from '../policy/omniflow-capture-policy'
import {
  NETWORK_CONTEXT_PURPOSES,
  type NetworkContextProjection,
  type NetworkContextVault,
} from '../state/network-context-vault'
import {
  type CapturedResourceMetadataInput,
  type ResourceStateChange,
  type ResourceStateStore,
  type TabCaptureBinding,
} from '../state/resource-state-store'

const DEFAULT_MAX_PENDING_EVENTS = 1_024

type RequestDetails = {
  id: number
  method: string
  requestHeaders: Record<string, string>
  resourceType: string
  url: string
  webContentsId?: number
}

type ResponseDetails = {
  id: number
  method: string
  resourceType: string
  responseHeaders?: Record<string, string[]>
  statusCode: number
  url: string
  webContentsId?: number
}

type TerminalDetails = {
  id: number
  webContentsId?: number
}

export type ElectronNetworkWebRequestRegistrar = {
  onBeforeRedirect(listener: ((details: TerminalDetails) => void) | null): void
  onCompleted(listener: ((details: TerminalDetails) => void) | null): void
  onErrorOccurred(listener: ((details: TerminalDetails) => void) | null): void
  onResponseStarted(listener: ((details: ResponseDetails) => void) | null): void
  onSendHeaders(listener: ((details: RequestDetails) => void) | null): void
}

export type ElectronNetworkCaptureAdapterOptions = {
  emitChange: (change: ResourceStateChange) => void
  maxPendingEvents?: number
  now?: () => number
  pageUrlPolicy?: {
    blockUrlWhite?: boolean
    damn?: boolean
    forcedBlockPatterns?: readonly RegExp[]
    rules?: readonly CompiledCatCatchUrlFilterRule[]
  }
  resolveBindingByWebContentsId: (webContentsId: number) => TabCaptureBinding | null
  resolvePageUrlByWebContentsId: (webContentsId: number) => string | null
  rules?: CatCatchCompiledRules
  store: ResourceStateStore
  vault: NetworkContextVault
  webRequest: ElectronNetworkWebRequestRegistrar
}

type PendingEvent = {
  binding: TabCaptureBinding
  blocked: boolean
  method: string
  requestId: string
  resourceType: string
  url: string
  webContentsId: number
}

type CapturedClassification = OmniFlowNetworkResourceClassification & { decision: 'capture' }

function isCapturedClassification(
  classification: OmniFlowNetworkResourceClassification,
): classification is CapturedClassification {
  return classification.decision === 'capture'
}

function normalizeWebContentsId(value: unknown) {
  const webContentsId = Number(value)
  return Number.isInteger(webContentsId) && webContentsId > 0 ? webContentsId : null
}

function normalizeRequestId(value: unknown) {
  const requestId = String(value ?? '').trim()
  return requestId || null
}

function requestKey(webContentsId: number, requestId: string) {
  return `${webContentsId}\u0000${requestId}`
}

function getHeaderValue(
  headers: Record<string, string[] | undefined> | undefined,
  targetName: string,
) {
  if (!headers) return ''
  const normalizedTarget = targetName.toLowerCase()
  for (const [name, values] of Object.entries(headers)) {
    if (name.toLowerCase() === normalizedTarget) return String(values?.[0] || '')
  }
  return ''
}

function normalizeMimeType(value: string) {
  return value.split(';')[0]?.trim().toLowerCase() || ''
}

function parseContentLength(responseHeaders: ResponseDetails['responseHeaders']) {
  const contentRange = getHeaderValue(responseHeaders, 'content-range')
  const rangeMatch = contentRange.match(/\/(\d+)\s*$/)
  const value = Number(rangeMatch?.[1] || getHeaderValue(responseHeaders, 'content-length'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function inferStreamType(input: { mimeType?: string; resourceType: string; url: string }) {
  if (input.mimeType?.startsWith('audio/')) return 'audio' as const
  if (input.mimeType?.startsWith('video/')) return 'video' as const
  const url = input.url.toLowerCase()
  if (/(^|[/_.-])audio([/_.-]|$)/.test(url)) return 'audio' as const
  if (/(^|[/_.-])video([/_.-]|$)/.test(url) || input.resourceType === 'media') {
    return 'video' as const
  }
  return undefined
}

function toMetadata(
  classification: CapturedClassification,
  details: Pick<RequestDetails, 'method' | 'resourceType'> & Partial<Pick<ResponseDetails, 'responseHeaders' | 'statusCode'>>,
  capturedAt: number,
): CapturedResourceMetadataInput {
  return {
    capturedAt,
    contentLength: parseContentLength(details.responseHeaders),
    ext: classification.extension,
    kind: classification.kind || 'other',
    method: details.method,
    mimeType: classification.mimeType,
    name: classification.name,
    resourceType: details.resourceType,
    statusCode: details.statusCode,
    streamType: inferStreamType({
      mimeType: classification.mimeType,
      resourceType: details.resourceType,
      url: classification.url,
    }),
    url: classification.url,
  }
}

/**
 * Electron adaptation of Cat Catch's onSendHeaders -> onResponseStarted lifecycle.
 * This adapter is intentionally not registered by the production bridge until the
 * complete network-capture cutover unit is ready.
 */
export class ElectronNetworkCaptureAdapter {
  private disposed = false
  private readonly maxPendingEvents: number
  private readonly now: () => number
  private readonly options: ElectronNetworkCaptureAdapterOptions
  private readonly pendingEvents = new Map<string, PendingEvent>()
  private readonly rules: CatCatchCompiledRules
  private readonly unsubscribeInvalidations: () => void

  constructor(options: ElectronNetworkCaptureAdapterOptions) {
    this.options = options
    this.maxPendingEvents = Number.isInteger(options.maxPendingEvents)
      && Number(options.maxPendingEvents) > 0
      ? Number(options.maxPendingEvents)
      : DEFAULT_MAX_PENDING_EVENTS
    this.now = options.now || Date.now
    this.rules = options.rules || compileCatCatchRules()
    this.unsubscribeInvalidations = options.vault.subscribeContextInvalidations(({ contextRef }) => {
      for (const change of options.store.invalidateContext(contextRef)) options.emitChange(change)
    })

    options.webRequest.onSendHeaders(this.handleSendHeaders)
    options.webRequest.onResponseStarted(this.handleResponseStarted)
    options.webRequest.onBeforeRedirect(this.handleTerminal)
    options.webRequest.onCompleted(this.handleTerminal)
    options.webRequest.onErrorOccurred(this.handleTerminal)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.options.webRequest.onSendHeaders(null)
    this.options.webRequest.onResponseStarted(null)
    this.options.webRequest.onBeforeRedirect(null)
    this.options.webRequest.onCompleted(null)
    this.options.webRequest.onErrorOccurred(null)
    for (const pending of this.pendingEvents.values()) {
      this.options.vault.finishRequest(pending)
    }
    this.pendingEvents.clear()
    this.options.vault.clear()
    this.unsubscribeInvalidations()
  }

  sweepExpired() {
    this.options.vault.sweepExpired()
    for (const change of this.options.store.sweepExpired()) this.options.emitChange(change)
  }

  private readonly handleSendHeaders = (details: RequestDetails) => {
    if (this.disposed) return
    const webContentsId = normalizeWebContentsId(details.webContentsId)
    const requestId = normalizeRequestId(details.id)
    if (webContentsId === null || !requestId) return
    const key = requestKey(webContentsId, requestId)
    const previous = this.pendingEvents.get(key)
    if (previous) this.options.vault.finishRequest(previous)
    this.pendingEvents.delete(key)

    if (details.method.toUpperCase() === 'OPTIONS' || isCatCatchSpecialPageUrl(details.url)) return
    const binding = this.options.resolveBindingByWebContentsId(webContentsId)
    const pageUrl = this.options.resolvePageUrlByWebContentsId(webContentsId)
    if (!binding || binding.webContentsId !== webContentsId || !pageUrl) return
    const pageDecision = evaluateCatCatchPageUrlPolicy({
      blockUrlWhite: this.options.pageUrlPolicy?.blockUrlWhite,
      damn: this.options.pageUrlPolicy?.damn,
      forcedBlockPatterns: this.options.pageUrlPolicy?.forcedBlockPatterns,
      rules: this.options.pageUrlPolicy?.rules || [],
      url: pageUrl,
    })
    if (pageDecision.decision === 'block' || !binding.pageOrigin) return

    const classification = classifyOmniFlowNetworkResource({
      resourceType: details.resourceType,
      stage: 'request',
      url: details.url,
    }, this.rules)
    const pending: PendingEvent = {
      binding,
      blocked: classification.decision === 'reject',
      method: details.method,
      requestId,
      resourceType: details.resourceType,
      url: details.url,
      webContentsId,
    }
    this.rememberPending(key, pending)
    this.options.vault.recordRequest({
      navigationGeneration: binding.navigationGeneration,
      observedRequestUrl: details.url,
      pageOrigin: binding.pageOrigin,
      requestHeaders: details.requestHeaders,
      requestId,
      sourceResourceType: details.resourceType,
      tabId: binding.tabId,
      webContentsId,
    })

    if (isCapturedClassification(classification)) {
      this.pendingEvents.delete(key)
      const context = this.promoteContext(pending, classification.url)
      this.writeResource(pending, classification, context)
    } else if (classification.decision === 'reject') {
      this.options.vault.finishRequest(pending)
    }
  }

  private readonly handleResponseStarted = (details: ResponseDetails) => {
    if (this.disposed) return
    const webContentsId = normalizeWebContentsId(details.webContentsId)
    const requestId = normalizeRequestId(details.id)
    if (webContentsId === null || !requestId) return
    const key = requestKey(webContentsId, requestId)
    const pending = this.pendingEvents.get(key)
    this.pendingEvents.delete(key)
    if (!pending) {
      this.options.vault.finishRequest({ requestId, webContentsId })
      return
    }
    if (
      pending.blocked
      || pending.method !== details.method
      || pending.resourceType !== details.resourceType
      || pending.url !== details.url
    ) {
      this.options.vault.finishRequest(pending)
      return
    }

    const mimeType = normalizeMimeType(getHeaderValue(details.responseHeaders, 'content-type'))
    const classification = classifyOmniFlowNetworkResource({
      contentDisposition: getHeaderValue(details.responseHeaders, 'content-disposition'),
      mimeType,
      resourceType: details.resourceType,
      size: parseContentLength(details.responseHeaders),
      stage: 'response',
      url: details.url,
    }, this.rules)
    if (!isCapturedClassification(classification)) {
      this.options.vault.finishRequest(pending)
      return
    }
    const context = this.promoteContext(pending, classification.url)
    this.writeResource(pending, classification, context, details)
  }

  private readonly handleTerminal = (details: TerminalDetails) => {
    if (this.disposed) return
    const requestId = normalizeRequestId(details.id)
    const webContentsId = normalizeWebContentsId(details.webContentsId)
    if (!requestId) return
    if (webContentsId !== null) {
      const key = requestKey(webContentsId, requestId)
      const pending = this.pendingEvents.get(key)
      this.pendingEvents.delete(key)
      this.options.vault.finishRequest(pending || { requestId, webContentsId })
      return
    }
    for (const [key, pending] of this.pendingEvents) {
      if (pending.requestId !== requestId) continue
      this.pendingEvents.delete(key)
      this.options.vault.finishRequest(pending)
    }
  }

  private rememberPending(key: string, pending: PendingEvent) {
    while (this.pendingEvents.size >= this.maxPendingEvents) {
      const oldest = this.pendingEvents.entries().next()
      if (oldest.done) break
      this.pendingEvents.delete(oldest.value[0])
      this.options.vault.finishRequest(oldest.value[1])
    }
    this.pendingEvents.set(key, pending)
  }

  private promoteContext(pending: PendingEvent, resourceUrl: string) {
    return this.options.vault.promoteRequest({
      navigationGeneration: pending.binding.navigationGeneration,
      observedRequestUrl: pending.url,
      purposes: NETWORK_CONTEXT_PURPOSES,
      requestId: pending.requestId,
      resourceUrl,
      sourceResourceType: pending.resourceType,
      tabId: pending.binding.tabId,
      webContentsId: pending.webContentsId,
    })
  }

  private writeResource(
    pending: PendingEvent,
    classification: CapturedClassification,
    context: NetworkContextProjection | null,
    response?: ResponseDetails,
  ) {
    const result = this.options.store.recordNetworkResource({
      binding: pending.binding,
      context: context || undefined,
      metadata: toMetadata(classification, response || pending, this.now()),
    })
    if (result.change) this.options.emitChange(result.change)
  }
}

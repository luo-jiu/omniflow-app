import type { CapturedResourceProjection } from '../contracts/captured-resource'
import {
  NETWORK_CONTEXT_PURPOSES,
  type NetworkContextPurpose,
  type NetworkContextReplayResourceType,
  type NetworkContextVault,
} from '../capture/state/network-context-vault'
import {
  type OwnedCapturedResource,
  type ResourceStateStore,
} from '../capture/state/resource-state-store'

const DEFAULT_MAX_REDIRECTS = 3
const supportedPurposeSet = new Set<NetworkContextPurpose>(NETWORK_CONTEXT_PURPOSES)

export type CapturedResourceAccessInput = {
  purpose: NetworkContextPurpose
  resourceId: string
  tabId: string
}

export type CapturedResourceAccessGrant = {
  headers: Array<[name: string, value: string]>
  purpose: NetworkContextPurpose
  redirectMode: 'manual'
  replayResourceType: NetworkContextReplayResourceType
  resource: Omit<CapturedResourceProjection, 'context'>
}

export type CapturedResourceFetchInput = CapturedResourceAccessInput & {
  maxRedirects?: number
  signal?: AbortSignal
}

export type CapturedResourceFetchResult = {
  finalUrl: string
  redirectCount: number
  resource: CapturedResourceAccessGrant['resource']
  response: Response
}

export type CapturedResourceFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

export type CapturedResourceAccessServiceOptions = {
  /** Must be bound to the captured tab's Electron session at production wiring. */
  fetch: CapturedResourceFetch
  store: ResourceStateStore
  vault: NetworkContextVault
}

function normalizeIdentifier(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function normalizeHttpUrl(value: unknown, baseUrl?: string) {
  const rawUrl = String(value ?? '').trim()
  if (!rawUrl) return null
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    // The vault binds the observed first-hop URL by exact string. Preserve that
    // spelling; only redirect Location values need resolution/normalization.
    return baseUrl ? parsed.toString() : rawUrl
  } catch {
    return null
  }
}

function normalizeMaxRedirects(value: unknown) {
  const normalized = Number(value)
  return Number.isInteger(normalized) && normalized >= 0
    ? normalized
    : DEFAULT_MAX_REDIRECTS
}

function inferReplayResourceType(
  resource: OwnedCapturedResource,
): NetworkContextReplayResourceType {
  const resourceType = String(resource.resourceType || '').toLowerCase()
  if (resource.kind === 'image' || resourceType === 'image') return 'image'
  if (resource.kind === 'media' || resourceType === 'media') return 'media'
  return 'xhr'
}

function projectOwnedResource(
  resource: OwnedCapturedResource,
): Omit<CapturedResourceProjection, 'context'> {
  return {
    capturedAt: resource.capturedAt,
    contentLength: resource.contentLength,
    ext: resource.ext,
    id: resource.id,
    kind: resource.kind,
    method: resource.method,
    mimeType: resource.mimeType,
    name: resource.name,
    resourceType: resource.resourceType,
    source: resource.source,
    statusCode: resource.statusCode,
    streamType: resource.streamType,
    tabId: resource.tabId,
    url: resource.url,
  }
}

async function discardRedirectBody(response: Response) {
  if (!response.body) return
  await response.body.cancel().catch(() => undefined)
}

/**
 * Main-only authority for turning an opaque captured resource id into one scoped
 * request. Renderer-provided URLs and header values never enter this boundary.
 */
export class CapturedResourceAccessService {
  private readonly fetchImpl: CapturedResourceFetch
  private readonly options: CapturedResourceAccessServiceOptions

  constructor(options: CapturedResourceAccessServiceOptions) {
    this.options = options
    this.fetchImpl = options.fetch
  }

  redeem(input: CapturedResourceAccessInput): CapturedResourceAccessGrant | null {
    const tabId = normalizeIdentifier(input.tabId)
    const resourceId = normalizeIdentifier(input.resourceId)
    if (!tabId || !resourceId || !supportedPurposeSet.has(input.purpose)) return null
    const owned = this.options.store.getOwnedResource(tabId, resourceId)
    if (!owned || owned.tabId !== tabId) return null
    const resourceUrl = normalizeHttpUrl(owned.url)
    if (!resourceUrl) return null

    const currentBinding = this.options.store.getCaptureBinding(tabId)
    if (
      !currentBinding
      || currentBinding.incarnation !== owned.capturedIncarnation
      || currentBinding.navigationGeneration !== owned.capturedNavigationGeneration
      || currentBinding.pageOrigin !== owned.capturedPageOrigin
      || currentBinding.webContentsId !== owned.capturedWebContentsId
    ) {
      return null
    }

    const replayResourceType = inferReplayResourceType(owned)
    let headers: Array<[name: string, value: string]> = []
    if (owned.contextRef) {
      if (!owned.capturedPageOrigin) return null
      const redemption = this.options.vault.redeem({
        contextRef: owned.contextRef,
        navigationGeneration: owned.capturedNavigationGeneration,
        pageOrigin: owned.capturedPageOrigin,
        purpose: input.purpose,
        replayResourceType,
        resourceUrl,
        tabId,
        webContentsId: owned.capturedWebContentsId,
      })
      if (!redemption) return null
      headers = redemption.headers
    }

    return {
      headers: headers.map(([name, value]) => [name, value]),
      purpose: input.purpose,
      redirectMode: 'manual',
      replayResourceType,
      resource: projectOwnedResource(owned),
    }
  }

  async fetch(input: CapturedResourceFetchInput): Promise<CapturedResourceFetchResult> {
    const grant = this.redeem(input)
    if (!grant) throw new Error('Captured resource access is unavailable or stale')

    const maxRedirects = normalizeMaxRedirects(input.maxRedirects)
    let currentUrl = grant.resource.url
    let headers = grant.headers
    let redirectCount = 0

    for (;;) {
      const response = await this.fetchImpl(currentUrl, {
        ...(input.purpose === 'page-drag-stage' ? { credentials: 'include' as const } : {}),
        headers: Object.fromEntries(headers),
        redirect: grant.redirectMode,
        signal: input.signal,
      })
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) {
        return {
          finalUrl: currentUrl,
          redirectCount,
          resource: grant.resource,
          response,
        }
      }
      if (redirectCount >= maxRedirects) {
        await discardRedirectBody(response)
        throw new Error('Captured resource redirect limit exceeded')
      }
      const nextUrl = normalizeHttpUrl(location, currentUrl)
      await discardRedirectBody(response)
      if (!nextUrl) throw new Error('Captured resource redirect target is invalid')

      currentUrl = nextUrl
      redirectCount += 1
      // A retained context is exact-URL scoped. A redirect target needs its own
      // independently captured resource/context; this request intentionally has none.
      headers = []
    }
  }
}

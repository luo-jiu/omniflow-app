import {
  parseHlsManifest,
  type CatCatchHlsVariableList,
} from '../cat-catch-port/hls/parser'
import { fetchHlsManifestWithForceCacheFallback } from '../cat-catch-port/hls/cache-fallback'
import {
  createEmbeddedBrowserHlsDownloadPlan,
  type EmbeddedBrowserHlsDownloadPlan,
} from '../../../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import type { CapturedResourceAccessService } from './captured-resource-access'

type HlsManifestAuthorityAccess = Pick<CapturedResourceAccessService, 'redeem'>
type HlsLiveParentVariableAccess = Pick<CapturedResourceAccessService, 'fetch' | 'redeem'>
type HlsCapturedMediaPlanAccess = Pick<CapturedResourceAccessService, 'fetch' | 'redeem'>

export type HlsManifestAuthority = {
  headers: Record<string, string>
  manifestUrl: string
  resourceId: string
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function redeemManifest(
  access: HlsManifestAuthorityAccess | null,
  tabId: string,
  resourceId: unknown,
): HlsManifestAuthority | null {
  const normalizedResourceId = normalizeIdentifier(resourceId)
  if (!access || !tabId || !normalizedResourceId) return null
  const grant = access.redeem({
    purpose: 'resource-download',
    resourceId: normalizedResourceId,
    tabId,
  })
  if (!grant) return null
  return {
    headers: Object.fromEntries(grant.headers),
    manifestUrl: grant.resource.url,
    resourceId: normalizedResourceId,
  }
}

async function fetchCapturedHlsManifest(
  access: HlsLiveParentVariableAccess,
  input: {
    resourceId: string
    signal?: AbortSignal
    tabId: string
  },
) {
  let latestResult = await access.fetch({
    purpose: 'resource-download',
    resourceId: input.resourceId,
    signal: input.signal,
    tabId: input.tabId,
  })
  if (latestResult.response.ok) return latestResult
  const initialResponse = latestResult.response
  const response = await fetchHlsManifestWithForceCacheFallback({
    fetch: async (_url, init) => {
      latestResult = await access.fetch({
        cache: init?.cache,
        purpose: 'resource-download',
        resourceId: input.resourceId,
        signal: input.signal,
        tabId: input.tabId,
      })
      return latestResult.response
    },
    initialResponse,
    signal: input.signal,
    url: latestResult.finalUrl,
  })
  return response === initialResponse ? { ...latestResult, response } : latestResult
}

export function resolveHlsManifestAuthority(
  access: HlsManifestAuthorityAccess | null,
  input: {
    resourceId?: unknown
    tabId?: unknown
  },
) {
  const tabId = normalizeIdentifier(input.tabId)
  return redeemManifest(access, tabId, input.resourceId)
}

export function resolveHlsTrackAuthorities(
  access: HlsManifestAuthorityAccess | null,
  input: {
    audioResourceId?: unknown
    tabId?: unknown
    videoResourceId?: unknown
  },
): {
  audio: HlsManifestAuthority
  video: HlsManifestAuthority
} | null {
  const tabId = normalizeIdentifier(input.tabId)
  const video = redeemManifest(access, tabId, input.videoResourceId)
  if (!video) return null
  const audio = redeemManifest(access, tabId, input.audioResourceId)
  return audio ? { audio, video } : null
}

async function resolveHlsParentVariableListForChildren(
  access: HlsLiveParentVariableAccess | null,
  input: {
    selectedManifestUrls: unknown[]
    signal?: AbortSignal
    sourceResourceId?: unknown
    tabId?: unknown
  },
): Promise<Readonly<CatCatchHlsVariableList> | undefined> {
  const tabId = normalizeIdentifier(input.tabId)
  const sourceResourceId = normalizeIdentifier(input.sourceResourceId)
  const selectedManifestUrls = input.selectedManifestUrls
    .map(normalizeHttpUrl)
    .filter(Boolean)
  if (!access || !tabId || !sourceResourceId || !selectedManifestUrls.length) return undefined

  const source = access.redeem({
    purpose: 'resource-download',
    resourceId: sourceResourceId,
    tabId,
  })
  if (!source) return undefined
  if (
    selectedManifestUrls.length === 1
    && normalizeHttpUrl(source.resource.url) === selectedManifestUrls[0]
  ) {
    return undefined
  }

  const result = await fetchCapturedHlsManifest(access, {
    resourceId: sourceResourceId,
    signal: input.signal,
    tabId,
  })
  if (!result.response.ok) {
    throw new Error(`captured HLS master 请求失败：HTTP ${result.response.status}`)
  }
  const text = await result.response.text()
  if (!text.includes('#EXTM3U')) {
    throw new Error('captured HLS master 返回内容不是 playlist')
  }
  const master = parseHlsManifest({
    baseUrl: result.finalUrl,
    text,
  })
  const childUrls = new Set([
    ...master.variants.map(variant => normalizeHttpUrl(variant.url)),
    ...master.renditions.map(rendition => normalizeHttpUrl(rendition.url)),
  ].filter(Boolean))
  if (!master.isMaster || selectedManifestUrls.some(url => !childUrls.has(url))) {
    throw new Error('所选 HLS playlist 不属于当前 captured master')
  }
  return master.variableList ? { ...master.variableList } : undefined
}

export async function resolveHlsTrackParentVariableList(
  access: HlsLiveParentVariableAccess | null,
  input: {
    audioManifestUrl?: unknown
    signal?: AbortSignal
    sourceResourceId?: unknown
    tabId?: unknown
    videoManifestUrl?: unknown
  },
) {
  return resolveHlsParentVariableListForChildren(access, {
    selectedManifestUrls: [input.videoManifestUrl, input.audioManifestUrl],
    signal: input.signal,
    sourceResourceId: input.sourceResourceId,
    tabId: input.tabId,
  })
}

export async function resolveHlsCapturedMediaPlan(
  access: HlsCapturedMediaPlanAccess | null,
  input: {
    parentVariableList?: Readonly<CatCatchHlsVariableList>
    resourceId?: unknown
    segmentQuery?: string
    signal?: AbortSignal
    tabId?: unknown
  },
): Promise<{
  authority: HlsManifestAuthority
  plan: EmbeddedBrowserHlsDownloadPlan
} | null> {
  const tabId = normalizeIdentifier(input.tabId)
  const authority = redeemManifest(access, tabId, input.resourceId)
  if (!access || !authority) return null
  const result = await fetchCapturedHlsManifest(access, {
    resourceId: authority.resourceId,
    signal: input.signal,
    tabId,
  })
  if (!result.response.ok) {
    throw new Error(`captured HLS media playlist 请求失败：HTTP ${result.response.status}`)
  }
  const text = await result.response.text()
  if (!text.includes('#EXTM3U')) {
    throw new Error('captured HLS media 返回内容不是 playlist')
  }
  const manifest = parseHlsManifest({
    baseUrl: result.finalUrl,
    parentVariableList: input.parentVariableList,
    text,
  })
  const plan = createEmbeddedBrowserHlsDownloadPlan({
    manifest,
    manifestUrl: result.finalUrl,
    segmentQuery: input.segmentQuery,
  })
  if (plan.isMaster) {
    throw new Error('所选 HLS track 仍然是 master playlist')
  }
  if (!plan.fragmentCount) {
    throw new Error('所选 HLS track 没有可下载分片')
  }
  return { authority, plan }
}

/**
 * Resolve master variables from the captured main-owned resource. The renderer
 * only selects a child URL; it never supplies variable values or request headers.
 */
export async function resolveHlsLiveParentVariableList(
  access: HlsLiveParentVariableAccess | null,
  input: {
    selectedManifestUrl?: unknown
    signal?: AbortSignal
    sourceResourceId?: unknown
    tabId?: unknown
  },
): Promise<Readonly<CatCatchHlsVariableList> | undefined> {
  try {
    return await resolveHlsParentVariableListForChildren(access, {
      selectedManifestUrls: [input.selectedManifestUrl],
      signal: input.signal,
      sourceResourceId: input.sourceResourceId,
      tabId: input.tabId,
    })
  } catch (error) {
    if (error instanceof Error && error.message === '所选 HLS playlist 不属于当前 captured master') {
      throw new Error('所选直播 playlist 不属于当前 captured master')
    }
    throw error
  }
}

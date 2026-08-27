import {
  parseHlsManifest,
  type CatCatchHlsVariableList,
} from '../cat-catch-port/hls/parser'
import type { CapturedResourceAccessService } from './captured-resource-access'

type HlsManifestAuthorityAccess = Pick<CapturedResourceAccessService, 'redeem'>
type HlsLiveParentVariableAccess = Pick<CapturedResourceAccessService, 'fetch' | 'redeem'>

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
  const tabId = normalizeIdentifier(input.tabId)
  const sourceResourceId = normalizeIdentifier(input.sourceResourceId)
  const selectedManifestUrl = normalizeHttpUrl(input.selectedManifestUrl)
  if (!access || !tabId || !sourceResourceId || !selectedManifestUrl) return undefined

  const source = access.redeem({
    purpose: 'resource-download',
    resourceId: sourceResourceId,
    tabId,
  })
  if (!source) return undefined
  if (normalizeHttpUrl(source.resource.url) === selectedManifestUrl) return undefined

  const result = await access.fetch({
    purpose: 'resource-download',
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
  const childUrls = [
    ...master.variants.map(variant => variant.url),
    ...master.renditions.map(rendition => rendition.url || ''),
  ]
  if (!master.isMaster || !childUrls.some(url => normalizeHttpUrl(url) === selectedManifestUrl)) {
    throw new Error('所选直播 playlist 不属于当前 captured master')
  }
  return master.variableList ? { ...master.variableList } : undefined
}

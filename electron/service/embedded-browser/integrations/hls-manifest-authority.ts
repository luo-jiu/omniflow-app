import type { CapturedResourceAccessService } from './captured-resource-access'

type HlsManifestAuthorityAccess = Pick<CapturedResourceAccessService, 'redeem'>

export type HlsManifestAuthority = {
  headers: Record<string, string>
  manifestUrl: string
  resourceId: string
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? '').trim()
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

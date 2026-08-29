type DashManifestAuthorityAccess = {
  redeem: (input: {
    purpose: 'resource-download'
    resourceId: string
    tabId: string
  }) => {
    headers: Array<[name: string, value: string]>
    resource: {
      url: string
    }
  } | null
}

export type DashManifestAuthority = {
  headers: Record<string, string>
  manifestUrl: string
  resourceId: string
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? '').trim()
}

/**
 * Resolve the exact captured MPD authority used by DASH live refreshes.
 *
 * A live task polls the same manifest repeatedly, so silently accepting a
 * renderer URL that differs from the redeemed resource would allow later
 * polls to fall through to an unscoped browser-session fetch. Exact matching
 * keeps the task bound to the captured resource for its whole lifetime.
 */
export function resolveDashManifestAuthority(
  access: DashManifestAuthorityAccess | null,
  input: {
    manifestUrl?: unknown
    resourceId?: unknown
    tabId?: unknown
  },
): DashManifestAuthority | null {
  const manifestUrl = normalizeIdentifier(input.manifestUrl)
  const resourceId = normalizeIdentifier(input.resourceId)
  const tabId = normalizeIdentifier(input.tabId)
  if (!access || !manifestUrl || !resourceId || !tabId) return null

  const grant = access.redeem({
    purpose: 'resource-download',
    resourceId,
    tabId,
  })
  if (!grant || grant.resource.url !== manifestUrl) return null
  return {
    headers: Object.fromEntries(grant.headers),
    manifestUrl: grant.resource.url,
    resourceId,
  }
}

import type { CapturedResourceAccessService } from './captured-resource-access'

export const EXTERNAL_TOOL_KEYS = ['aria2', 'command', 'protocol'] as const

export type ExternalToolKey = typeof EXTERNAL_TOOL_KEYS[number]

export type ExternalToolDispatchRequest = {
  resourceId: string
  tabId: string
  toolKey: ExternalToolKey
}

export type MainOwnedExternalToolPayload = {
  fileName?: string
  headers: Record<string, string>
  kind: string
  mimeType?: string
  pageUrl?: string
  referer?: string
  title?: string
  url: string
}

export type ExternalToolExecutionPort = (
  toolKey: ExternalToolKey,
  payload: MainOwnedExternalToolPayload,
) => Promise<void>

export type ExternalToolDispatcherOptions = {
  access: Pick<CapturedResourceAccessService, 'redeem'>
  execute: ExternalToolExecutionPort
}

const externalToolKeySet = new Set<string>(EXTERNAL_TOOL_KEYS)

function isExternalToolKey(value: string): value is ExternalToolKey {
  return externalToolKeySet.has(value)
}

function normalizeIdentifier(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function readHeader(headers: Record<string, string>, name: string) {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(headers).find(([headerName]) => (
    headerName.toLowerCase() === normalizedName
  ))
  return entry?.[1]
}

/**
 * Main-only bridge from an opaque renderer command to an external-tool executor.
 * URL, metadata, and protected header values are derived from Store/Vault state.
 */
export class ExternalToolDispatcher {
  private readonly options: ExternalToolDispatcherOptions

  constructor(options: ExternalToolDispatcherOptions) {
    this.options = options
  }

  async dispatch(input: ExternalToolDispatchRequest): Promise<void> {
    const resourceId = normalizeIdentifier(input?.resourceId)
    const tabId = normalizeIdentifier(input?.tabId)
    const toolKey = normalizeIdentifier(input?.toolKey)
    if (!resourceId || !tabId || !toolKey || !isExternalToolKey(toolKey)) {
      throw new Error('External tool request is invalid')
    }

    const grant = this.options.access.redeem({
      purpose: 'external-tool',
      resourceId,
      tabId,
    })
    if (!grant) {
      throw new Error('Captured resource access is unavailable or stale')
    }

    const headers = Object.fromEntries(grant.headers)
    const referer = readHeader(headers, 'referer')
    const pageUrl = referer || readHeader(headers, 'origin')
    await this.options.execute(toolKey, {
      fileName: grant.resource.name,
      headers,
      kind: grant.resource.kind,
      mimeType: grant.resource.mimeType,
      pageUrl,
      referer,
      title: grant.resource.name,
      url: grant.resource.url,
    })
  }
}

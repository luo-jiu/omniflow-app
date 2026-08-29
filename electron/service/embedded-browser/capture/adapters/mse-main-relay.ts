export type AuthorizedMseControlPayload = {
  base64?: string
  event: 'mse-complete' | 'mse-flush' | 'mse-reset' | 'mse-save'
  fileName?: string
  mimeType?: string
  resourceKey: string
  streamType?: 'audio' | 'video'
  trimBeforeHeader?: boolean
}

type AuthorizeMseControlPayloadInput = {
  payload: Record<string, unknown>
  resolveResourceKey: (tabId: string, resourceKey: string) => string | null
  tabId: string
}

const MAX_BASE64_LENGTH = 90 * 1024 * 1024

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

/**
 * Validates the second half of the MSE relay boundary. The page-probe adapter
 * already checks document token/incarnation/navigation; this helper additionally
 * binds a control payload to a resource owned by the current tab.
 */
export function authorizeMseControlPayload(
  input: AuthorizeMseControlPayloadInput,
): AuthorizedMseControlPayload | null {
  const event = input.payload.event
  if (event !== 'mse-complete' && event !== 'mse-flush' && event !== 'mse-reset' && event !== 'mse-save') return null
  const tabId = normalizeString(input.tabId)
  const resourceKey = normalizeString(input.payload.resourceKey)
  if (
    !tabId
    || !resourceKey.startsWith('mse-stream:')
    || input.resolveResourceKey(tabId, resourceKey) !== resourceKey
  ) return null

  const streamType = input.payload.streamType === 'audio' || input.payload.streamType === 'video'
    ? input.payload.streamType
    : undefined
  if (event === 'mse-complete' || event === 'mse-reset' || event === 'mse-save') {
    return { event, resourceKey, streamType }
  }

  const base64 = normalizeString(input.payload.base64)
  if (
    !base64
    || base64.length > MAX_BASE64_LENGTH
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) return null
  return {
    base64,
    event,
    fileName: typeof input.payload.fileName === 'string'
      ? input.payload.fileName
      : undefined,
    mimeType: typeof input.payload.mimeType === 'string'
      ? input.payload.mimeType
      : undefined,
    resourceKey,
    streamType,
    trimBeforeHeader: input.payload.trimBeforeHeader === true,
  }
}

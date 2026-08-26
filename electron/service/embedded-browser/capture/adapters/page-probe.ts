import { classifyOmniFlowProbeResourceKind } from '../policy/omniflow-capture-policy'
import {
  type ResourceStateChange,
  type ResourceStateStore,
  type ResourceWriteResult,
  type TabCaptureBinding,
} from '../state/resource-state-store'

const MAX_RESOURCE_KEY_LENGTH = 1_024
const MAX_RESOURCE_URL_LENGTH = 64 * 1_024

export type PageProbeCaptureAdapterOptions = {
  binding: TabCaptureBinding
  emitChange: (change: ResourceStateChange) => void
  now?: () => number
  store: ResourceStateStore
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readBoundedString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

function readNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function rejectInvalid(): ResourceWriteResult {
  return { change: null, decision: 'invalid', resource: null }
}

/**
 * Main ingress for page-probe discovery events. The binding belongs to the
 * document that installed the probe, while tab ids and timestamps never come
 * from the page payload.
 */
export class PageProbeCaptureAdapter {
  private readonly binding: TabCaptureBinding
  private readonly emitChange: (change: ResourceStateChange) => void
  private readonly now: () => number
  private readonly store: ResourceStateStore

  constructor(options: PageProbeCaptureAdapterOptions) {
    this.binding = { ...options.binding }
    this.emitChange = options.emitChange
    this.now = options.now || Date.now
    this.store = options.store
  }

  capture(payload: unknown): ResourceWriteResult {
    if (!isRecord(payload)) return rejectInvalid()
    const resourceKey = readBoundedString(payload.resourceKey, MAX_RESOURCE_KEY_LENGTH)
    const url = readBoundedString(payload.url, MAX_RESOURCE_URL_LENGTH)
    if (!resourceKey || !url || /^javascript:/i.test(url)) return rejectInvalid()

    const ext = readBoundedString(payload.ext, 32)?.replace(/^\./, '').toLowerCase()
    const mimeType = readBoundedString(payload.mimeType, 256)?.toLowerCase()
    const resourceType = readBoundedString(payload.resourceType, 128)?.toLowerCase()
    const streamType = payload.streamType === 'audio' || payload.streamType === 'video'
      ? payload.streamType
      : undefined
    const result = this.store.upsertProbeResource({
      binding: this.binding,
      metadata: {
        capturedAt: this.now(),
        contentLength: readNonNegativeNumber(payload.contentLength),
        ext,
        kind: classifyOmniFlowProbeResourceKind({
          declaredKind: typeof payload.kind === 'string' ? payload.kind : undefined,
          extension: ext,
          mimeType,
          resourceType,
          url,
        }),
        mimeType,
        resourceKey,
        resourceType,
        streamType,
        url,
      },
    })
    if (result.change) this.emitChange(result.change)
    return result
  }
}

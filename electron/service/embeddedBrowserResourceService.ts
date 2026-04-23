import {
  classifyCapturedResource,
  inferStreamType,
  normalizeMimeType,
  shouldCaptureResource,
} from './embeddedBrowserResourceClassifier'
import {
  evaluateEmbeddedBrowserResourceCapture,
} from './embeddedBrowserResourceCaptureRules'
export { initializeEmbeddedBrowserResourceBridge } from './embeddedBrowserResourceBridge'
export {
  clearEmbeddedBrowserCapturedResources,
  disposeEmbeddedBrowserCapturedResources,
  getEmbeddedBrowserResourceCaptureSnapshot,
  isEmbeddedBrowserDeepCaptureEnabled,
  startEmbeddedBrowserDeepResourceCapture,
  startEmbeddedBrowserResourceCapture,
  stopEmbeddedBrowserResourceCapture,
} from './embeddedBrowserResourceStateStore'
import { getEmbeddedBrowserTabCaptureState, updateEmbeddedBrowserCapturedResource } from './embeddedBrowserResourceStateStore'
export type {
  EmbeddedBrowserCapturedRequestHeaders,
  EmbeddedBrowserCapturedResource,
  EmbeddedBrowserCapturedResourceKind,
  EmbeddedBrowserCapturedResourceSource,
  EmbeddedBrowserCapturedStreamType,
  EmbeddedBrowserResourceCaptureSnapshot,
} from './embeddedBrowserResourceTypes'
import type {
  EmbeddedBrowserCapturedResource,
  EmbeddedBrowserCapturedResourceSource,
} from './embeddedBrowserResourceTypes'

export function recordEmbeddedBrowserProbeResource(
  tabId: string,
  payload: Partial<Omit<EmbeddedBrowserCapturedResource, 'id' | 'tabId' | 'source'>> & {
    source?: EmbeddedBrowserCapturedResourceSource
    url?: string
  },
) {
  const state = getEmbeddedBrowserTabCaptureState(tabId)
  if (!state?.enabled || !state.deepCaptureEnabled) {
    return null
  }
  const url = String(payload.url || '').trim()
  if (!url) {
    return null
  }
  const captureEvaluation = evaluateEmbeddedBrowserResourceCapture({
    ext: payload.ext,
    mimeType: payload.mimeType,
    pageUrl: payload.pageUrl,
    resourceType: payload.resourceType,
    url,
  })
  if (!captureEvaluation) {
    return null
  }
  const resolvedUrl = captureEvaluation.url
  const kind = payload.kind || classifyCapturedResource({
    extHint: captureEvaluation.extHint,
    mimeType: payload.mimeType,
    resourceType: payload.resourceType,
    url: resolvedUrl,
  })
  if (!captureEvaluation.matchedByRuleSet && !shouldCaptureResource({ kind, resourceType: payload.resourceType, url: resolvedUrl })) {
    return null
  }
  return updateEmbeddedBrowserCapturedResource(tabId, {
    capturedAt: Number(payload.capturedAt) || Date.now(),
    contentLength: payload.contentLength,
    ext: captureEvaluation.extHint || payload.ext,
    kind,
    method: payload.method,
    mimeType: normalizeMimeType(payload.mimeType),
    pageUrl: payload.pageUrl,
    resourceType: payload.resourceType,
    resourceKey: payload.resourceKey,
    source: payload.source || 'probe',
    statusCode: payload.statusCode,
    streamType: inferStreamType({
      mimeType: payload.mimeType,
      resourceType: payload.resourceType,
      streamType: payload.streamType,
      url: resolvedUrl,
    }),
    url: resolvedUrl,
  })
}

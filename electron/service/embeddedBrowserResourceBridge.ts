import { webContents, type Session } from 'electron'
import {
  classifyCapturedResource,
  getHeaderValue,
  getResourceExtension,
  inferStreamType,
  normalizeMimeType,
  parseContentLength,
  parseContentRangeTotal,
  pickRelevantRequestHeaders,
  shouldCaptureResource,
} from './embeddedBrowserResourceClassifier'
import {
  getEmbeddedBrowserTabCaptureState,
  setEmbeddedBrowserCapturedResourceEmitter,
  updateEmbeddedBrowserCapturedResource,
} from './embeddedBrowserResourceStateStore'
import type {
  EmbeddedBrowserCapturedRequestHeaders,
  EmbeddedBrowserCapturedResource,
} from './embeddedBrowserResourceTypes'

const requestContextsByRequestId = new Map<number, {
  referer?: string
  requestHeaders?: EmbeddedBrowserCapturedRequestHeaders
}>()
let embeddedBrowserResourceBridgeInitialized = false

export function initializeEmbeddedBrowserResourceBridge(options: {
  browserSession: Session
  emitResource: (payload: EmbeddedBrowserCapturedResource) => void
  resolveTabIdByWebContentsId: (webContentsId: number) => string | null
}) {
  if (embeddedBrowserResourceBridgeInitialized) {
    return
  }
  embeddedBrowserResourceBridgeInitialized = true
  setEmbeddedBrowserCapturedResourceEmitter(options.emitResource)

  options.browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    requestContextsByRequestId.set(details.id, {
      referer: details.referrer || undefined,
      requestHeaders: pickRelevantRequestHeaders(details.requestHeaders),
    })
    callback({ cancel: false, requestHeaders: details.requestHeaders })
  })

  options.browserSession.webRequest.onCompleted((details) => {
    if (!details.webContentsId) {
      requestContextsByRequestId.delete(details.id)
      return
    }
    const tabId = options.resolveTabIdByWebContentsId(details.webContentsId)
    const state = tabId ? getEmbeddedBrowserTabCaptureState(tabId) : null
    if (!tabId || !state?.enabled) {
      requestContextsByRequestId.delete(details.id)
      return
    }
    if (details.statusCode < 200 || details.statusCode >= 400) {
      requestContextsByRequestId.delete(details.id)
      return
    }

    const targetWebContents = webContents.fromId(details.webContentsId)
    const url = String(details.url || '').trim()
    const requestContext = requestContextsByRequestId.get(details.id)
    const mimeType = normalizeMimeType(getHeaderValue(details.responseHeaders, 'content-type'))
    const kind = classifyCapturedResource({
      mimeType,
      resourceType: details.resourceType,
      url,
    })
    if (!shouldCaptureResource({ kind, resourceType: details.resourceType, url })) {
      requestContextsByRequestId.delete(details.id)
      return
    }

    updateEmbeddedBrowserCapturedResource(tabId, {
      capturedAt: Date.now(),
      contentLength:
        parseContentRangeTotal(getHeaderValue(details.responseHeaders, 'content-range'))
        || parseContentLength(getHeaderValue(details.responseHeaders, 'content-length')),
      ext: getResourceExtension(url) || undefined,
      kind,
      method: details.method || undefined,
      mimeType,
      pageUrl: targetWebContents?.getURL() || undefined,
      referer: requestContext?.referer || details.referrer || undefined,
      requestHeaders: requestContext?.requestHeaders,
      resourceType: details.resourceType || undefined,
      source: 'network',
      statusCode: details.statusCode || undefined,
      streamType: inferStreamType({
        mimeType,
        resourceType: details.resourceType,
        url,
      }),
      url,
    })
    requestContextsByRequestId.delete(details.id)
  })

  options.browserSession.webRequest.onErrorOccurred((details) => {
    requestContextsByRequestId.delete(details.id)
  })
}

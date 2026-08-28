type PageGeneratedResourcePayload = {
  base64: string
  ext: 'key' | 'm3u8' | 'mpd'
  kind: 'key' | 'manifest'
  mimeType: string
  resourceType: string
  signature: string
  streamType?: 'audio' | 'video'
}

type PageGeneratedResource = {
  base64: string
  blobUrl: string
  contentLength: number
  fileName: string
  mimeType: string
  resourceKey: string
  streamType?: 'audio' | 'video'
}

type PageGeneratedResourceHostProbe = {
  exportResource?: (resourceKey: string) => boolean
  openResource?: (resourceKey: string) => boolean
  readResource?: (resourceKey: string) => Promise<null | {
    base64: string
    fileName: string
    mimeType?: string
    resourceKey: string
    streamType?: 'audio' | 'video'
  }>
}

type PageGeneratedResourceScope = {
  Blob: typeof Blob
  TextEncoder: typeof TextEncoder
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  atob: typeof atob
  btoa: typeof btoa
  location?: { hostname?: string }
  open?: typeof open
}

export type PageGeneratedResourceStore = {
  dispose: () => void
  emitGeneratedResource: (payload: PageGeneratedResourcePayload) => void
  isDisposed: () => boolean
  materializeGeneratedResource: (payload: PageGeneratedResourcePayload) => {
    contentLength: number
    fileName: string
    resourceKey: string
    url: string
  }
  textToBase64: (text: string) => string
}

export type InstallPageGeneratedResourceStoreInput = {
  document?: Pick<Document, 'createElement' | 'title'>
  emitCapture: (payload: {
    contentLength: number
    ext: PageGeneratedResourcePayload['ext']
    kind: PageGeneratedResourcePayload['kind']
    mimeType: string
    resourceKey: string
    resourceType: string
    source: 'probe'
    streamType?: 'audio' | 'video'
    url: string
  }) => void
  hostProbe: PageGeneratedResourceHostProbe
  scope: PageGeneratedResourceScope & Record<string, unknown>
}

/**
 * Page-owned byte store for target deep-search generated manifests and keys.
 * Main still authorizes access through the existing tab/document resource ID.
 */
export function installPageGeneratedResourceStore(
  input: InstallPageGeneratedResourceStoreInput,
): PageGeneratedResourceStore {
  const adapterSentinel = '__OMNIFLOW_PAGE_GENERATED_RESOURCE_STORE_V1__'
  const current = input.scope[adapterSentinel] as PageGeneratedResourceStore | undefined
  if (current && !current.isDisposed()) return current

  const resources = new Map<string, PageGeneratedResource>()
  const resourceKeysBySignature = new Map<string, string>()
  const previousExportResource = input.hostProbe.exportResource
  const previousOpenResource = input.hostProbe.openResource
  const previousReadResource = input.hostProbe.readResource
  let disposed = false
  let resourceSequence = 0

  const decodeBase64 = (base64: string) => {
    const binary = input.scope.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  }
  const textToBase64 = (text: string) => {
    const bytes = new input.scope.TextEncoder().encode(String(text || ''))
    let binary = ''
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index] || 0)
    }
    return input.scope.btoa(binary)
  }
  const sanitizeFileName = (value: string) => {
    const safeName = String(value || '').replace(/[\\/:*?"<>|]+/g, '_').trim()
    return safeName || 'resource'
  }
  const createFileName = (payload: PageGeneratedResourcePayload) => {
    const title = String(input.document?.title || '').trim()
    const hostname = String(input.scope.location?.hostname || '').trim()
    const stem = payload.kind === 'key'
      ? `${title || hostname || 'resource'}-key`
      : title || hostname || 'resource'
    return `${sanitizeFileName(stem)}.${payload.ext}`
  }
  const materializeGeneratedResource = (payload: PageGeneratedResourcePayload) => {
    const existingKey = resourceKeysBySignature.get(payload.signature)
    const existing = existingKey ? resources.get(existingKey) : undefined
    if (existing) {
      return {
        contentLength: existing.contentLength,
        fileName: existing.fileName,
        resourceKey: existing.resourceKey,
        url: existing.blobUrl,
      }
    }

    const blob = new input.scope.Blob([decodeBase64(payload.base64)], {
      type: payload.mimeType,
    })
    const resourceKey = `probe-resource:${Date.now()}-${++resourceSequence}`
    const resource: PageGeneratedResource = {
      base64: payload.base64,
      blobUrl: input.scope.URL.createObjectURL(blob),
      contentLength: blob.size,
      fileName: createFileName(payload),
      mimeType: payload.mimeType,
      resourceKey,
      streamType: payload.streamType,
    }
    resourceKeysBySignature.set(payload.signature, resourceKey)
    resources.set(resourceKey, resource)
    return {
      contentLength: resource.contentLength,
      fileName: resource.fileName,
      resourceKey,
      url: resource.blobUrl,
    }
  }
  const emitGeneratedResource = (payload: PageGeneratedResourcePayload) => {
    const resource = materializeGeneratedResource(payload)
    input.emitCapture({
      contentLength: resource.contentLength,
      ext: payload.ext,
      kind: payload.kind,
      mimeType: payload.mimeType,
      resourceKey: resource.resourceKey,
      resourceType: payload.resourceType,
      source: 'probe',
      streamType: payload.streamType,
      url: resource.url,
    })
  }
  const exportResource = (resourceKey: string) => {
    const resource = resources.get(String(resourceKey || ''))
    if (!resource) return previousExportResource?.(resourceKey) === true
    if (!input.document) return false
    const anchor = input.document.createElement('a')
    anchor.href = resource.blobUrl
    anchor.download = resource.fileName
    anchor.click()
    anchor.remove()
    return true
  }
  const openResource = (resourceKey: string) => {
    const resource = resources.get(String(resourceKey || ''))
    if (!resource) return previousOpenResource?.(resourceKey) === true
    if (typeof input.scope.open !== 'function') return false
    input.scope.open(resource.blobUrl, '_blank', 'noopener,noreferrer')
    return true
  }
  const readResource = (resourceKey: string) => {
    const resource = resources.get(String(resourceKey || ''))
    if (!resource) return previousReadResource?.(resourceKey) || Promise.resolve(null)
    return Promise.resolve({
      base64: resource.base64,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      resourceKey: resource.resourceKey,
      streamType: resource.streamType,
    })
  }

  input.hostProbe.exportResource = exportResource
  input.hostProbe.openResource = openResource
  input.hostProbe.readResource = readResource

  const store: PageGeneratedResourceStore = {
    dispose() {
      if (disposed) return
      disposed = true
      for (const resource of resources.values()) {
        input.scope.URL.revokeObjectURL(resource.blobUrl)
      }
      resources.clear()
      resourceKeysBySignature.clear()
      if (input.hostProbe.exportResource === exportResource) {
        input.hostProbe.exportResource = previousExportResource
      }
      if (input.hostProbe.openResource === openResource) {
        input.hostProbe.openResource = previousOpenResource
      }
      if (input.hostProbe.readResource === readResource) {
        input.hostProbe.readResource = previousReadResource
      }
      if (input.scope[adapterSentinel] === store) delete input.scope[adapterSentinel]
    },
    emitGeneratedResource,
    isDisposed: () => disposed,
    materializeGeneratedResource,
    textToBase64,
  }
  Object.defineProperty(input.scope, adapterSentinel, {
    configurable: true,
    value: store,
  })
  return store
}

export function createPageGeneratedResourceStoreBodySource() {
  return [
    `const installPageGeneratedResourceStore = (${installPageGeneratedResourceStore.toString()});`,
    'const pageGeneratedResourceStore = installPageGeneratedResourceStore({',
    "  document: typeof document === 'undefined' ? undefined : document,",
    '  emitCapture: emit,',
    '  hostProbe: globalScope.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__,',
    '  scope: globalScope,',
    '});',
  ].join('\n')
}

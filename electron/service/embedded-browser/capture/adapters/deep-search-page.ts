import {
  createDeepSearchDiscoverySessionSource,
  type DeepSearchDiscovery,
  type DeepSearchDiscoveryOptions,
  type DeepSearchDiscoverySession,
} from '../../cat-catch-port/deep-search/discovery'
import {
  createDeepSearchPageDiscoverySource,
  type DeepSearchPageDiscovery,
} from '../../cat-catch-port/deep-search/page-discovery'
import {
  createDeepSearchRuntimeInstallerSource,
  type DeepSearchRuntime,
  type DeepSearchRuntimeObservation,
  type DeepSearchRuntimeScope,
  type InstallDeepSearchRuntimeInput,
} from '../../cat-catch-port/deep-search/runtime'

type DeepSearchCapturePayload = {
  ext?: string
  kind?: 'key' | 'manifest' | 'media'
  resourceType: string
  source: 'probe'
  url: string
}

type DeepSearchGeneratedResourcePayload = {
  base64: string
  ext: 'key' | 'm3u8' | 'mpd'
  kind: 'key' | 'manifest'
  mimeType: string
  resourceType: string
  signature: string
}

type DeepSearchMaterializedResource = {
  url: string
}

type DeepSearchPageDocument = {
  addEventListener: (type: string, listener: () => void, options?: unknown) => void
  querySelectorAll: (selector: string) => Iterable<{ textContent?: string | null }>
  readyState: string
  removeEventListener?: (type: string, listener: () => void) => void
}

export type DeepSearchPageAdapter = {
  dispose: () => void
  isDisposed: () => boolean
  scanInlineScripts: () => void
  workerBootstrapSource: string
}

export type InstallDeepSearchPageAdapterInput = {
  consumeWorkerMessage?: (value: unknown) => boolean
  createDiscoverySession: (options: DeepSearchDiscoveryOptions) => DeepSearchDiscoverySession
  createPageDiscovery: () => DeepSearchPageDiscovery
  document?: DeepSearchPageDocument
  emitCapture: (payload: DeepSearchCapturePayload) => void
  emitGeneratedResource: (payload: DeepSearchGeneratedResourcePayload) => void
  installRuntime: (input: InstallDeepSearchRuntimeInput) => DeepSearchRuntime
  materializeGeneratedResource: (
    payload: DeepSearchGeneratedResourcePayload,
  ) => DeepSearchMaterializedResource
  scope: DeepSearchRuntimeScope
  textToBase64: (text: string) => string
  workerRelayKey: string
}

/**
 * Thin page adapter for the target Cat Catch deep runtime. It preserves the
 * upstream entry-point order while projecting discoveries through OmniFlow's
 * existing generated-resource and secure console relay owners.
 */
export function installDeepSearchPageAdapter(
  input: InstallDeepSearchPageAdapterInput,
): DeepSearchPageAdapter {
  const adapterSentinel = '__OMNIFLOW_DEEP_SEARCH_PAGE_ADAPTER_V1__'
  const workerObservationType = 'deep-search-observation'
  const scopeRecord = input.scope as unknown as Record<string, unknown>
  const current = scopeRecord[adapterSentinel] as DeepSearchPageAdapter | undefined
  if (current && !current.isDisposed()) return current

  const discoverySession = input.createDiscoverySession({
    pageUrl: input.scope.location.href,
  })
  const pageDiscovery = input.createPageDiscovery()
  const emittedVimeoUrls = new Set<string>()
  let disposed = false
  let inlineScanTimer: ReturnType<typeof setTimeout> | undefined

  const emitGenerated = (
    discovery: Extract<DeepSearchDiscovery, { kind: 'inline' | 'key' }>,
    resourceType: string,
  ) => {
    if (discovery.kind === 'key') {
      input.emitGeneratedResource({
        base64: discovery.base64,
        ext: 'key',
        kind: 'key',
        mimeType: 'application/octet-stream',
        resourceType,
        signature: `key:${discovery.base64}`,
      })
      return
    }
    input.emitGeneratedResource({
      base64: input.textToBase64(discovery.text),
      ext: discovery.ext,
      kind: 'manifest',
      mimeType: discovery.ext === 'mpd'
        ? 'application/dash+xml'
        : 'application/vnd.apple.mpegurl',
      resourceType,
      signature: `${discovery.ext}:${discovery.text}`,
    })
  }

  const emitDiscoveries = (
    discoveries: DeepSearchDiscovery[],
    resourceType: string,
  ) => {
    for (const discovery of discoveries) {
      if (discovery.kind !== 'media') {
        emitGenerated(discovery, resourceType)
        continue
      }
      input.emitCapture({
        ext: discovery.ext,
        kind: discovery.ext === 'm3u8' || discovery.ext === 'mpd'
          ? 'manifest'
          : discovery.ext === 'key'
            ? 'key'
            : 'media',
        resourceType,
        source: 'probe',
        url: discovery.url,
      })
    }
  }

  const discoverObject = (value: unknown, resourceType: string) => {
    emitDiscoveries(discoverySession.discover(value), resourceType)
  }

  const discoverNetworkManifest = (
    value: string,
    observation: DeepSearchRuntimeObservation,
  ) => {
    const requestSession = input.createDiscoverySession({ pageUrl: observation.pageUrl })
    emitDiscoveries(requestSession.discover({ value }), `deep-${observation.source}`)
    input.emitCapture({
      ext: 'm3u8',
      kind: 'manifest',
      resourceType: `deep-${observation.source}`,
      source: 'probe',
      url: observation.pageUrl,
    })
  }

  const discoverKeyString = (value: string, resourceType: string) => {
    let bytes: number[] | undefined
    if (value.length === 24 && value.endsWith('==') && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      try {
        const binary = input.scope.atob(value)
        bytes = Array.from(binary, character => character.charCodeAt(0))
      } catch {
        bytes = undefined
      }
    } else if (/^[A-Fa-f0-9]{32}$/.test(value)) {
      bytes = []
      for (let index = 0; index < value.length; index += 2) {
        bytes.push(Number.parseInt(value.slice(index, index + 2), 16))
      }
    }
    if (bytes) discoverObject(bytes, resourceType)
  }

  const emitVimeoManifest = (
    value: unknown,
    observation: DeepSearchRuntimeObservation,
  ) => {
    if (observation.source !== 'xhr' || emittedVimeoUrls.has(observation.pageUrl)) return false
    const master = pageDiscovery.buildVimeoHlsManifest(
      observation.pageUrl,
      value,
      text => input.materializeGeneratedResource({
        base64: input.textToBase64(text),
        ext: 'm3u8',
        kind: 'manifest',
        mimeType: 'application/vnd.apple.mpegurl',
        resourceType: 'deep-vimeo-track',
        signature: `vimeo-stream:${text}`,
      }).url,
    )
    if (master === undefined) return false
    emittedVimeoUrls.add(observation.pageUrl)
    input.emitGeneratedResource({
      base64: input.textToBase64(master),
      ext: 'm3u8',
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      resourceType: 'deep-vimeo-master',
      signature: `vimeo-master:${master}`,
    })
    return true
  }

  const parseMaybeJson = (value: string) => {
    try {
      return input.scope.JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const inspectFetchString = (
    value: string,
    observation: DeepSearchRuntimeObservation,
  ) => {
    const resourceType = 'deep-fetch'
    const parsed = parseMaybeJson(value)
    if (parsed) {
      discoverObject(parsed, resourceType)
      return
    }
    if (value.substring(0, 7).toUpperCase() === '#EXTM3U') {
      if (observation.method === 'GET') {
        discoverNetworkManifest(value, observation)
      } else {
        discoverObject({ value }, resourceType)
      }
      return
    }
    if (/^data:(application|video|audio)\//i.test(value.substring(0, 17))) {
      discoverObject({ value }, resourceType)
    }
  }

  const inspectXhrString = (
    value: string,
    observation: DeepSearchRuntimeObservation,
  ) => {
    const resourceType = 'deep-xhr'
    if (/^data:(application|video|audio)\//i.test(value)) {
      discoverObject({ value }, resourceType)
      return
    }
    if (/^data:(application|video|audio)\//i.test(observation.pageUrl)) {
      discoverObject({ value: observation.pageUrl }, resourceType)
      return
    }
    if (
      value.startsWith('http://')
      || value.startsWith('https://')
      || value.startsWith('//')
    ) {
      discoverObject({ value }, resourceType)
      return
    }
    const uppercaseValue = value.toUpperCase()
    if (uppercaseValue.includes('#EXTM3U')) {
      if (uppercaseValue.substring(0, 7) === '#EXTM3U') {
        if (observation.method === 'GET') {
          discoverNetworkManifest(value, observation)
        } else {
          discoverObject({ value }, resourceType)
        }
        return
      }
      const embeddedManifestJson = parseMaybeJson(value)
      if (embeddedManifestJson) {
        if (observation.method === 'GET') {
          input.emitCapture({
            ext: 'json',
            resourceType,
            source: 'probe',
            url: observation.pageUrl,
          })
        } else {
          discoverObject(embeddedManifestJson, resourceType)
        }
        return
      }
    }
    const parsed = parseMaybeJson(value)
    if (parsed) discoverObject(parsed, resourceType)
  }

  const inspect = (value: unknown, observation: DeepSearchRuntimeObservation) => {
    if (disposed) return
    emitVimeoManifest(value, observation)
    const resourceType = `deep-${observation.source}`
    if (observation.source === 'xhr-url' && typeof value === 'string') {
      emitDiscoveries(discoverySession.discover({}, { pageUrl: value }), resourceType)
      return
    }
    if (typeof value !== 'string') {
      discoverObject(value, resourceType)
      return
    }
    if (observation.source === 'key-hook') {
      discoverKeyString(value, resourceType)
      return
    }
    if (observation.source === 'json') {
      discoverObject(value, resourceType)
      return
    }
    if (
      observation.source === 'text-decoder'
      && value.toUpperCase().includes('#EXTM3U')
    ) {
      emitGenerated({ ext: 'm3u8', kind: 'inline', text: value }, resourceType)
      return
    }

    if (observation.source === 'fetch') {
      inspectFetchString(value, observation)
      return
    }
    if (observation.source === 'xhr') {
      inspectXhrString(value, observation)
      return
    }

    discoverObject({ value }, resourceType)
  }

  function installDeepSearchWorkerBootstrap(workerInput: {
    installRuntime: InstallDeepSearchPageAdapterInput['installRuntime']
    relayKey: string
  }) {
    const workerObservationType = 'deep-search-observation'
    const createBootstrapSource = () => `;(${installDeepSearchWorkerBootstrap.toString()})({installRuntime:${workerInput.installRuntime.toString()},relayKey:${JSON.stringify(workerInput.relayKey)}});`
    const relayObservation = (value: unknown, observation: DeepSearchRuntimeObservation) => {
      try {
        globalThis.postMessage({
          [workerInput.relayKey]: {
            observation,
            type: workerObservationType,
            value,
          },
        })
      } catch {
        // Uncloneable observations must not alter the worker's behavior.
      }
    }
    const consumeNestedWorkerMessage = (value: unknown) => {
      if (!value || typeof value !== 'object') return false
      const envelope = (value as Record<string, unknown>)[workerInput.relayKey]
      if (!envelope || typeof envelope !== 'object') return false
      const type = (envelope as Record<string, unknown>).type
      if (type !== workerObservationType) return false
      try {
        globalThis.postMessage(value)
        return true
      } catch {
        return false
      }
    }
    workerInput.installRuntime({
      consumeWorkerMessage: consumeNestedWorkerMessage,
      inspect: relayObservation,
      scope: globalThis as unknown as DeepSearchRuntimeScope,
      workerBootstrapSource: createBootstrapSource(),
    })
  }

  const workerBootstrapSource = `;(${installDeepSearchWorkerBootstrap.toString()})({installRuntime:${input.installRuntime.toString()},relayKey:${JSON.stringify(input.workerRelayKey)}});`
  const consumeWorkerMessage = (value: unknown) => {
    if (value && typeof value === 'object') {
      const envelope = (value as Record<string, unknown>)[input.workerRelayKey]
      if (envelope && typeof envelope === 'object') {
        const workerEnvelope = envelope as Record<string, unknown>
        if (workerEnvelope.type === workerObservationType) {
          const observation = workerEnvelope.observation
          if (observation && typeof observation === 'object') {
            inspect(workerEnvelope.value, observation as DeepSearchRuntimeObservation)
          }
          return true
        }
      }
    }
    return input.consumeWorkerMessage?.(value) === true
  }
  const runtime = input.installRuntime({
    consumeWorkerMessage,
    inspect,
    scope: input.scope,
    workerBootstrapSource,
  })

  const scanInlineScripts = () => {
    if (disposed || !input.document) return
    const scriptTexts = Array.from(
      input.document.querySelectorAll('script:not([src])'),
      script => String(script.textContent || ''),
    )
    const candidates = pageDiscovery.extractInlineScriptMediaCandidates(
      scriptTexts,
      input.scope.location.protocol,
    )
    for (const url of candidates) {
      input.emitCapture({
        ext: 'm3u8',
        resourceType: 'deep-inline-script',
        source: 'probe',
        url,
      })
    }
  }
  if (input.document?.readyState === 'loading') {
    input.document.addEventListener('DOMContentLoaded', scanInlineScripts, { once: true })
  } else if (input.document) {
    inlineScanTimer = input.scope.setTimeout(scanInlineScripts, 0)
  }

  const adapter: DeepSearchPageAdapter = {
    dispose() {
      if (disposed) return
      disposed = true
      if (inlineScanTimer !== undefined) {
        input.scope.clearTimeout(inlineScanTimer)
        inlineScanTimer = undefined
      }
      input.document?.removeEventListener?.('DOMContentLoaded', scanInlineScripts)
      runtime.dispose()
      if (scopeRecord[adapterSentinel] === adapter) delete scopeRecord[adapterSentinel]
    },
    isDisposed: () => disposed,
    scanInlineScripts,
    workerBootstrapSource,
  }
  Object.defineProperty(scopeRecord, adapterSentinel, {
    configurable: true,
    value: adapter,
  })
  return adapter
}

export function createDeepSearchPageAdapterInstallerSource() {
  return `(${installDeepSearchPageAdapter.toString()})`
}

/**
 * Generated body for the existing probe IIFE. The body is intentionally not
 * part of the production template until deep-search-runtime cuts over.
 */
export function createDeepSearchPageAdapterBodySource(input?: {
  usePageGeneratedResourceStore?: boolean
}) {
  const emitGeneratedResourceSource = input?.usePageGeneratedResourceStore
    ? 'pageGeneratedResourceStore.emitGeneratedResource'
    : 'emitGeneratedResource'
  const materializeGeneratedResourceSource = input?.usePageGeneratedResourceStore
    ? 'pageGeneratedResourceStore.materializeGeneratedResource'
    : 'createProbeBlobResource'
  const textToBase64Source = input?.usePageGeneratedResourceStore
    ? 'pageGeneratedResourceStore.textToBase64'
    : 'textToBase64'
  return [
    `const installDeepSearchPageAdapter = ${createDeepSearchPageAdapterInstallerSource()};`,
    `const createDeepSearchDiscoverySession = ${createDeepSearchDiscoverySessionSource()};`,
    `const createDeepSearchPageDiscovery = ${createDeepSearchPageDiscoverySource()};`,
    `const installDeepSearchRuntime = ${createDeepSearchRuntimeInstallerSource()};`,
    'installDeepSearchPageAdapter({',
    '  consumeWorkerMessage: consumeWorkerRelayMessage,',
    '  createDiscoverySession: createDeepSearchDiscoverySession,',
    '  createPageDiscovery: createDeepSearchPageDiscovery,',
    "  document: typeof document === 'undefined' ? undefined : document,",
    '  emitCapture: emit,',
    `  emitGeneratedResource: ${emitGeneratedResourceSource},`,
    '  installRuntime: installDeepSearchRuntime,',
    `  materializeGeneratedResource: ${materializeGeneratedResourceSource},`,
    '  scope: globalScope,',
    `  textToBase64: ${textToBase64Source},`,
    '  workerRelayKey,',
    '});',
  ].join('\n')
}

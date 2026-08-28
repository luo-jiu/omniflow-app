/**
 * Ported from xifangczy/cat-catch@2cb981d7c2f4614732edccc167c4b5793d1cb138
 * catch-script/search.js#Worker/JSON.parse/XMLHttpRequest/fetch/TextDecoder.
 *
 * This module owns hook installation and native-behavior preservation only.
 * Discovery and secure relay remain separate callbacks so Electron concerns do
 * not leak into the Cat Catch port.
 */

export type DeepSearchRuntimeObservationSource =
  | 'fetch'
  | 'json'
  | 'text-decoder'
  | 'xhr'
  | 'xhr-url'

export type DeepSearchRuntimeObservation = {
  method?: string
  pageUrl: string
  source: DeepSearchRuntimeObservationSource
}

type DeepSearchWorkerEvent = {
  data?: unknown
  stopImmediatePropagation?: () => void
}

type DeepSearchWorker = {
  addEventListener: (type: string, listener: (event: DeepSearchWorkerEvent) => void, options?: unknown) => void
  terminate?: () => void
}

type DeepSearchWorkerConstructor = {
  new (scriptUrl: string | URL, options?: WorkerOptions): DeepSearchWorker
  prototype: object
  toString: () => string
}

type DeepSearchXhr = {
  addEventListener: (type: string, listener: () => void) => void
  open: (method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) => void
  response: unknown
  responseText: string
  responseType: string
  responseURL: string
  send: (body?: Document | XMLHttpRequestBodyInit | null) => void
  status: number
}

type DeepSearchXhrConstructor = {
  new (): DeepSearchXhr
  prototype: DeepSearchXhr
}

export type DeepSearchRuntimeScope = {
  ArrayBuffer: typeof ArrayBuffer
  Blob: typeof Blob
  JSON: Pick<JSON, 'parse'>
  Request?: typeof Request
  TextDecoder: typeof TextDecoder
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  Worker: DeepSearchWorkerConstructor
  XMLHttpRequest: DeepSearchXhrConstructor
  clearTimeout: typeof clearTimeout
  fetch: typeof fetch
  location: {
    href: string
    protocol: string
  }
  setTimeout: typeof setTimeout
}

export type DeepSearchRuntime = {
  dispose: () => void
  isDisposed: () => boolean
}

export type InstallDeepSearchRuntimeInput = {
  consumeWorkerMessage?: (value: unknown) => boolean
  inspect: (value: unknown, observation: DeepSearchRuntimeObservation) => void
  scope: DeepSearchRuntimeScope
  workerBlobTtlMs?: number
  workerBootstrapSource: string
  workerProbeTimeoutMs?: number
}

export function installDeepSearchRuntime(input: InstallDeepSearchRuntimeInput): DeepSearchRuntime {
  const runtimeSentinel = '__OMNIFLOW_DEEP_SEARCH_RUNTIME_V1__'
  const workerProbeMessage = '__OMNIFLOW_DEEP_SEARCH_WORKER_PROBE_V1__'
  const resolveRequestUrl = (request: RequestInfo | URL, pageUrl: string) => {
    if (typeof request === 'string') return request
    if (request && typeof request === 'object' && 'url' in request) {
      const requestUrl = String((request as { url?: unknown }).url || '')
      if (requestUrl) return requestUrl
    }
    const raw = String(request || '')
    if (!raw) return pageUrl
    try {
      return new URL(raw, pageUrl).href
    } catch {
      return raw
    }
  }
  const normalizeMethod = (method: unknown, fallback = 'GET') => {
    const value = String(method || fallback).trim()
    return (value || fallback).toUpperCase()
  }
  const safeInspect = (value: unknown, observation: DeepSearchRuntimeObservation) => {
    try {
      input.inspect(value, observation)
    } catch {
      // Observation must never alter page behavior.
    }
  }
  const scopeRecord = input.scope as unknown as Record<string, unknown>
  const current = scopeRecord[runtimeSentinel] as DeepSearchRuntime | undefined
  if (current && !current.isDisposed()) return current

  const scope = input.scope
  const restore: Array<() => void> = []
  const workerBlobUrls = new Set<string>()
  const workerBlobTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false
  let workerProbeTimer: ReturnType<typeof setTimeout> | undefined
  let workerProbe: DeepSearchWorker | undefined
  let workerProbeUrl = ''

  const revokeWorkerBlobUrl = (url: string) => {
    if (!url || !workerBlobUrls.delete(url)) return
    const timer = workerBlobTimers.get(url)
    if (timer !== undefined) {
      scope.clearTimeout(timer)
      workerBlobTimers.delete(url)
    }
    try {
      scope.URL.revokeObjectURL(url)
    } catch {
      // The URL may already have been revoked by its document.
    }
  }

  const trackWorkerBlobUrl = (url: string) => {
    workerBlobUrls.add(url)
    const ttl = Math.max(1_000, input.workerBlobTtlMs ?? 60_000)
    workerBlobTimers.set(url, scope.setTimeout(() => {
      revokeWorkerBlobUrl(url)
    }, ttl))
    return url
  }

  const nativeJsonParse = scope.JSON.parse
  const wrappedJsonParse = function (this: unknown, text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
    const value = Reflect.apply(nativeJsonParse, this, reviver === undefined ? [text] : [text, reviver])
    safeInspect(value, {
      pageUrl: scope.location.href,
      source: 'json',
    })
    return value
  } as typeof nativeJsonParse
  wrappedJsonParse.toString = () => nativeJsonParse.toString()
  scope.JSON.parse = wrappedJsonParse
  restore.push(() => {
    if (scope.JSON.parse === wrappedJsonParse) scope.JSON.parse = nativeJsonParse
  })

  const nativeTextDecode = scope.TextDecoder.prototype.decode
  const wrappedTextDecode = function (this: TextDecoder, value?: AllowSharedBufferSource, options?: TextDecodeOptions) {
    const result = nativeTextDecode.call(this, value, options)
    if (result.startsWith('#EXTM3U') || result.toUpperCase().includes('#EXTM3U')) {
      safeInspect(result, {
        pageUrl: scope.location.href,
        source: 'text-decoder',
      })
    }
    return result
  } as typeof nativeTextDecode
  wrappedTextDecode.toString = () => nativeTextDecode.toString()
  scope.TextDecoder.prototype.decode = wrappedTextDecode
  restore.push(() => {
    if (scope.TextDecoder.prototype.decode === wrappedTextDecode) {
      scope.TextDecoder.prototype.decode = nativeTextDecode
    }
  })

  const nativeXhrOpen = scope.XMLHttpRequest.prototype.open
  const wrappedXhrOpen = function (
    this: DeepSearchXhr,
    ...argumentsList: [
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ]
  ) {
    const [method, url] = argumentsList
    const requestMethod = normalizeMethod(method)
    this.addEventListener('readystatechange', () => {
      if (this.status !== 200) return
      const pageUrl = this.responseURL || String(url || scope.location.href)
      const observation = {
        method: requestMethod,
        pageUrl,
        source: 'xhr' as const,
      }
      const response = this.response
      if (response instanceof scope.ArrayBuffer) {
        if (response.byteLength === 16 || response.byteLength === 32) {
          safeInspect(response, observation)
        }
        if (this.responseURL.includes('.ts')) {
          safeInspect(this.responseURL, {
            method: requestMethod,
            pageUrl,
            source: 'xhr-url',
          })
        }
        return
      }
      if (response && typeof response === 'object') {
        safeInspect(response, observation)
        return
      }
      if (typeof response === 'string' && response !== '') {
        safeInspect(response, observation)
        return
      }
      if (typeof this.responseText === 'string' && this.responseText !== '') {
        safeInspect(this.responseText, observation)
      }
    })
    return Reflect.apply(nativeXhrOpen, this, argumentsList)
  } as DeepSearchXhr['open']
  wrappedXhrOpen.toString = () => nativeXhrOpen.toString()
  scope.XMLHttpRequest.prototype.open = wrappedXhrOpen
  restore.push(() => {
    if (scope.XMLHttpRequest.prototype.open === wrappedXhrOpen) {
      scope.XMLHttpRequest.prototype.open = nativeXhrOpen
    }
  })

  const nativeFetch = scope.fetch
  const wrappedFetch = async function (this: unknown, request: RequestInfo | URL, init?: RequestInit) {
    const response = await Reflect.apply(nativeFetch, this, init === undefined ? [request] : [request, init])
    const clone = response.clone()
    const pageUrl = resolveRequestUrl(request, scope.location.href)
    const requestMethod = normalizeMethod(init?.method, (
      scope.Request && request instanceof scope.Request ? request.method : 'GET'
    ))
    void response.arrayBuffer().then((buffer) => {
      if (buffer.byteLength === 16) {
        safeInspect(buffer, {
          method: requestMethod,
          pageUrl,
          source: 'fetch',
        })
        return
      }
      const text = nativeTextDecode.call(new scope.TextDecoder(), buffer)
      if (text === '') return
      safeInspect(text, {
        method: requestMethod,
        pageUrl,
        source: 'fetch',
      })
    }).catch(() => undefined)
    return clone
  } as typeof fetch
  wrappedFetch.toString = () => nativeFetch.toString()
  scope.fetch = wrappedFetch
  restore.push(() => {
    if (scope.fetch === wrappedFetch) scope.fetch = nativeFetch
  })

  const nativeWorker = scope.Worker
  const nativeXhr = scope.XMLHttpRequest
  let workerBlobSupport: 'probing' | 'supported' | 'unsupported' = 'probing'

  const finishWorkerProbe = (nextState: 'supported' | 'unsupported') => {
    if (workerBlobSupport !== 'probing') return
    workerBlobSupport = nextState
    if (workerProbeTimer !== undefined) {
      scope.clearTimeout(workerProbeTimer)
      workerProbeTimer = undefined
    }
    try {
      workerProbe?.terminate?.()
    } catch {
      // Ignore probe cleanup failures.
    }
    workerProbe = undefined
    revokeWorkerBlobUrl(workerProbeUrl)
    workerProbeUrl = ''
  }

  try {
    workerProbeUrl = trackWorkerBlobUrl(scope.URL.createObjectURL(new scope.Blob([
      `self.postMessage(${JSON.stringify(workerProbeMessage)})`,
    ], { type: 'text/javascript' })))
    workerProbe = Reflect.construct(nativeWorker, [workerProbeUrl]) as DeepSearchWorker
    workerProbe.addEventListener('message', (event) => {
      if (event.data === workerProbeMessage) finishWorkerProbe('supported')
    })
    workerProbe.addEventListener('error', () => finishWorkerProbe('unsupported'))
    workerProbeTimer = scope.setTimeout(
      () => finishWorkerProbe('unsupported'),
      Math.max(100, input.workerProbeTimeoutMs ?? 2_000),
    )
  } catch {
    finishWorkerProbe('unsupported')
  }

  const attachWorkerRelay = (worker: DeepSearchWorker) => {
    if (!input.consumeWorkerMessage) return
    worker.addEventListener('message', (event) => {
      let consumed = false
      try {
        consumed = input.consumeWorkerMessage?.(event.data) === true
      } catch {
        consumed = false
      }
      if (consumed) event.stopImmediatePropagation?.()
    }, { capture: true })
  }

  const createInjectedWorkerUrl = (scriptUrl: string | URL) => {
    const rawUrl = String(scriptUrl || '')
    if (!rawUrl) return ''
    let absoluteUrl = rawUrl
    try {
      absoluteUrl = new URL(rawUrl, scope.location.href).href
    } catch {
      // Keep the original URL and let the native Worker report invalid input.
    }
    const xhr = new nativeXhr()
    xhr.open('GET', absoluteUrl, false)
    xhr.send()
    if (xhr.status !== 200 || !xhr.responseText) return ''
    return trackWorkerBlobUrl(scope.URL.createObjectURL(new scope.Blob([
      input.workerBootstrapSource,
      xhr.responseText,
    ], { type: 'text/javascript' })))
  }

  const wrappedWorker = function (scriptUrl: string | URL, options?: WorkerOptions) {
    let injectedUrl = ''
    if (workerBlobSupport === 'supported') {
      try {
        injectedUrl = createInjectedWorkerUrl(scriptUrl)
      } catch {
        injectedUrl = ''
      }
    }
    const worker = Reflect.construct(
      nativeWorker,
      injectedUrl ? [injectedUrl, options] : [scriptUrl, options],
    ) as DeepSearchWorker
    attachWorkerRelay(worker)
    return worker
  } as unknown as DeepSearchWorkerConstructor
  wrappedWorker.prototype = nativeWorker.prototype
  wrappedWorker.toString = () => nativeWorker.toString()
  scope.Worker = wrappedWorker
  restore.push(() => {
    if (scope.Worker === wrappedWorker) scope.Worker = nativeWorker
  })

  const runtime: DeepSearchRuntime = {
    dispose() {
      if (disposed) return
      disposed = true
      if (workerProbeTimer !== undefined) {
        scope.clearTimeout(workerProbeTimer)
        workerProbeTimer = undefined
      }
      try {
        workerProbe?.terminate?.()
      } catch {
        // Ignore probe cleanup failures.
      }
      workerProbe = undefined
      for (const restoreHook of restore.reverse()) restoreHook()
      for (const url of [...workerBlobUrls]) revokeWorkerBlobUrl(url)
      if (scopeRecord[runtimeSentinel] === runtime) delete scopeRecord[runtimeSentinel]
    },
    isDisposed: () => disposed,
  }

  Object.defineProperty(scopeRecord, runtimeSentinel, {
    configurable: true,
    value: runtime,
  })
  return runtime
}

export function createDeepSearchRuntimeInstallerSource() {
  return `(${installDeepSearchRuntime.toString()})`
}

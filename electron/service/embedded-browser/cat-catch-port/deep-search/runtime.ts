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
  | 'key-hook'
  | 'string-hook'
  | 'text-decoder'
  | 'xhr'
  | 'xhr-url'

export type DeepSearchRuntimeObservation = {
  method?: string
  pageUrl: string
  source: DeepSearchRuntimeObservationSource
  surface?: string
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
  Array: ArrayConstructor
  ArrayBuffer: typeof ArrayBuffer
  Blob: typeof Blob
  DataView: typeof DataView
  Int8Array: typeof Int8Array
  JSON: Pick<JSON, 'parse'>
  Request?: typeof Request
  String: StringConstructor
  TextDecoder: typeof TextDecoder
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  Uint16Array: typeof Uint16Array
  Uint32Array: typeof Uint32Array
  Uint8Array: typeof Uint8Array
  Worker: DeepSearchWorkerConstructor
  XMLHttpRequest: DeepSearchXhrConstructor
  atob: typeof atob
  btoa: typeof btoa
  clearTimeout: typeof clearTimeout
  escape?: typeof escape
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
  let isInspecting = false
  const safeInspect = (value: unknown, observation: DeepSearchRuntimeObservation) => {
    if (isInspecting) return
    isInspecting = true
    try {
      input.inspect(value, observation)
    } catch {
      // Observation must never alter page behavior.
    } finally {
      isInspecting = false
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

  const nativeArraySlice = scope.Array.prototype.slice
  const nativeArrayJoin = scope.Array.prototype.join
  const nativeInt8Array = scope.Int8Array
  const nativeUint8Array = scope.Uint8Array
  const nativeUint16Array = scope.Uint16Array
  const nativeUint32Array = scope.Uint32Array
  const nativeDataView = scope.DataView
  const nativeString = scope.String
  const nativeFromCharCode = scope.String.fromCharCode
  const nativeStringIndexOf = scope.String.prototype.indexOf
  const nativeBtoa = scope.btoa
  const nativeAtob = scope.atob
  const keyObservation = (surface: string): DeepSearchRuntimeObservation => ({
    pageUrl: scope.location.href,
    source: 'key-hook',
    surface,
  })
  const stringObservation = (surface: string): DeepSearchRuntimeObservation => ({
    pageUrl: scope.location.href,
    source: 'string-hook',
    surface,
  })

  const wrappedArraySlice = function (this: unknown[], ...argumentsList: [start?: number, end?: number]) {
    const [, end] = argumentsList
    const value = Reflect.apply(nativeArraySlice, this, argumentsList)
    if (Number(end) === 16 && this.length === 32) {
      let valid = true
      for (const item of value) {
        if (typeof item !== 'number' || item > 255) {
          valid = false
          break
        }
      }
      if (valid) safeInspect(value, keyObservation('array-slice'))
    }
    return value
  } as typeof nativeArraySlice
  wrappedArraySlice.toString = () => nativeArraySlice.toString()
  scope.Array.prototype.slice = wrappedArraySlice
  restore.push(() => {
    if (scope.Array.prototype.slice === wrappedArraySlice) {
      scope.Array.prototype.slice = nativeArraySlice
    }
  })

  const createSubarrayWrapper = <T extends Int8Array | Uint8Array>(
    nativeSubarray: (this: T, begin?: number, end?: number) => T,
  ) => {
    const wrappedSubarray = function (this: T, ...argumentsList: [begin?: number, end?: number]) {
      const value = Reflect.apply(nativeSubarray, this, argumentsList)
      if (value.byteLength === 16) {
        const copy = new nativeUint8Array(value as unknown as ArrayLike<number>)
        safeInspect(copy.buffer, keyObservation('typed-subarray'))
      }
      return value
    }
    wrappedSubarray.toString = () => nativeSubarray.toString()
    return wrappedSubarray
  }

  const nativeInt8Subarray = nativeInt8Array.prototype.subarray
  const wrappedInt8Subarray = createSubarrayWrapper(nativeInt8Subarray)
  nativeInt8Array.prototype.subarray = wrappedInt8Subarray
  restore.push(() => {
    if (nativeInt8Array.prototype.subarray === wrappedInt8Subarray) {
      nativeInt8Array.prototype.subarray = nativeInt8Subarray
    }
  })

  const nativeUint8Subarray = nativeUint8Array.prototype.subarray
  const wrappedUint8Subarray = createSubarrayWrapper(nativeUint8Subarray)
  nativeUint8Array.prototype.subarray = wrappedUint8Subarray
  restore.push(() => {
    if (nativeUint8Array.prototype.subarray === wrappedUint8Subarray) {
      nativeUint8Array.prototype.subarray = nativeUint8Subarray
    }
  })

  const wrappedBtoa = function (this: unknown, ...argumentsList: [data: string]) {
    const [data] = argumentsList
    const base64 = Reflect.apply(nativeBtoa, this, argumentsList)
    if (base64.length === 24 && base64.substring(22, 24) === '==') {
      safeInspect(base64, keyObservation('btoa'))
    }
    if (data.substring(0, 7).toUpperCase() === '#EXTM3U') {
      safeInspect(data, stringObservation('btoa'))
    }
    return base64
  } as typeof nativeBtoa
  wrappedBtoa.toString = () => nativeBtoa.toString()
  scope.btoa = wrappedBtoa
  restore.push(() => {
    if (scope.btoa === wrappedBtoa) scope.btoa = nativeBtoa
  })

  const wrappedAtob = function (this: unknown, ...argumentsList: [base64: string]) {
    const [base64] = argumentsList
    const value = Reflect.apply(nativeAtob, this, argumentsList)
    if (base64.length === 24 && base64.substring(22, 24) === '==') {
      safeInspect(base64, keyObservation('atob'))
    }
    if (value.substring(0, 7).toUpperCase() === '#EXTM3U' || value.endsWith('</MPD>')) {
      safeInspect(value, stringObservation('atob'))
    }
    return value
  } as typeof nativeAtob
  wrappedAtob.toString = () => nativeAtob.toString()
  scope.atob = wrappedAtob
  restore.push(() => {
    if (scope.atob === wrappedAtob) scope.atob = nativeAtob
  })

  let m3u8Text = ''
  const hexPattern = /^[A-Fa-f0-9]+$/
  const nativeFromCharCodeSource = nativeFromCharCode.toString()
  const wrappedFromCharCode = new Proxy(nativeFromCharCode, {
    apply(target, thisArg, argumentsList) {
      const value = Reflect.apply(target, thisArg, argumentsList)
      if (value.length < 7) return value
      if (value.substring(0, 7) === '#EXTM3U' || value.includes('#EXTINF:')) {
        m3u8Text += value
        if (m3u8Text.includes('#EXT-X-ENDLIST')) {
          const complete = `${m3u8Text.split('#EXT-X-ENDLIST')[0]}#EXT-X-ENDLIST`
          safeInspect(complete, stringObservation('from-char-code'))
          m3u8Text = ''
        }
        return value
      }
      const normalized = value.split('\u0010').join('')
      if (normalized.length === 32 && hexPattern.test(normalized)) {
        safeInspect(normalized, keyObservation('from-char-code'))
      }
      return value
    },
    get(target, property, receiver) {
      if (property === 'toString') return () => nativeFromCharCodeSource
      return Reflect.get(target, property, receiver)
    },
  })
  scope.String.fromCharCode = wrappedFromCharCode
  restore.push(() => {
    if (scope.String.fromCharCode === wrappedFromCharCode) {
      scope.String.fromCharCode = nativeFromCharCode
    }
  })

  const repeatedExpansion = (buffer: ArrayBufferLike, size: number) => {
    const bytes = new nativeUint8Array(buffer)
    const result = new nativeUint8Array(size)
    for (let index = 0; index < size; index += 1) {
      result[index] = bytes[index] || 0
      for (let offset = index + size; offset < bytes.byteLength; offset += size) {
        if (bytes[index] !== bytes[offset]) return undefined
      }
    }
    return result.buffer
  }

  const wrappedDataView = function (
    ...argumentsList: [buffer: ArrayBufferLike, byteOffset?: number, byteLength?: number]
  ) {
    const view = Reflect.construct(nativeDataView, argumentsList) as DataView
    const observeView = (current: DataView) => {
      if (current.byteLength === 16) {
        safeInspect(current.buffer, keyObservation('data-view'))
      }
    }
    for (const methodName of ['setInt8', 'setUint8', 'setInt16', 'setUint16', 'setInt32', 'setUint32'] as const) {
      const nativeMethod = view[methodName]
      view[methodName] = function (this: DataView, ...argumentsList: unknown[]) {
        const result = Reflect.apply(nativeMethod, this, argumentsList)
        observeView(this)
        return result
      } as typeof nativeMethod
    }
    if (view.byteLength === 16 && view.buffer.byteLength === 16) {
      safeInspect(view.buffer, keyObservation('data-view'))
    }
    if (view.byteLength === 256 || view.byteLength === 128 || view.byteLength === 32) {
      const repeated = repeatedExpansion(view.buffer, 16)
      if (repeated) safeInspect(repeated, keyObservation('data-view'))
    }
    if (view.byteLength === 32) {
      safeInspect(view.buffer.slice(0, 16), keyObservation('data-view'))
    }
    return view
  } as unknown as typeof DataView
  ;(wrappedDataView as unknown as { prototype: DataView }).prototype = nativeDataView.prototype
  wrappedDataView.toString = () => nativeDataView.toString()
  scope.DataView = wrappedDataView
  restore.push(() => {
    if (scope.DataView === wrappedDataView) scope.DataView = nativeDataView
  })

  const nativeEscape = scope.escape
  if (nativeEscape) {
    const wrappedEscape = function (this: unknown, ...argumentsList: [value: string]) {
      const [value] = argumentsList
      if (value?.length === 24 && value.substring(22, 24) === '==') {
        safeInspect(value, keyObservation('escape'))
      }
      return Reflect.apply(nativeEscape, this, argumentsList)
    } as typeof nativeEscape
    wrappedEscape.toString = () => nativeEscape.toString()
    scope.escape = wrappedEscape
    restore.push(() => {
      if (scope.escape === wrappedEscape) scope.escape = nativeEscape
    })
  }

  const wrappedStringIndexOf = function (
    this: string,
    ...argumentsList: [searchValue: string, fromIndex?: number]
  ) {
    const [searchValue, fromIndex] = argumentsList
    const index = Reflect.apply(nativeStringIndexOf, this, argumentsList)
    if (searchValue === '#EXTM3U' && index !== -1) {
      safeInspect(nativeString(this).substring(fromIndex ?? 0), stringObservation('string-index-of'))
    }
    return index
  } as typeof nativeStringIndexOf
  wrappedStringIndexOf.toString = () => nativeStringIndexOf.toString()
  scope.String.prototype.indexOf = wrappedStringIndexOf
  restore.push(() => {
    if (scope.String.prototype.indexOf === wrappedStringIndexOf) {
      scope.String.prototype.indexOf = nativeStringIndexOf
    }
  })

  const uint32ToBytes = (array: Uint32Array) => {
    const bytes = new nativeUint8Array(16)
    for (let index = 0; index < 4; index += 1) {
      bytes[index * 4] = (array[index] >> 24) & 0xff
      bytes[index * 4 + 1] = (array[index] >> 16) & 0xff
      bytes[index * 4 + 2] = (array[index] >> 8) & 0xff
      bytes[index * 4 + 3] = array[index] & 0xff
    }
    return bytes
  }
  const uint16ToBytes = (array: Uint16Array) => {
    const bytes = new nativeUint8Array(16)
    for (let index = 0; index < 8; index += 1) {
      bytes[index * 2] = (array[index] >> 8) & 0xff
      bytes[index * 2 + 1] = array[index] & 0xff
    }
    return bytes
  }
  const createTypedArrayWrapper = <T extends typeof Uint8Array | typeof Uint16Array | typeof Uint32Array>(
    nativeConstructor: T,
  ) => {
    const nativeSource = nativeConstructor.toString()
    return new Proxy(nativeConstructor, {
      construct(target, argumentsList, newTarget) {
        const first = argumentsList[0]
        const value = Reflect.construct(target, argumentsList, newTarget) as InstanceType<T>
        if (scope.Array.isArray(first) && first.length === 16) {
          safeInspect(
            new nativeUint8Array(first as unknown as ArrayLike<number>).buffer,
            keyObservation('typed-array'),
          )
        } else if (first instanceof scope.ArrayBuffer && first.byteLength === 16) {
          safeInspect(first, keyObservation('typed-array'))
        } else if (value.buffer.byteLength === 16) {
          if (target.name === 'Uint32Array') {
            safeInspect(uint32ToBytes(value as unknown as Uint32Array).buffer, keyObservation('typed-array'))
          } else if (target.name === 'Uint16Array') {
            safeInspect(uint16ToBytes(value as unknown as Uint16Array).buffer, keyObservation('typed-array'))
          } else {
            safeInspect(value.buffer, keyObservation('typed-array'))
          }
        }
        return value
      },
      get(target, property, receiver) {
        if (property === 'toString') return () => nativeSource
        return Reflect.get(target, property, receiver)
      },
    }) as T
  }

  const wrappedUint8Array = createTypedArrayWrapper(nativeUint8Array)
  const wrappedUint16Array = createTypedArrayWrapper(nativeUint16Array)
  const wrappedUint32Array = createTypedArrayWrapper(nativeUint32Array)
  scope.Uint8Array = wrappedUint8Array
  scope.Uint16Array = wrappedUint16Array
  scope.Uint32Array = wrappedUint32Array
  restore.push(() => {
    if (scope.Uint8Array === wrappedUint8Array) scope.Uint8Array = nativeUint8Array
    if (scope.Uint16Array === wrappedUint16Array) scope.Uint16Array = nativeUint16Array
    if (scope.Uint32Array === wrappedUint32Array) scope.Uint32Array = nativeUint32Array
  })

  const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/
  const wrappedArrayJoin = function (this: unknown[], ...argumentsList: [separator?: string]) {
    const value = Reflect.apply(nativeArrayJoin, this, argumentsList)
    if (value.substring(0, 7).toUpperCase() === '#EXTM3U') {
      safeInspect(value, stringObservation('array-join'))
    }
    if (value.length === 24 && base64Pattern.test(value)) {
      safeInspect(value, keyObservation('array-join'))
    }
    return value
  } as typeof nativeArrayJoin
  wrappedArrayJoin.toString = () => nativeArrayJoin.toString()
  scope.Array.prototype.join = wrappedArrayJoin
  restore.push(() => {
    if (scope.Array.prototype.join === wrappedArrayJoin) {
      scope.Array.prototype.join = nativeArrayJoin
    }
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

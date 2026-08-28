import { describe, expect, it, vi } from 'vitest'

import {
  createDeepSearchRuntimeInstallerSource,
  installDeepSearchRuntime,
  type DeepSearchRuntimeObservation,
  type DeepSearchRuntimeScope,
} from './runtime'

type Listener = (event: {
  data?: unknown
  stopImmediatePropagation: () => void
}) => void

class FakeWorker {
  static instances: FakeWorker[] = []

  readonly listeners = new Map<string, Listener[]>()
  readonly terminate = vi.fn()

  constructor(
    readonly scriptUrl: string,
    readonly options?: unknown,
  ) {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, data?: unknown) {
    const event = {
      data,
      stopImmediatePropagation: vi.fn(),
    }
    for (const listener of this.listeners.get(type) || []) listener(event)
    return event
  }
}

class FakeXhr {
  static instances: FakeXhr[] = []
  static synchronousResponseText = ''

  readonly listeners = new Map<string, Array<() => void>>()
  method = ''
  response: unknown = ''
  responseType = ''
  responseURL = ''
  responseText = ''
  status = 0
  synchronousResponseText = ''

  constructor() {
    FakeXhr.instances.push(this)
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  open(method: string, url: string) {
    this.method = method
    this.responseURL = url
  }

  send() {
    this.synchronousResponseText = FakeXhr.synchronousResponseText
    if (this.synchronousResponseText) {
      this.status = 200
      this.responseText = this.synchronousResponseText
      this.response = this.synchronousResponseText
    }
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) || []) listener()
  }
}

function createScope(overrides: Record<string, unknown> = {}) {
  FakeWorker.instances = []
  FakeXhr.instances = []
  FakeXhr.synchronousResponseText = ''
  let blobIndex = 0
  const revokeObjectURL = vi.fn()
  const scope = {
    Array,
    ArrayBuffer,
    Blob,
    DataView,
    Int8Array,
    JSON: { parse: JSON.parse },
    Request,
    String,
    TextDecoder,
    URL: {
      createObjectURL: vi.fn(() => `blob:deep-runtime-${++blobIndex}`),
      revokeObjectURL,
    },
    Uint16Array,
    Uint32Array,
    Uint8Array,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    atob,
    btoa,
    clearTimeout,
    escape,
    fetch: vi.fn(),
    location: {
      href: 'https://page.example/watch',
      protocol: 'https:',
    },
    setTimeout,
    ...overrides,
  }
  return { revokeObjectURL, scope: scope as unknown as DeepSearchRuntimeScope }
}

async function flushAsyncObservers() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Cat Catch deep-search runtime hooks', () => {
  it('deep.hook-install-sentinels', () => {
    const { scope } = createScope()
    const originalJsonParse = scope.JSON.parse
    const originalArraySlice = scope.Array.prototype.slice
    const originalDataView = scope.DataView
    const originalStringIndexOf = scope.String.prototype.indexOf
    const originalUint8Array = scope.Uint8Array
    const originalFromCharCodeSource = scope.String.fromCharCode.toString()
    const originalUint8ArraySource = scope.Uint8Array.toString()
    const observations: DeepSearchRuntimeObservation[] = []
    const first = installDeepSearchRuntime({
      inspect: (_value, observation) => {
        observations.push(observation)
        new scope.Uint8Array(16)
      },
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const second = installDeepSearchRuntime({
      inspect: (_value, observation) => observations.push(observation),
      scope,
      workerBootstrapSource: '/* ignored duplicate */',
    })

    expect(second).toBe(first)
    expect(scope.JSON.parse).not.toBe(originalJsonParse)
    expect(scope.String.fromCharCode.toString()).toBe(originalFromCharCodeSource)
    expect(scope.Uint8Array.toString()).toBe(originalUint8ArraySource)
    scope.JSON.parse('{"media":"https://cdn.example/video.mp4"}')
    expect(observations).toEqual([
      expect.objectContaining({ source: 'json' }),
    ])

    first.dispose()
    expect(scope.JSON.parse).toBe(originalJsonParse)
    expect(scope.Array.prototype.slice).toBe(originalArraySlice)
    expect(scope.DataView).toBe(originalDataView)
    expect(scope.String.prototype.indexOf).toBe(originalStringIndexOf)
    expect(scope.Uint8Array).toBe(originalUint8Array)
    expect(originalUint8Array.toString()).toBe(originalUint8ArraySource)
    const reinstalled = installDeepSearchRuntime({
      inspect: vi.fn(),
      scope,
      workerBootstrapSource: '/* reinstall */',
    })
    expect(reinstalled).not.toBe(first)
    reinstalled.dispose()

    const sourcedInstaller = Function(`return ${createDeepSearchRuntimeInstallerSource()}`)() as typeof installDeepSearchRuntime
    const sourcedScope = createScope().scope
    const sourcedInspect = vi.fn()
    const sourcedRuntime = sourcedInstaller({
      inspect: sourcedInspect,
      scope: sourcedScope,
      workerBootstrapSource: '/* serialized installer */',
    })
    sourcedScope.JSON.parse('{"ok":true}')
    expect(sourcedInspect).toHaveBeenCalledWith({ ok: true }, {
      pageUrl: 'https://page.example/watch',
      source: 'json',
    })
    sourcedRuntime.dispose()
  })

  it('deep.worker-csp-fallback', () => {
    const { revokeObjectURL, scope } = createScope()
    const consumeWorkerMessage = vi.fn(() => true)
    const runtime = installDeepSearchRuntime({
      consumeWorkerMessage,
      inspect: vi.fn(),
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })

    expect(FakeWorker.instances.map(worker => worker.scriptUrl)).toEqual([
      'blob:deep-runtime-1',
    ])
    FakeWorker.instances[0]?.emit('error')
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:deep-runtime-1')

    const worker = new scope.Worker('https://page.example/worker.js') as unknown as FakeWorker
    expect(worker.scriptUrl).toBe('https://page.example/worker.js')
    expect(FakeXhr.instances).toHaveLength(0)
    worker.emit('message', { action: 'catCatchAddMedia' })
    expect(consumeWorkerMessage).toHaveBeenCalledWith({ action: 'catCatchAddMedia' })

    runtime.dispose()
    expect(scope.Worker).toBe(FakeWorker)
  })

  it('deep.worker-bootstrap-relay', () => {
    const { revokeObjectURL, scope } = createScope()
    FakeXhr.synchronousResponseText = 'self.workerApplicationStarted = true'
    const consumeWorkerMessage = vi.fn(() => true)
    const runtime = installDeepSearchRuntime({
      consumeWorkerMessage,
      inspect: vi.fn(),
      scope,
      workerBootstrapSource: 'self.deepRuntimeInstalled = true;',
    })

    FakeWorker.instances[0]?.emit('message', '__OMNIFLOW_DEEP_SEARCH_WORKER_PROBE_V1__')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:deep-runtime-1')

    const worker = new scope.Worker('https://page.example/worker.js', {
      name: 'player-worker',
    }) as unknown as FakeWorker
    expect(FakeXhr.instances).toHaveLength(1)
    expect(FakeXhr.instances[0]).toMatchObject({
      method: 'GET',
      responseURL: 'https://page.example/worker.js',
    })
    expect(worker.scriptUrl).toBe('blob:deep-runtime-2')
    expect(worker.options).toEqual({ name: 'player-worker' })

    const event = worker.emit('message', { action: 'catCatchAddKey' })
    expect(consumeWorkerMessage).toHaveBeenCalledWith({ action: 'catCatchAddKey' })
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()

    runtime.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:deep-runtime-2')
  })

  it('deep.text-decoder-manifest', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })

    const decoder = new scope.TextDecoder()
    expect(decoder.decode(new TextEncoder().encode('ordinary text'))).toBe('ordinary text')
    expect(decoder.decode(new TextEncoder().encode('prefix\n#EXTM3U\nsegment.ts')))
      .toBe('prefix\n#EXTM3U\nsegment.ts')
    expect(inspect).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledWith('prefix\n#EXTM3U\nsegment.ts', {
      pageUrl: 'https://page.example/watch',
      source: 'text-decoder',
    })

    runtime.dispose()
  })

  it('deep.fetch-clone-observation', async () => {
    const nativeFetch = vi.fn(async () => new Response('#EXTM3U\nsegment.ts'))
    const { scope } = createScope({ fetch: nativeFetch })
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })

    const response = await scope.fetch('https://cdn.example/master.m3u8')
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe('#EXTM3U\nsegment.ts')
    await flushAsyncObservers()
    expect(inspect).toHaveBeenCalledWith('#EXTM3U\nsegment.ts', {
      method: 'GET',
      pageUrl: 'https://cdn.example/master.m3u8',
      source: 'fetch',
    })

    runtime.dispose()
    expect(scope.fetch).toBe(nativeFetch)
  })

  it('deep.xhr-response-branches', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const xhr = new scope.XMLHttpRequest() as unknown as FakeXhr
    xhr.open('post', 'https://api.example/player')
    xhr.status = 200
    xhr.responseURL = 'https://api.example/player'
    xhr.response = { manifest: '#EXTM3U\nsegment.ts' }
    xhr.emit('readystatechange')

    expect(inspect).toHaveBeenCalledWith(xhr.response, {
      method: 'POST',
      pageUrl: 'https://api.example/player',
      source: 'xhr',
    })
    runtime.dispose()
  })

  it('deep.key-array-surfaces', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const bytes = Array.from({ length: 32 }, (_, index) => index + 1)

    scope.Array.prototype.slice.call(bytes, 0, 16)
    new scope.Uint8Array(bytes).subarray(0, 16)

    expect(inspect).toHaveBeenCalledWith(bytes.slice(0, 16), {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'array-slice',
    })
    expect(inspect).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'typed-subarray',
    })
    runtime.dispose()
  })

  it('deep.key-dataview-typedarray', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const buffer = new ArrayBuffer(16)

    const view = new scope.DataView(buffer)
    view.setUint8(0, 7)
    new scope.Uint32Array([0x01020304, 0x11121314, 0x21222324, 0x31323334])

    expect(inspect).toHaveBeenCalledWith(buffer, {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'data-view',
    })
    expect(inspect).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'typed-array',
    })
    runtime.dispose()
  })

  it('deep.key-string-surfaces', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const binaryKey = scope.String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index + 1))
    const base64Key = scope.btoa(binaryKey)
    scope.atob(base64Key)
    scope.escape?.(base64Key)

    expect(base64Key).toHaveLength(24)
    expect(inspect).toHaveBeenCalledWith(base64Key, {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'btoa',
    })
    expect(inspect).toHaveBeenCalledWith(base64Key, {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'atob',
    })
    expect(inspect).toHaveBeenCalledWith(base64Key, {
      pageUrl: 'https://page.example/watch',
      source: 'key-hook',
      surface: 'escape',
    })
    runtime.dispose()
  })

  it('deep.manifest-string-surfaces', () => {
    const { scope } = createScope()
    const inspect = vi.fn()
    const runtime = installDeepSearchRuntime({
      inspect,
      scope,
      workerBootstrapSource: '/* deep worker bootstrap */',
    })
    const manifest = '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST'

    scope.btoa(manifest)
    scope.Array.prototype.join.call(['#EXTM3U', 'segment.ts'], '\n')
    scope.String.prototype.indexOf.call(manifest, '#EXTM3U')
    scope.String.fromCharCode(...Array.from(manifest, character => character.charCodeAt(0)))

    expect(inspect).toHaveBeenCalledWith(manifest, {
      pageUrl: 'https://page.example/watch',
      source: 'string-hook',
      surface: 'btoa',
    })
    expect(inspect).toHaveBeenCalledWith('#EXTM3U\nsegment.ts', {
      pageUrl: 'https://page.example/watch',
      source: 'string-hook',
      surface: 'array-join',
    })
    expect(inspect).toHaveBeenCalledWith(manifest, {
      pageUrl: 'https://page.example/watch',
      source: 'string-hook',
      surface: 'string-index-of',
    })
    expect(inspect).toHaveBeenCalledWith(manifest, {
      pageUrl: 'https://page.example/watch',
      source: 'string-hook',
      surface: 'from-char-code',
    })
    runtime.dispose()
  })
})

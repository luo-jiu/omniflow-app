import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import type { DeepSearchRuntimeScope } from '../../cat-catch-port/deep-search/runtime'
import {
  createDeepSearchPageAdapterBodySource,
  type DeepSearchPageAdapter,
} from './deep-search-page'

type WorkerListener = (event: {
  data?: unknown
  stopImmediatePropagation: () => void
}) => void

class FakeWorker {
  static instances: FakeWorker[] = []

  private readonly listeners = new Map<string, WorkerListener[]>()
  readonly terminate = vi.fn()

  constructor(readonly scriptUrl: string) {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, data?: unknown) {
    const event = { data, stopImmediatePropagation: vi.fn() }
    for (const listener of this.listeners.get(type) || []) listener(event)
    return event
  }
}

class FakeXhr {
  static synchronousResponseText = ''

  private readonly listeners = new Map<string, Array<() => void>>()
  response: unknown = ''
  responseText = ''
  responseType = ''
  responseURL = ''
  status = 0

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  open(_method: string, url: string | URL) {
    this.responseURL = String(url)
  }

  send() {
    if (!FakeXhr.synchronousResponseText) return
    this.status = 200
    this.response = FakeXhr.synchronousResponseText
    this.responseText = FakeXhr.synchronousResponseText
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) || []) listener()
  }
}

function createScope() {
  FakeWorker.instances = []
  FakeXhr.synchronousResponseText = ''
  let blobIndex = 0
  let timerIndex = 0
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
      createObjectURL: vi.fn(() => `blob:deep-page-${++blobIndex}`),
      revokeObjectURL: vi.fn(),
    },
    Uint16Array,
    Uint32Array,
    Uint8Array,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    atob,
    btoa,
    clearTimeout: vi.fn(),
    escape,
    fetch: vi.fn(),
    location: {
      href: 'https://page.example/watch/index.html',
      protocol: 'https:',
    },
    setTimeout: vi.fn(() => ++timerIndex),
  }
  return scope as unknown as DeepSearchRuntimeScope
}

function executeTargetBody(input: {
  captures: Array<Record<string, unknown>>
  generated: Array<Record<string, unknown>>
  materialized: Array<Record<string, unknown>>
  scope: DeepSearchRuntimeScope
}) {
  const document = {
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => [{
      textContent: 'const source = "//inline.example/live/master.m3u8?token=1";',
    }]),
    readyState: 'complete',
    removeEventListener: vi.fn(),
  }
  let materializedIndex = 0
  const factory = Function(
    'consumeWorkerRelayMessage',
    'createProbeBlobResource',
    'document',
    'emit',
    'emitGeneratedResource',
    'globalScope',
    'textToBase64',
    'workerRelayKey',
    `${createDeepSearchPageAdapterBodySource()}
return globalScope.__OMNIFLOW_DEEP_SEARCH_PAGE_ADAPTER_V1__;`,
  )
  return factory(
    vi.fn(() => false),
    (payload: Record<string, unknown>) => {
      const resource = { ...payload, url: `blob:materialized-${++materializedIndex}` }
      input.materialized.push(resource)
      return resource
    },
    document,
    (payload: Record<string, unknown>) => input.captures.push(payload),
    (payload: Record<string, unknown>) => input.generated.push(payload),
    input.scope,
    (text: string) => Buffer.from(text).toString('base64'),
    '__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_RELAY__',
  ) as DeepSearchPageAdapter
}

function executeWorkerBootstrap(source: string) {
  const messages: unknown[] = []
  let blobIndex = 0
  class WorkerBlob {
    constructor(readonly parts: unknown[]) {}
  }
  class WorkerTextDecoder {
    decode(value?: ArrayBuffer) {
      return value ? Buffer.from(value).toString() : ''
    }
  }
  class WorkerUrl extends URL {
    static createObjectURL() {
      blobIndex += 1
      return `blob:worker-${blobIndex}`
    }

    static revokeObjectURL() {}
  }
  const context = {
    Blob: WorkerBlob,
    Request: class {
      method = 'GET'
      url = ''
    },
    TextDecoder: WorkerTextDecoder,
    URL: WorkerUrl,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    atob,
    btoa,
    clearTimeout: vi.fn(),
    escape,
    fetch: vi.fn(),
    location: {
      href: 'blob:deep-worker-document',
      protocol: 'blob:',
    },
    postMessage: (value: unknown) => messages.push(value),
    setTimeout: vi.fn(() => 1),
  }
  runInNewContext(source, context)
  return { context, messages }
}

describe('Deep search page adapter composition', () => {
  it('deep.page-adapter-composition', () => {
    const captures: Array<Record<string, unknown>> = []
    const generated: Array<Record<string, unknown>> = []
    const materialized: Array<Record<string, unknown>> = []
    const scope = createScope()
    const adapter = executeTargetBody({ captures, generated, materialized, scope })
    expect(scope.setTimeout).toHaveBeenCalledWith(expect.any(Function), 0)

    scope.JSON.parse(JSON.stringify({
      inline: '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST',
      media: 'https://cdn.example/video/main.mp4',
    }))
    adapter.scanInlineScripts()
    scope.btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, index) => index + 1)))

    expect(captures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: 'deep-json',
        url: 'https://cdn.example/video/main.mp4',
      }),
      expect.objectContaining({
        ext: 'm3u8',
        resourceType: 'deep-inline-script',
        url: 'https://inline.example/live/master.m3u8?token=1',
      }),
    ]))
    expect(generated).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'manifest',
        resourceType: 'deep-json',
      }),
      expect.objectContaining({
        kind: 'key',
        resourceType: 'deep-key-hook',
      }),
    ]))

    const vimeoUrl = 'https://vod.vimeocdn.com/exp=1/path/playlist.json?token=1'
    const xhr = new scope.XMLHttpRequest() as unknown as FakeXhr
    xhr.open('GET', vimeoUrl)
    xhr.status = 200
    xhr.responseURL = vimeoUrl
    xhr.response = {
      base_url: 'base/',
      source_url: 'https://cdn.example/vimeo/source.mp4',
      video: [{
        base_url: 'video/',
        bitrate: 900,
        codecs: 'avc1',
        duration: 4,
        height: 720,
        segments: [{ end: 4, start: 0, url: 'segment.m4s' }],
        width: 1280,
      }],
    }
    xhr.emit('readystatechange')
    expect(materialized).toHaveLength(1)
    expect(captures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: 'deep-xhr',
        url: 'https://cdn.example/vimeo/source.mp4',
      }),
    ]))
    expect(generated).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: 'deep-vimeo-master',
        signature: expect.stringContaining('blob:materialized-1'),
      }),
    ]))

    const generatedCount = generated.length
    const jsonManifestUrl = 'https://api.example/manifest-payload'
    const jsonManifestXhr = new scope.XMLHttpRequest() as unknown as FakeXhr
    jsonManifestXhr.open('GET', jsonManifestUrl)
    jsonManifestXhr.status = 200
    jsonManifestXhr.responseURL = jsonManifestUrl
    jsonManifestXhr.response = JSON.stringify({
      manifest: '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST',
    })
    jsonManifestXhr.emit('readystatechange')
    expect(generated).toHaveLength(generatedCount)
    expect(captures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ext: 'json',
        resourceType: 'deep-xhr',
        url: jsonManifestUrl,
      }),
    ]))

    adapter.dispose()
    expect(adapter.isDisposed()).toBe(true)
  })

  it('deep.page-worker-composition', () => {
    const captures: Array<Record<string, unknown>> = []
    const scope = createScope()
    const adapter = executeTargetBody({
      captures,
      generated: [],
      materialized: [],
      scope,
    })
    const probeWorker = FakeWorker.instances[0]!
    probeWorker.emit('message', '__OMNIFLOW_DEEP_SEARCH_WORKER_PROBE_V1__')
    FakeXhr.synchronousResponseText = 'self.originalWorkerLoaded = true;'
    new scope.Worker('https://worker.example/source.js')
    const pageWorker = FakeWorker.instances[1]!

    const { context, messages } = executeWorkerBootstrap(adapter.workerBootstrapSource)
    runInNewContext('JSON.parse(\'{"media":"https://worker.example/nested/video.mp4"}\')', context)
    expect(messages).toHaveLength(1)
    const relayEvent = pageWorker.emit('message', messages[0])

    expect(relayEvent.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(captures).toEqual([
      expect.objectContaining({
        resourceType: 'deep-json',
        url: 'https://worker.example/nested/video.mp4',
      }),
    ])
    adapter.dispose()
  })
})

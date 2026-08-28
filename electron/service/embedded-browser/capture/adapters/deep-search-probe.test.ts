import { createContext, runInContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import { createEmbeddedBrowserResourceProbeScript } from '../../../embeddedBrowserResourceProbe'
import { NetworkContextVault } from '../state/network-context-vault'
import { ResourceStateStore } from '../state/resource-state-store'
import {
  EmbeddedBrowserLifecycle,
  type EmbeddedBrowserLifecycleWebContents,
} from '../../shell/embedded-browser-lifecycle'
import {
  ElectronPageProbeEventAdapter,
  type ElectronPageProbeWebContents,
} from './electron-page-probe'
import { createDeepSearchTargetProbeScript } from './deep-search-probe'

type DidNavigateListener = (event: unknown, url: string) => void
type RenderProcessGoneListener = (event: unknown, details: { reason?: string }) => void
type DestroyedListener = () => void
type ConsoleMessageListener = Parameters<ElectronPageProbeWebContents['on']>[1]

class FakeWebContents implements EmbeddedBrowserLifecycleWebContents, ElectronPageProbeWebContents {
  private readonly consoleListeners = new Set<ConsoleMessageListener>()
  private readonly destroyedListeners = new Set<DestroyedListener>()
  private readonly navigateListeners = new Set<DidNavigateListener>()
  private readonly renderGoneListeners = new Set<RenderProcessGoneListener>()

  constructor(readonly id: number, private url: string) {}

  getURL() {
    return this.url
  }

  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  on(event: 'console-message', listener: ConsoleMessageListener): unknown
  on(
    event: 'console-message' | 'did-navigate' | 'render-process-gone',
    listener: ConsoleMessageListener | DidNavigateListener | RenderProcessGoneListener,
  ) {
    if (event === 'console-message') this.consoleListeners.add(listener as ConsoleMessageListener)
    if (event === 'did-navigate') this.navigateListeners.add(listener as DidNavigateListener)
    if (event === 'render-process-gone') {
      this.renderGoneListeners.add(listener as RenderProcessGoneListener)
    }
    return this
  }

  once(event: 'destroyed', listener: DestroyedListener) {
    if (event === 'destroyed') this.destroyedListeners.add(listener)
    return this
  }

  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  removeListener(event: 'destroyed', listener: DestroyedListener): unknown
  removeListener(event: 'console-message', listener: ConsoleMessageListener): unknown
  removeListener(
    event: 'console-message' | 'destroyed' | 'did-navigate' | 'render-process-gone',
    listener: ConsoleMessageListener | DestroyedListener | DidNavigateListener | RenderProcessGoneListener,
  ) {
    if (event === 'console-message') this.consoleListeners.delete(listener as ConsoleMessageListener)
    if (event === 'destroyed') this.destroyedListeners.delete(listener as DestroyedListener)
    if (event === 'did-navigate') this.navigateListeners.delete(listener as DidNavigateListener)
    if (event === 'render-process-gone') {
      this.renderGoneListeners.delete(listener as RenderProcessGoneListener)
    }
    return this
  }

  emitConsole(message: string) {
    for (const listener of this.consoleListeners) listener({}, 1, message, 1, this.url)
  }

  navigate(url: string) {
    this.url = url
    for (const listener of this.navigateListeners) listener({}, url)
  }
}

function executeTargetProbe(script: string, emitConsole: (message: string) => void) {
  let blobIndex = 0
  let timerIndex = 0
  const storage = new Map<string, string>()

  class FakeBlob {
    readonly size: number

    constructor(readonly parts: unknown[]) {
      this.size = parts.reduce<number>((total, part) => {
        if (typeof part === 'string') return total + Buffer.byteLength(part)
        if (part && typeof part === 'object' && 'byteLength' in part) {
          return total + Number((part as { byteLength?: unknown }).byteLength || 0)
        }
        return total
      }, 0)
    }
  }
  class FakeTextDecoder {
    decode(value?: ArrayBuffer) {
      return value ? Buffer.from(value).toString() : ''
    }
  }
  class FakeXhr {
    response: unknown = ''
    responseText = ''
    responseType = ''
    responseURL = ''
    status = 0

    addEventListener() {}
    open(_method: string, url: string | URL) { this.responseURL = String(url) }
    send() {}
  }
  class FakeWorker {
    addEventListener() {}
    terminate() {}
  }
  class BrowserUrl extends URL {
    static createObjectURL() {
      return `blob:target-probe-${++blobIndex}`
    }

    static revokeObjectURL() {}
  }

  const context = createContext({
    Blob: FakeBlob,
    Request,
    TextDecoder: FakeTextDecoder,
    TextEncoder,
    URL: BrowserUrl,
    Worker: FakeWorker,
    XMLHttpRequest: FakeXhr,
    atob,
    btoa,
    clearTimeout: vi.fn(),
    console: {
      info: (message: string) => emitConsole(message),
      log: vi.fn(),
    },
    document: {
      addEventListener: vi.fn(),
      documentElement: { outerHTML: '<html></html>' },
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      readyState: 'complete',
      removeEventListener: vi.fn(),
      title: 'Target probe fixture',
    },
    escape,
    fetch: vi.fn(),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    location: {
      href: 'https://page.example/watch/index.html',
      hostname: 'page.example',
      protocol: 'https:',
    },
    open: vi.fn(),
    setTimeout: vi.fn(() => ++timerIndex),
  })

  const result = runInContext(script, context)
  return {
    context,
    dispose: () => runInContext(
      'globalThis.__OMNIFLOW_DEEP_SEARCH_PAGE_ADAPTER_V1__?.dispose(); globalThis.__OMNIFLOW_DEEP_SEARCH_TOOLKIT_ADAPTER_V1__?.dispose()',
      context,
    ),
    inspect: (value: unknown) => runInContext(
      `JSON.parse(${JSON.stringify(JSON.stringify(value))})`,
      context,
    ),
    result,
  }
}

describe('Deep search target probe template', () => {
  it('deep.probe-template-ingress', () => {
    let resourceIndex = 0
    const store = new ResourceStateStore({
      createResourceId: () => `resource-${++resourceIndex}`,
    })
    const lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: () => {},
      store,
      vault: new NetworkContextVault(),
    })
    const webContents = new FakeWebContents(73, 'https://page.example/start')
    lifecycle.registerView({ tabId: 'tab-target-probe', webContents })
    lifecycle.setCaptureMode('tab-target-probe', 'deep')
    const documentTokens = [
      'target_probe_current_token_0001',
      'target_probe_next_token_0000002',
    ]
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: () => documentTokens.shift() || '',
      lifecycle,
      tabId: 'tab-target-probe',
      webContents,
    })
    const currentDocument = adapter.bindCurrentDocument()!
    const document = adapter.prepareNextDocument()!
    expect(document.consolePrefix).not.toBe(currentDocument.consolePrefix)
    webContents.navigate('https://page.example/watch/index.html')
    expect(createEmbeddedBrowserResourceProbeScript({
      consolePrefix: document.consolePrefix,
    })).not.toContain('__OMNIFLOW_DEEP_SEARCH_PAGE_ADAPTER_V1__')
    const targetProbeScript = createDeepSearchTargetProbeScript({
      consolePrefix: document.consolePrefix,
    })
    expect(targetProbeScript).toContain('__OMNIFLOW_DEEP_SEARCH_PAGE_ADAPTER_V1__')
    const target = executeTargetProbe(
      targetProbeScript,
      message => webContents.emitConsole(message),
    )

    expect(target.result).toBe('installed')
    target.inspect({
      manifest: '#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST',
      media: 'https://cdn.example/video/main.mp4',
    })

    const snapshot = store.getSnapshot('tab-target-probe')
    expect(snapshot).toMatchObject({
      captureMode: 'deep',
      status: 'active',
    })
    if (!snapshot || snapshot.status !== 'active') throw new Error('Expected active snapshot')
    expect(snapshot.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ext: 'm3u8',
        kind: 'manifest',
        resourceType: 'deep-json',
        source: 'probe',
        url: 'blob:target-probe-2',
      }),
      expect.objectContaining({
        ext: 'm3u8',
        kind: 'manifest',
        resourceType: 'deep-json',
        source: 'probe',
        url: 'blob:target-probe-3',
      }),
      expect.objectContaining({
        ext: 'mp4',
        kind: 'media',
        resourceType: 'deep-json',
        source: 'probe',
        url: 'https://cdn.example/video/main.mp4',
      }),
    ]))
    expect(resourceIndex).toBe(3)
    for (const resourceId of ['resource-1', 'resource-2', 'resource-3']) {
      expect(store.getOwnedResource('tab-target-probe', resourceId)).toMatchObject({
        capturedNavigationGeneration: 1,
      })
    }

    target.dispose()
    adapter.dispose()
    lifecycle.dispose()
  })

  it('deep.toolkit-probe-round-trip', () => {
    const store = new ResourceStateStore()
    const lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: () => {},
      store,
      vault: new NetworkContextVault(),
    })
    const webContents = new FakeWebContents(74, 'https://page.example/start')
    lifecycle.registerView({ tabId: 'tab-target-toolkit', webContents })
    lifecycle.setCaptureMode('tab-target-toolkit', 'deep')
    const documentTokens = [
      'target_toolkit_current_token_001',
      'target_toolkit_next_token_000002',
    ]
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: () => documentTokens.shift() || '',
      lifecycle,
      tabId: 'tab-target-toolkit',
      webContents,
    })
    adapter.bindCurrentDocument()
    const document = adapter.prepareNextDocument()!
    webContents.navigate('https://page.example/watch/index.html')
    const target = executeTargetProbe(
      createDeepSearchTargetProbeScript({ consolePrefix: document.consolePrefix }),
      message => webContents.emitConsole(message),
    )

    expect(target.result).toBe('installed')
    const toolkitState = runInContext(`
      globalThis.__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE_PROBE__.updateCatchToolkitState({
        autoDownloadOnComplete: true,
        manualFileName: '  target-probe-title  ',
        regexRule: 'episode-(\\\\d+)',
        selectorRule: '.episode-title',
        trimExtraMediaHeaders: true,
      })
    `, target.context) as Record<string, unknown>
    expect(toolkitState).toMatchObject({
      autoDownloadOnComplete: true,
      currentFileName: 'target-probe-title',
      manualFileName: '  target-probe-title  ',
      regexRule: 'episode-(\\d+)',
      selectorRule: '.episode-title',
      selectorWarning: '表达式暂时没有命中可用内容',
      trimExtraMediaHeaders: true,
    })
    expect(runInContext(`localStorage.getItem(
      'OmniflowCatchToolkit:autoDownloadOnComplete'
    )`, target.context)).toBe('checked')
    expect(runInContext(`localStorage.getItem(
      'OmniflowCatchToolkit:manualFileName'
    )`, target.context)).toBe('target-probe-title')
    expect(runInContext(`
      globalThis.__OMNIFLOW_DEEP_SEARCH_TOOLKIT_ADAPTER_V1__.getState()
        .trimExtraMediaHeaders
    `, target.context)).toBe(true)

    target.dispose()
    adapter.dispose()
    lifecycle.dispose()
  })
})

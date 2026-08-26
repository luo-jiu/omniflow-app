import { describe, expect, it } from 'vitest'

import type { ElectronNetworkWebRequestRegistrar } from '../capture/adapters/electron-network'
import { compileOmniFlowCaptureSettings } from '../capture/policy/omniflow-capture-policy'
import type { ResourceStateChange } from '../contracts/captured-resource'
import {
  EmbeddedBrowserCaptureRuntime,
  type EmbeddedBrowserCaptureWebContents,
} from './embedded-browser-capture-runtime'

type Listener<T> = ((details: T) => void) | null
type SendDetails = Parameters<
  NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onSendHeaders']>[0]>
>[0]
type ResponseDetails = Parameters<
  NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onResponseStarted']>[0]>
>[0]
type TerminalDetails = Parameters<
  NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onCompleted']>[0]>
>[0]
type DidNavigateListener = (event: unknown, url: string) => void
type RenderProcessGoneListener = (
  event: unknown,
  details: { reason?: string },
) => void
type DestroyedListener = () => void
type ConsoleMessageListener = (
  event: unknown,
  level: number,
  message: string,
  line: number,
  sourceId: string,
) => void

class FakeWebRequest implements ElectronNetworkWebRequestRegistrar {
  beforeRedirect: Listener<TerminalDetails> = null
  completed: Listener<TerminalDetails> = null
  errorOccurred: Listener<TerminalDetails> = null
  responseStarted: Listener<ResponseDetails> = null
  sendHeaders: Listener<SendDetails> = null

  onBeforeRedirect(listener: Listener<TerminalDetails>) {
    this.beforeRedirect = listener
  }

  onCompleted(listener: Listener<TerminalDetails>) {
    this.completed = listener
  }

  onErrorOccurred(listener: Listener<TerminalDetails>) {
    this.errorOccurred = listener
  }

  onResponseStarted(listener: Listener<ResponseDetails>) {
    this.responseStarted = listener
  }

  onSendHeaders(listener: Listener<SendDetails>) {
    this.sendHeaders = listener
  }
}

class FakeWebContents implements EmbeddedBrowserCaptureWebContents {
  private readonly consoleMessageListeners = new Set<ConsoleMessageListener>()
  private readonly destroyedListeners = new Set<DestroyedListener>()
  private readonly didNavigateListeners = new Set<DidNavigateListener>()
  private readonly renderProcessGoneListeners = new Set<RenderProcessGoneListener>()
  private url: string

  constructor(readonly id: number, url: string) {
    this.url = url
  }

  getURL() {
    return this.url
  }

  on(event: 'console-message', listener: ConsoleMessageListener): unknown
  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  on(
    event: 'console-message' | 'did-navigate' | 'render-process-gone',
    listener: ConsoleMessageListener | DidNavigateListener | RenderProcessGoneListener,
  ) {
    if (event === 'console-message') {
      this.consoleMessageListeners.add(listener as ConsoleMessageListener)
    } else if (event === 'did-navigate') {
      this.didNavigateListeners.add(listener as DidNavigateListener)
    } else {
      this.renderProcessGoneListeners.add(listener as RenderProcessGoneListener)
    }
    return this
  }

  once(event: 'destroyed', listener: DestroyedListener) {
    if (event === 'destroyed') this.destroyedListeners.add(listener)
    return this
  }

  removeListener(event: 'console-message', listener: ConsoleMessageListener): unknown
  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  removeListener(event: 'destroyed', listener: DestroyedListener): unknown
  removeListener(
    event: 'console-message' | 'did-navigate' | 'render-process-gone' | 'destroyed',
    listener: ConsoleMessageListener | DidNavigateListener | RenderProcessGoneListener | DestroyedListener,
  ) {
    if (event === 'console-message') {
      this.consoleMessageListeners.delete(listener as ConsoleMessageListener)
    } else if (event === 'did-navigate') {
      this.didNavigateListeners.delete(listener as DidNavigateListener)
    } else if (event === 'render-process-gone') {
      this.renderProcessGoneListeners.delete(listener as RenderProcessGoneListener)
    } else {
      this.destroyedListeners.delete(listener as DestroyedListener)
    }
    return this
  }

  emitConsole(message: string) {
    for (const listener of Array.from(this.consoleMessageListeners)) {
      listener({}, 1, message, 0, 'fixture')
    }
  }

  navigate(url: string) {
    this.url = url
    for (const listener of Array.from(this.didNavigateListeners)) listener({}, url)
  }

  destroy() {
    for (const listener of Array.from(this.destroyedListeners)) listener()
    this.destroyedListeners.clear()
  }

  get consoleListenerCount() {
    return this.consoleMessageListeners.size
  }
}

function sendDetails(id: number, webContentsId: number, url: string): SendDetails {
  return {
    id,
    method: 'GET',
    requestHeaders: {
      Authorization: 'Bearer runtime-secret',
      'X-Trace': 'public-trace',
    },
    resourceType: 'xhr',
    url,
    webContentsId,
  }
}

function responseDetails(id: number, webContentsId: number, url: string): ResponseDetails {
  return {
    id,
    method: 'GET',
    resourceType: 'xhr',
    responseHeaders: {
      'Content-Length': ['4096'],
      'Content-Type': ['video/mp4'],
    },
    statusCode: 200,
    url,
    webContentsId,
  }
}

describe('EmbeddedBrowserCaptureRuntime', () => {
  it('network.production-equivalent-composition owns one event chain and invalidates stale documents', () => {
    const changes: ResourceStateChange[] = []
    const webRequest = new FakeWebRequest()
    let contextIndex = 0
    let documentIndex = 0
    let resourceIndex = 0
    const runtime = new EmbeddedBrowserCaptureRuntime({
      createDocumentToken: () => `document_token_${String(++documentIndex).padStart(16, '0')}`,
      emitChange: change => changes.push(change),
      fetch: async () => new Response('fixture'),
      networkContextOptions: {
        createContextRef: () => `context-${++contextIndex}`,
      },
      resourceStateOptions: {
        createResourceId: () => `resource-${++resourceIndex}`,
      },
      webRequest,
    })
    const firstView = new FakeWebContents(41, 'https://page.example/watch/one')

    expect(runtime.registerView({ tabId: 'tab-1', webContents: firstView })).toMatchObject({
      navigationGeneration: 0,
      tabId: 'tab-1',
      webContentsId: 41,
    })
    expect(firstView.consoleListenerCount).toBe(1)
    expect(runtime.bindProbeDocument('tab-1')).toBeNull()
    runtime.setCaptureMode('tab-1', 'network')
    expect(runtime.bindProbeDocument('tab-1')).toBeNull()
    expect(runtime.prepareNextProbeDocument('tab-1')).toBeNull()

    const resourceUrl = 'https://cdn.example/resource?id=1'
    webRequest.sendHeaders?.(sendDetails(1, 41, resourceUrl))
    webRequest.responseStarted?.(responseDetails(1, 41, resourceUrl))

    const networkSnapshot = runtime.getSnapshot('tab-1')
    expect(networkSnapshot).toMatchObject({ captureMode: 'network', status: 'active' })
    if (networkSnapshot?.status !== 'active') throw new Error('Expected active resource state')
    expect(networkSnapshot.resources).toHaveLength(1)
    const networkResource = networkSnapshot.resources[0]
    expect(JSON.stringify(networkResource)).not.toContain('runtime-secret')
    expect(networkResource.context).toEqual({
      hasAuthorization: true,
      hasCookie: false,
      headerNames: ['authorization'],
    })
    expect(runtime.access.redeem({
      purpose: 'external-tool',
      resourceId: networkResource.id,
      tabId: 'tab-1',
    })?.headers).toContainEqual(['authorization', 'Bearer runtime-secret'])

    runtime.setCaptureMode('tab-1', 'deep')
    const firstDocument = runtime.bindProbeDocument('tab-1')
    const nextDocument = runtime.prepareNextProbeDocument('tab-1')
    expect(firstDocument?.script).toContain(firstDocument?.consolePrefix)
    expect(nextDocument?.consolePrefix).not.toBe(firstDocument?.consolePrefix)
    firstView.emitConsole(`${firstDocument?.consolePrefix}${JSON.stringify({
      kind: 'media',
      resourceKey: 'mse-video',
      resourceType: 'mse-stream',
      url: 'blob:https://page.example/video',
    })}`)
    expect(runtime.getSnapshot('tab-1')).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ source: 'probe', url: 'blob:https://page.example/video' }),
      ]),
    })

    firstView.navigate('https://page.example/watch/two')
    expect(runtime.getSnapshot('tab-1')).toMatchObject({ resources: [] })
    firstView.emitConsole(`${firstDocument?.consolePrefix}${JSON.stringify({
      resourceKey: 'stale-resource',
      url: 'https://cdn.example/stale.mp4',
    })}`)
    expect(runtime.getSnapshot('tab-1')).toMatchObject({ resources: [] })

    const secondDocument = runtime.bindProbeDocument('tab-1')
    expect(secondDocument).toEqual(nextDocument)
    firstView.emitConsole(`${secondDocument?.consolePrefix}${JSON.stringify({
      resourceKey: 'current-resource',
      url: 'https://cdn.example/current.mp4',
    })}`)
    expect(runtime.getSnapshot('tab-1')).toMatchObject({
      resources: [expect.objectContaining({ url: 'https://cdn.example/current.mp4' })],
    })

    const replacementView = new FakeWebContents(42, 'https://page.example/watch/three')
    runtime.registerView({ tabId: 'tab-1', webContents: replacementView })
    expect(firstView.consoleListenerCount).toBe(0)
    expect(replacementView.consoleListenerCount).toBe(1)
    expect(runtime.getSnapshot('tab-1')).toMatchObject({ captureMode: 'off', resources: [] })

    replacementView.destroy()
    expect(replacementView.consoleListenerCount).toBe(0)
    expect(runtime.getSnapshot('tab-1')).toMatchObject({ status: 'disposed' })
    expect(changes.some(change => change.type === 'upsert')).toBe(true)

    runtime.dispose()
    expect(webRequest.sendHeaders).toBeNull()
    expect(webRequest.responseStarted).toBeNull()
    expect(webRequest.beforeRedirect).toBeNull()
    expect(webRequest.completed).toBeNull()
    expect(webRequest.errorOccurred).toBeNull()
  })

  it('refreshes capture settings without replacing the owned webRequest listeners', () => {
    const webRequest = new FakeWebRequest()
    let resourceIndex = 0
    const runtime = new EmbeddedBrowserCaptureRuntime({
      captureSettings: compileOmniFlowCaptureSettings({
        extensions: [],
        mimeTypes: [],
        regexRules: [],
      }),
      emitChange: () => {},
      fetch: async () => new Response('fixture'),
      resourceStateOptions: {
        createResourceId: () => `resource-${++resourceIndex}`,
      },
      webRequest,
    })
    runtime.registerView({
      tabId: 'tab-settings',
      webContents: new FakeWebContents(51, 'https://page.example/watch'),
    })
    runtime.setCaptureMode('tab-settings', 'network')

    const firstSendListener = webRequest.sendHeaders
    const firstResponseListener = webRequest.responseStarted
    const blockedUrl = 'https://cdn.example/blocked.mp4'
    webRequest.sendHeaders?.(sendDetails(1, 51, blockedUrl))
    webRequest.responseStarted?.(responseDetails(1, 51, blockedUrl))
    expect(runtime.getSnapshot('tab-settings')).toMatchObject({ resources: [] })

    expect(runtime.updateCaptureSettings(compileOmniFlowCaptureSettings({
      extensions: ['mp4'],
      mimeTypes: [],
      regexRules: [],
    }))).toBe(true)
    expect(webRequest.sendHeaders).toBe(firstSendListener)
    expect(webRequest.responseStarted).toBe(firstResponseListener)

    const allowedUrl = 'https://cdn.example/allowed.mp4'
    webRequest.sendHeaders?.(sendDetails(2, 51, allowedUrl))
    webRequest.responseStarted?.(responseDetails(2, 51, allowedUrl))
    expect(runtime.getSnapshot('tab-settings')).toMatchObject({
      resources: [expect.objectContaining({ url: allowedUrl })],
    })
    runtime.dispose()
  })

  it('network.opaque-probe-resource-resolution resolves a current probe resource id to its main-only page key', () => {
    const webRequest = new FakeWebRequest()
    let resourceIndex = 0
    const runtime = new EmbeddedBrowserCaptureRuntime({
      createDocumentToken: () => 'document_token_for_probe_resolution',
      emitChange: () => {},
      fetch: async () => new Response('fixture'),
      resourceStateOptions: {
        createResourceId: () => `resource-${++resourceIndex}`,
      },
      webRequest,
    })
    const view = new FakeWebContents(61, 'https://page.example/watch/one')
    runtime.registerView({
      clearResourcesOnNavigation: false,
      tabId: 'tab-probe',
      webContents: view,
    })
    runtime.setCaptureMode('tab-probe', 'deep')
    const document = runtime.bindProbeDocument('tab-probe')
    view.emitConsole(`${document?.consolePrefix}${JSON.stringify({
      kind: 'media',
      resourceKey: 'mse-video-main-only',
      resourceType: 'mse-stream',
      url: 'blob:https://page.example/video',
    })}`)

    const snapshot = runtime.getSnapshot('tab-probe')
    if (snapshot?.status !== 'active') throw new Error('Expected active resource state')
    const resourceId = snapshot.resources[0]?.id || ''
    expect(runtime.resolvePageResourceKey('tab-probe', resourceId)).toBe('mse-video-main-only')
    expect(runtime.resolvePageResourceKey('another-tab', resourceId)).toBeNull()

    view.navigate('https://page.example/watch/two')
    expect(runtime.getSnapshot('tab-probe')).toMatchObject({
      resources: [expect.objectContaining({ id: resourceId })],
    })
    expect(runtime.resolvePageResourceKey('tab-probe', resourceId)).toBeNull()
    runtime.dispose()
    expect(runtime.resolvePageResourceKey('tab-probe', resourceId)).toBeNull()
  })
})

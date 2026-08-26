import { describe, expect, it } from 'vitest'

import { ElectronNetworkCaptureAdapter } from '../capture/adapters/electron-network'
import type { ElectronNetworkWebRequestRegistrar } from '../capture/adapters/electron-network'
import { NetworkContextVault } from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import type { ResourceStateChange } from '../contracts/captured-resource'
import {
  EmbeddedBrowserLifecycle,
  type EmbeddedBrowserLifecycleWebContents,
} from './embedded-browser-lifecycle'

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

class FakeWebContents implements EmbeddedBrowserLifecycleWebContents {
  private readonly destroyedListeners = new Set<DestroyedListener>()
  private readonly didNavigateListeners = new Set<DidNavigateListener>()
  private readonly renderProcessGoneListeners = new Set<RenderProcessGoneListener>()
  private readonly staleDestroyedListeners: DestroyedListener[] = []
  private readonly staleDidNavigateListeners: DidNavigateListener[] = []
  private readonly staleRenderProcessGoneListeners: RenderProcessGoneListener[] = []
  private url: string

  constructor(readonly id: number, url: string) {
    this.url = url
  }

  getURL() {
    return this.url
  }

  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  on(
    event: 'did-navigate' | 'render-process-gone',
    listener: DidNavigateListener | RenderProcessGoneListener,
  ) {
    if (event === 'did-navigate') {
      const didNavigateListener = listener as DidNavigateListener
      this.didNavigateListeners.add(didNavigateListener)
      this.staleDidNavigateListeners.push(didNavigateListener)
    } else {
      const renderProcessGoneListener = listener as RenderProcessGoneListener
      this.renderProcessGoneListeners.add(renderProcessGoneListener)
      this.staleRenderProcessGoneListeners.push(renderProcessGoneListener)
    }
    return this
  }

  once(event: 'destroyed', listener: DestroyedListener) {
    if (event === 'destroyed') {
      this.destroyedListeners.add(listener)
      this.staleDestroyedListeners.push(listener)
    }
    return this
  }

  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  removeListener(event: 'destroyed', listener: DestroyedListener): unknown
  removeListener(
    event: 'did-navigate' | 'render-process-gone' | 'destroyed',
    listener: DidNavigateListener | RenderProcessGoneListener | DestroyedListener,
  ) {
    if (event === 'did-navigate') {
      this.didNavigateListeners.delete(listener as DidNavigateListener)
    } else if (event === 'render-process-gone') {
      this.renderProcessGoneListeners.delete(listener as RenderProcessGoneListener)
    } else {
      this.destroyedListeners.delete(listener as DestroyedListener)
    }
    return this
  }

  navigate(url: string) {
    this.url = url
    for (const listener of this.didNavigateListeners) listener({}, url)
  }

  crash() {
    for (const listener of this.renderProcessGoneListeners) {
      listener({}, { reason: 'crashed' })
    }
  }

  destroy() {
    const listeners = Array.from(this.destroyedListeners)
    this.destroyedListeners.clear()
    for (const listener of listeners) listener()
  }

  emitStaleCallbacks(url = 'https://stale.example/late') {
    for (const listener of this.staleDidNavigateListeners) listener({}, url)
    for (const listener of this.staleRenderProcessGoneListeners) {
      listener({}, { reason: 'crashed' })
    }
    for (const listener of this.staleDestroyedListeners) listener()
  }
}

function sendDetails(
  webContentsId: number,
  id: number,
  url: string,
): SendDetails {
  return {
    id,
    method: 'GET',
    requestHeaders: {
      Authorization: `Bearer secret-${id}`,
    },
    resourceType: 'xhr',
    url,
    webContentsId,
  }
}

function responseDetails(
  webContentsId: number,
  id: number,
  url: string,
): ResponseDetails {
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

function createHarness() {
  const changes: ResourceStateChange[] = []
  const disposalOrder: string[] = []
  let contextIndex = 0
  let resourceIndex = 0
  const vault = new NetworkContextVault({
    createContextRef: () => `context-${++contextIndex}`,
  })
  const store = new ResourceStateStore({
    createResourceId: () => `resource-${++resourceIndex}`,
    releaseContext: contextRef => vault.release(contextRef),
  })
  const lifecycle = new EmbeddedBrowserLifecycle({
    emitChange: (change) => {
      changes.push(change)
      if (change.type === 'reset' && change.cause === 'app-dispose') {
        disposalOrder.push('state-dispose')
      }
    },
    store,
    vault,
  })
  const webRequest = new FakeWebRequest()
  const adapter = new ElectronNetworkCaptureAdapter({
    emitChange: change => changes.push(change),
    resolveBindingByWebContentsId: webContentsId => (
      lifecycle.resolveBindingByWebContentsId(webContentsId)
    ),
    resolvePageUrlByWebContentsId: webContentsId => (
      lifecycle.resolvePageUrlByWebContentsId(webContentsId)
    ),
    store,
    vault,
    webRequest,
  })
  lifecycle.attachNetworkAdapter({
    dispose: () => {
      disposalOrder.push('adapter-dispose')
      adapter.dispose()
    },
    sweepExpired: () => adapter.sweepExpired(),
  })
  return {
    changes,
    disposalOrder,
    lifecycle,
    store,
    vault,
    webRequest,
  }
}

function captureResource(
  harness: ReturnType<typeof createHarness>,
  webContentsId: number,
  id: number,
  url: string,
) {
  harness.webRequest.sendHeaders!(sendDetails(webContentsId, id, url))
  harness.webRequest.responseStarted!(responseDetails(webContentsId, id, url))
}

describe('lifecycle.navigation-close-exit-crash', () => {
  it('composes navigation, context, state, adapter, close, crash, and exit ownership', () => {
    const harness = createHarness()
    const webContents = new FakeWebContents(41, 'https://page.example/watch/one')
    const firstBinding = harness.lifecycle.registerView({
      tabId: 'tab-1',
      webContents,
    })!
    harness.lifecycle.setCaptureMode('tab-1', 'network')
    captureResource(harness, 41, 1, 'https://media.example/one.mp4')

    const firstResource = harness.store.getOwnedResource('tab-1', 'resource-1')!
    expect(firstResource.contextRef).toBe('context-1')
    webContents.navigate('https://page.example/watch/two')
    expect(harness.store.getSnapshot('tab-1')).toMatchObject({
      captureMode: 'network',
      resources: [],
      status: 'active',
    })
    expect(harness.vault.release(firstResource.contextRef!)).toBe(false)
    expect(harness.lifecycle.resolveBindingByWebContentsId(41)).toMatchObject({
      incarnation: firstBinding.incarnation,
      navigationGeneration: 1,
    })

    captureResource(harness, 41, 2, 'https://media.example/two.mp4')
    const retainedNavigation = harness.lifecycle.commitNavigation({
      clearResources: false,
      pageUrl: 'https://page.example/watch/three',
      tabId: 'tab-1',
      webContentsId: 41,
    })!
    expect(retainedNavigation.change).toBeNull()
    expect(retainedNavigation.binding.navigationGeneration).toBe(2)
    expect(harness.store.getSnapshot('tab-1')).toMatchObject({
      resources: [{
        id: 'resource-2',
        url: 'https://media.example/two.mp4',
      }],
    })
    const retainedResource = harness.store.getSnapshot('tab-1')
    expect(retainedResource?.status === 'active'
      ? retainedResource.resources[0]?.context
      : 'disposed').toBeUndefined()

    harness.webRequest.sendHeaders!(sendDetails(
      41,
      3,
      'https://media.example/crash-pending.mp4',
    ))
    const changeCountBeforeCrash = harness.changes.length
    webContents.crash()
    expect(harness.changes).toHaveLength(changeCountBeforeCrash + 1)
    expect(harness.lifecycle.resolveBindingByWebContentsId(41)).toBeNull()
    webContents.crash()
    expect(harness.changes).toHaveLength(changeCountBeforeCrash + 1)
    harness.webRequest.responseStarted!(responseDetails(
      41,
      3,
      'https://media.example/crash-pending.mp4',
    ))
    expect(harness.store.getSnapshot('tab-1')).toMatchObject({ resources: [] })

    webContents.navigate('https://page.example/watch/recovered')
    expect(harness.lifecycle.resolveBindingByWebContentsId(41)).not.toBeNull()
    captureResource(harness, 41, 4, 'https://media.example/recovered.mp4')
    expect(harness.store.getSnapshot('tab-1')).toMatchObject({
      resources: [{ id: 'resource-3' }],
    })

    expect(harness.lifecycle.closeTab('tab-1')).toBe(true)
    const closeChangeCount = harness.changes.length
    expect(harness.lifecycle.closeTab('tab-1')).toBe(false)
    webContents.emitStaleCallbacks()
    expect(harness.changes).toHaveLength(closeChangeCount)
    expect(harness.store.getSnapshot('tab-1')).toMatchObject({ status: 'disposed' })

    harness.lifecycle.registerView({
      tabId: 'tab-2',
      webContents: new FakeWebContents(42, 'https://page.example/two'),
    })
    harness.lifecycle.registerView({
      tabId: 'tab-3',
      webContents: new FakeWebContents(43, 'https://page.example/three'),
    })
    expect(harness.lifecycle.closeAll()).toBe(2)
    expect(harness.lifecycle.closeAll()).toBe(0)

    harness.lifecycle.registerView({
      tabId: 'tab-exit',
      webContents: new FakeWebContents(44, 'https://page.example/exit'),
    })
    harness.disposalOrder.length = 0
    harness.lifecycle.dispose()
    harness.lifecycle.dispose()
    expect(harness.disposalOrder).toEqual(['adapter-dispose', 'state-dispose'])
    expect(harness.webRequest).toMatchObject({
      beforeRedirect: null,
      completed: null,
      errorOccurred: null,
      responseStarted: null,
      sendHeaders: null,
    })
    expect(harness.store.getSnapshot('tab-exit')).toMatchObject({ status: 'disposed' })
  })
})

describe('lifecycle.spontaneous-view-destroy', () => {
  it('replaces view incarnations and ignores every late callback from the old owner', () => {
    const harness = createHarness()
    const oldWebContents = new FakeWebContents(51, 'https://page.example/old')
    const oldBinding = harness.lifecycle.registerView({
      tabId: 'tab-replaced',
      webContents: oldWebContents,
    })!
    harness.lifecycle.setCaptureMode('tab-replaced', 'network')
    captureResource(harness, 51, 10, 'https://media.example/old.mp4')

    const newWebContents = new FakeWebContents(52, 'https://page.example/new')
    const newBinding = harness.lifecycle.registerView({
      tabId: 'tab-replaced',
      webContents: newWebContents,
    })!
    expect(newBinding.incarnation).toBeGreaterThan(oldBinding.incarnation)
    expect(harness.store.getSnapshot('tab-replaced')).toMatchObject({
      captureMode: 'off',
      incarnation: newBinding.incarnation,
      resources: [],
      status: 'active',
    })
    expect(harness.lifecycle.resolveBindingByWebContentsId(51)).toBeNull()
    expect(harness.lifecycle.resolveBindingByWebContentsId(52)).toEqual(newBinding)

    const replacementChangeCount = harness.changes.length
    oldWebContents.emitStaleCallbacks()
    expect(harness.changes).toHaveLength(replacementChangeCount)
    expect(harness.store.getSnapshot('tab-replaced')).toMatchObject({
      incarnation: newBinding.incarnation,
      status: 'active',
    })

    newWebContents.destroy()
    const destroyChangeCount = harness.changes.length
    expect(harness.store.getSnapshot('tab-replaced')).toMatchObject({
      incarnation: newBinding.incarnation,
      status: 'disposed',
    })
    newWebContents.emitStaleCallbacks()
    expect(harness.changes).toHaveLength(destroyChangeCount)
    expect(harness.lifecycle.disposeWebContents(52)).toBe(false)

    const directWebContents = new FakeWebContents(53, 'https://page.example/direct')
    harness.lifecycle.registerView({ tabId: 'tab-direct', webContents: directWebContents })
    expect(harness.lifecycle.disposeWebContents(53)).toBe(true)
    const directDisposeChangeCount = harness.changes.length
    directWebContents.emitStaleCallbacks()
    expect(harness.changes).toHaveLength(directDisposeChangeCount)
    expect(harness.store.getSnapshot('tab-direct')).toMatchObject({ status: 'disposed' })

    harness.lifecycle.dispose()
  })
})

describe('lifecycle.probe-document-binding', () => {
  it('invalidates document-bound probe ingress across navigation, crash, replacement, and close', () => {
    const harness = createHarness()
    const firstWebContents = new FakeWebContents(61, 'https://page.example/first')
    harness.lifecycle.registerView({
      tabId: 'tab-probe',
      webContents: firstWebContents,
    })
    harness.lifecycle.setCaptureMode('tab-probe', 'deep')
    const firstProbe = harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 61,
    })!
    expect(firstProbe.capture({
      ext: 'mp4',
      resourceKey: 'probe-first',
      url: 'blob:https://page.example/first-media',
    })).toMatchObject({
      decision: 'accepted',
      resource: { id: 'resource-1', source: 'probe' },
    })

    firstWebContents.navigate('https://page.example/second')
    expect(firstProbe.capture({
      resourceKey: 'probe-late',
      url: 'https://cdn.example/late.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    const secondProbe = harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 61,
    })!
    expect(secondProbe.capture({
      resourceKey: 'probe-second',
      url: 'https://cdn.example/second.mp4',
    })).toMatchObject({
      decision: 'accepted',
      resource: { id: 'resource-2' },
    })

    firstWebContents.crash()
    expect(secondProbe.capture({
      resourceKey: 'probe-after-crash',
      url: 'https://cdn.example/crashed.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    expect(harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 61,
    })).toBeNull()

    firstWebContents.navigate('https://page.example/recovered')
    const recoveredProbe = harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 61,
    })!
    const replacementWebContents = new FakeWebContents(62, 'https://page.example/replaced')
    harness.lifecycle.registerView({
      tabId: 'tab-probe',
      webContents: replacementWebContents,
    })
    expect(recoveredProbe.capture({
      resourceKey: 'probe-replaced-late',
      url: 'https://cdn.example/replaced-late.mp4',
    })).toMatchObject({ decision: 'stale-binding' })

    harness.lifecycle.setCaptureMode('tab-probe', 'deep')
    const replacementProbe = harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 62,
    })!
    expect(replacementProbe.capture({
      resourceKey: 'probe-replacement',
      url: 'https://cdn.example/replacement.mp4',
    })).toMatchObject({
      decision: 'accepted',
      resource: { id: 'resource-3' },
    })
    harness.lifecycle.closeTab('tab-probe')
    expect(replacementProbe.capture({
      resourceKey: 'probe-after-close',
      url: 'https://cdn.example/closed.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    expect(harness.lifecycle.bindProbeCapture({
      tabId: 'tab-probe',
      webContentsId: 62,
    })).toBeNull()

    harness.lifecycle.dispose()
  })
})

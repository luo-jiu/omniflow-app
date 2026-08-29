import { describe, expect, it } from 'vitest'

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

type DidNavigateListener = (event: unknown, url: string) => void
type RenderProcessGoneListener = (
  event: unknown,
  details: { reason?: string },
) => void
type DestroyedListener = () => void
type ConsoleMessageListener = Parameters<ElectronPageProbeWebContents['on']>[1]

class FakeWebContents implements EmbeddedBrowserLifecycleWebContents, ElectronPageProbeWebContents {
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

  on(event: 'did-navigate', listener: DidNavigateListener): unknown
  on(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  on(event: 'console-message', listener: ConsoleMessageListener): unknown
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

  removeListener(event: 'did-navigate', listener: DidNavigateListener): unknown
  removeListener(event: 'render-process-gone', listener: RenderProcessGoneListener): unknown
  removeListener(event: 'destroyed', listener: DestroyedListener): unknown
  removeListener(event: 'console-message', listener: ConsoleMessageListener): unknown
  removeListener(
    event: 'console-message' | 'destroyed' | 'did-navigate' | 'render-process-gone',
    listener: ConsoleMessageListener | DestroyedListener | DidNavigateListener | RenderProcessGoneListener,
  ) {
    if (event === 'console-message') {
      this.consoleMessageListeners.delete(listener as ConsoleMessageListener)
    } else if (event === 'destroyed') {
      this.destroyedListeners.delete(listener as DestroyedListener)
    } else if (event === 'did-navigate') {
      this.didNavigateListeners.delete(listener as DidNavigateListener)
    } else {
      this.renderProcessGoneListeners.delete(listener as RenderProcessGoneListener)
    }
    return this
  }

  emitConsole(message: string) {
    for (const listener of this.consoleMessageListeners) {
      listener({}, 1, message, 1, this.url)
    }
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

  get consoleListenerCount() {
    return this.consoleMessageListeners.size
  }
}

describe('Deep search secure relay', () => {
  it('deep.relay-forgery', () => {
    let resourceIndex = 0
    const store = new ResourceStateStore({
      createResourceId: () => `resource-${++resourceIndex}`,
    })
    const lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: () => {},
      store,
      vault: new NetworkContextVault(),
    })
    const webContents = new FakeWebContents(70, 'https://page.example/current')
    lifecycle.registerView({ tabId: 'tab-forgery', webContents })
    lifecycle.setCaptureMode('tab-forgery', 'deep')
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: () => 'document_token_for_deep_relay',
      lifecycle,
      tabId: 'tab-forgery',
      webContents,
    })
    const document = adapter.bindCurrentDocument()!
    const validPayload = JSON.stringify({ url: 'https://cdn.example/accepted.mp4' })

    webContents.emitConsole(`__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:${validPayload}`)
    webContents.emitConsole(`__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:wrong_token:${validPayload}`)
    webContents.emitConsole(`${document.consolePrefix}{malformed`)
    webContents.emitConsole(`${document.consolePrefix}[]`)
    expect(resourceIndex).toBe(0)

    webContents.emitConsole(`${document.consolePrefix}${validPayload}`)
    expect(resourceIndex).toBe(1)
    expect(store.getOwnedResource('tab-forgery', 'resource-1')).toMatchObject({
      capturedNavigationGeneration: 0,
      url: 'https://cdn.example/accepted.mp4',
    })

    adapter.dispose()
    lifecycle.dispose()
  })
})

describe('network.probe-console-generation-routing', () => {
  it('routes only the current token and binding while preserving control payload separation', () => {
    let resourceIndex = 0
    const controlPayloads: Record<string, unknown>[] = []
    const errors: unknown[] = []
    const store = new ResourceStateStore({
      createResourceId: () => `resource-${++resourceIndex}`,
    })
    const lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: () => {},
      store,
      vault: new NetworkContextVault(),
    })
    const webContents = new FakeWebContents(71, 'https://page.example/first')
    lifecycle.registerView({ tabId: 'tab-probe', webContents })
    lifecycle.setCaptureMode('tab-probe', 'deep')
    const tokens = [
      'first_document_token_00000001',
      'next_document_token_000000002',
      'recovered_document_token_00003',
    ]
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: () => tokens.shift() || '',
      lifecycle,
      onControlPayload: (payload) => {
        controlPayloads.push(payload)
        if (payload.resourceKey === 'mse:throw') throw new Error('control failed')
      },
      onError: error => errors.push(error),
      tabId: 'tab-probe',
      webContents,
    })

    const first = adapter.bindCurrentDocument()!
    expect(first.script).toContain(JSON.stringify(first.consolePrefix))
    expect(adapter.bindCurrentDocument()).toEqual(first)
    webContents.emitConsole('__OMNIFLOW_EMBEDDED_BROWSER_RESOURCE__:{"url":"https://forged.example/a.mp4"}')
    webContents.emitConsole(`${first.consolePrefix}{malformed`)
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      ext: 'mp4',
      resourceType: 'fetch',
      source: 'fetch',
      url: 'https://cdn.example/first.mp4',
    })}`)
    expect(store.getOwnedResource('tab-probe', 'resource-1')).toMatchObject({
      source: 'probe',
      url: 'https://cdn.example/first.mp4',
    })
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      base64: 'chunk',
      event: 'mse-flush',
      resourceKey: 'mse:1',
    })}`)
    expect(controlPayloads).toEqual([{
      base64: 'chunk',
      event: 'mse-flush',
      resourceKey: 'mse:1',
    }])
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      event: 'mse-complete',
      resourceKey: 'mse:1',
    })}`)
    expect(controlPayloads).toHaveLength(2)
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      event: 'mse-save',
      resourceKey: 'mse:1',
      streamType: 'video',
    })}`)
    expect(controlPayloads).toHaveLength(3)
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      event: 'unknown-control',
    })}`)
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      event: 'mse-reset',
      resourceKey: 'mse:throw',
    })}`)
    expect(controlPayloads).toHaveLength(4)
    expect(errors).toHaveLength(1)

    const nextDocument = adapter.prepareNextDocument()!
    expect(nextDocument.consolePrefix).not.toBe(first.consolePrefix)
    expect(adapter.prepareNextDocument()).toEqual(nextDocument)
    webContents.navigate('https://page.example/second')
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      ext: 'mp4',
      url: 'https://cdn.example/late.mp4',
    })}`)
    webContents.emitConsole(`${first.consolePrefix}${JSON.stringify({
      event: 'mse-reset',
      resourceKey: 'mse:1',
    })}`)
    expect(resourceIndex).toBe(1)
    expect(controlPayloads).toHaveLength(4)

    const second = adapter.bindCurrentDocument()!
    expect(second).toEqual(nextDocument)
    webContents.emitConsole(`${second.consolePrefix}${JSON.stringify({
      ext: 'vtt',
      url: 'https://cdn.example/second.vtt',
    })}`)
    expect(store.getOwnedResource('tab-probe', 'resource-2')).toMatchObject({
      kind: 'subtitle',
    })

    lifecycle.setCaptureMode('tab-probe', 'off')
    webContents.emitConsole(`${second.consolePrefix}${JSON.stringify({
      event: 'mse-reset',
      resourceKey: 'mse:stopped',
    })}`)
    webContents.emitConsole(`${second.consolePrefix}${JSON.stringify({
      url: 'https://cdn.example/stopped.mp4',
    })}`)
    expect(controlPayloads).toHaveLength(4)
    expect(resourceIndex).toBe(2)
    expect(adapter.bindCurrentDocument()).toBeNull()
    expect(adapter.prepareNextDocument()).toBeNull()

    webContents.crash()
    webContents.emitConsole(`${second.consolePrefix}${JSON.stringify({
      ext: 'mp4',
      url: 'https://cdn.example/crashed.mp4',
    })}`)
    expect(adapter.bindCurrentDocument()).toBeNull()
    expect(resourceIndex).toBe(2)

    webContents.navigate('https://page.example/recovered')
    lifecycle.setCaptureMode('tab-probe', 'deep')
    const recovered = adapter.bindCurrentDocument()!
    expect(recovered.consolePrefix).not.toBe(second.consolePrefix)
    adapter.dispose()
    adapter.dispose()
    expect(webContents.consoleListenerCount).toBe(0)
    webContents.emitConsole(`${recovered.consolePrefix}${JSON.stringify({
      ext: 'mp4',
      url: 'https://cdn.example/disposed.mp4',
    })}`)
    expect(resourceIndex).toBe(2)
    lifecycle.dispose()
  })

  it('network.probe-next-document-routing accepts a prepared document-start token after navigation', () => {
    let resourceIndex = 0
    const store = new ResourceStateStore({
      createResourceId: () => `resource-${++resourceIndex}`,
    })
    const lifecycle = new EmbeddedBrowserLifecycle({
      emitChange: () => {},
      store,
      vault: new NetworkContextVault(),
    })
    const webContents = new FakeWebContents(72, 'https://page.example/current')
    lifecycle.registerView({ tabId: 'tab-next', webContents })
    lifecycle.setCaptureMode('tab-next', 'deep')
    const tokens = ['current_document_token_000001', 'next_document_token_00000002']
    const adapter = new ElectronPageProbeEventAdapter({
      createDocumentToken: () => tokens.shift() || '',
      lifecycle,
      tabId: 'tab-next',
      webContents,
    })

    const currentDocument = adapter.bindCurrentDocument()!
    const nextDocument = adapter.prepareNextDocument()!
    webContents.navigate('https://page.example/next')
    webContents.emitConsole(`${currentDocument.consolePrefix}${JSON.stringify({
      url: 'https://cdn.example/stale.mp4',
    })}`)
    webContents.emitConsole(`${nextDocument.consolePrefix}${JSON.stringify({
      url: 'https://cdn.example/document-start.mp4',
    })}`)

    expect(resourceIndex).toBe(1)
    expect(store.getOwnedResource('tab-next', 'resource-1')).toMatchObject({
      capturedNavigationGeneration: 1,
      url: 'https://cdn.example/document-start.mp4',
    })
    expect(adapter.bindCurrentDocument()).toEqual(nextDocument)
    adapter.dispose()
    lifecycle.dispose()
  })
})

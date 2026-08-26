import { describe, expect, it } from 'vitest'

import { NetworkContextVault } from '../state/network-context-vault'
import { ResourceStateStore, type ResourceStateChange } from '../state/resource-state-store'
import {
  ElectronNetworkCaptureAdapter,
  type ElectronNetworkWebRequestRegistrar,
} from './electron-network'

type Listener<T> = ((details: T) => void) | null
type SendDetails = Parameters<NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onSendHeaders']>[0]>>[0]
type ResponseDetails = Parameters<NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onResponseStarted']>[0]>>[0]
type TerminalDetails = Parameters<NonNullable<Parameters<ElectronNetworkWebRequestRegistrar['onCompleted']>[0]>>[0]

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

function sendDetails(id: number, url: string, authorization = 'Bearer test-secret'): SendDetails {
  return {
    id,
    method: 'GET',
    requestHeaders: {
      Authorization: authorization,
      'X-Trace': 'not-protected',
    },
    resourceType: 'xhr',
    url,
    webContentsId: 41,
  }
}

function responseDetails(id: number, url: string): ResponseDetails {
  return {
    id,
    method: 'GET',
    resourceType: 'xhr',
    responseHeaders: {
      'Content-Length': ['4096'],
      'Content-Type': ['video/mp4; charset=binary'],
    },
    statusCode: 200,
    url,
    webContentsId: 41,
  }
}

function createHarness() {
  const changes: ResourceStateChange[] = []
  const pageUrls = new Map([[41, 'https://page.example/watch/one']])
  let contextIndex = 0
  let resourceIndex = 0
  const vault = new NetworkContextVault({
    createContextRef: () => `context-${++contextIndex}`,
  })
  const store = new ResourceStateStore({
    createResourceId: () => `resource-${++resourceIndex}`,
    releaseContext: contextRef => vault.release(contextRef),
  })
  const registration = store.registerTab({
    pageUrl: pageUrls.get(41),
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  store.setCaptureMode('tab-1', 'network')
  const webRequest = new FakeWebRequest()
  const adapter = new ElectronNetworkCaptureAdapter({
    emitChange: change => changes.push(change),
    resolveBindingByWebContentsId: webContentsId => (
      webContentsId === 41 ? store.getCaptureBinding('tab-1') : null
    ),
    resolvePageUrlByWebContentsId: webContentsId => pageUrls.get(webContentsId) || null,
    store,
    vault,
    webRequest,
  })
  return {
    adapter,
    changes,
    initialBinding: registration.binding,
    pageUrls,
    store,
    vault,
    webRequest,
  }
}

describe('network.first-byte-long-response', () => {
  it('publishes a classified resource at response start without waiting for completion', () => {
    const harness = createHarness()
    const url = 'https://media.example/long-response.mp4'

    harness.webRequest.sendHeaders!(sendDetails(1, url))
    expect(harness.changes).toEqual([])

    harness.webRequest.responseStarted!(responseDetails(1, url))
    expect(harness.changes).toHaveLength(1)
    expect(harness.changes[0]).toMatchObject({
      resources: [{
        contentLength: 4096,
        context: {
          hasAuthorization: true,
          hasCookie: false,
          headerNames: ['authorization'],
        },
        ext: 'mp4',
        kind: 'media',
        mimeType: 'video/mp4',
        source: 'network',
        statusCode: 200,
        url,
      }],
      type: 'upsert',
    })
    expect(JSON.stringify(harness.changes)).not.toContain('Bearer test-secret')

    const resource = harness.store.getOwnedResource('tab-1', 'resource-1')!
    expect(harness.vault.redeem({
      contextRef: resource.contextRef!,
      navigationGeneration: resource.capturedNavigationGeneration,
      pageOrigin: resource.capturedPageOrigin!,
      purpose: 'resource-download',
      replayResourceType: 'media',
      resourceUrl: resource.url,
      tabId: resource.tabId,
      webContentsId: resource.capturedWebContentsId,
    })).toEqual({
      headers: [['authorization', 'Bearer test-secret']],
      redirectMode: 'manual',
    })

    harness.webRequest.completed!({ id: 1, webContentsId: 41 })
    expect(harness.store.getOwnedResource('tab-1', 'resource-1')).not.toBeNull()
  })
})

describe('network.context-terminal-cleanup', () => {
  it('cleans every terminal path, binds redirect hops, rejects stale owners, and disposes listeners', () => {
    const harness = createHarness()

    const failedUrl = 'https://media.example/failed.mp4'
    harness.webRequest.sendHeaders!(sendDetails(2, failedUrl))
    harness.webRequest.errorOccurred!({ id: 2, webContentsId: 41 })
    expect(harness.vault.promoteRequest({
      navigationGeneration: harness.initialBinding.navigationGeneration,
      observedRequestUrl: failedUrl,
      purposes: ['resource-download'],
      requestId: 2,
      resourceUrl: failedUrl,
      sourceResourceType: 'xhr',
      tabId: harness.initialBinding.tabId,
      webContentsId: 41,
    })).toBeNull()
    harness.webRequest.responseStarted!(responseDetails(2, failedUrl))

    const completedUrl = 'https://media.example/completed-before-response.mp4'
    harness.webRequest.sendHeaders!(sendDetails(3, completedUrl))
    harness.webRequest.completed!({ id: 3, webContentsId: 41 })
    harness.webRequest.responseStarted!(responseDetails(3, completedUrl))
    expect(harness.changes).toEqual([])

    const firstHop = 'https://media.example/redirect-source.mp4'
    const secondHop = 'https://cdn.example/redirect-target.mp4'
    harness.webRequest.sendHeaders!(sendDetails(4, firstHop, 'Bearer first-hop'))
    harness.webRequest.beforeRedirect!({ id: 4, webContentsId: 41 })
    harness.webRequest.sendHeaders!(sendDetails(4, secondHop, 'Bearer second-hop'))
    harness.webRequest.responseStarted!(responseDetails(4, secondHop))
    expect(harness.changes).toHaveLength(1)
    expect(harness.store.getOwnedResource('tab-1', 'resource-1')?.url).toBe(secondHop)

    const staleUrl = 'https://media.example/stale-navigation.mp4'
    harness.webRequest.sendHeaders!(sendDetails(5, staleUrl))
    harness.store.commitNavigation({
      binding: harness.store.getCaptureBinding('tab-1')!,
      clearResources: false,
      pageUrl: 'https://page.example/watch/two',
    })
    harness.pageUrls.set(41, 'https://page.example/watch/two')
    harness.webRequest.responseStarted!(responseDetails(5, staleUrl))
    expect(harness.changes).toHaveLength(1)

    const retained = harness.store.getOwnedResource('tab-1', 'resource-1')!
    expect(harness.vault.release(retained.contextRef!)).toBe(true)
    expect(harness.changes).toHaveLength(2)
    expect(harness.changes[1]).toMatchObject({
      resources: [{ id: 'resource-1', url: secondHop }],
      type: 'upsert',
    })
    expect(harness.changes[1] && 'resources' in harness.changes[1]
      ? harness.changes[1].resources[0]?.context
      : 'unexpected').toBeUndefined()

    const disposedUrl = 'https://media.example/disposed.mp4'
    const disposedBinding = harness.store.getCaptureBinding('tab-1')!
    harness.webRequest.sendHeaders!(sendDetails(6, disposedUrl))
    harness.adapter.dispose()
    expect(harness.webRequest).toMatchObject({
      beforeRedirect: null,
      completed: null,
      errorOccurred: null,
      responseStarted: null,
      sendHeaders: null,
    })
    expect(harness.vault.promoteRequest({
      navigationGeneration: disposedBinding.navigationGeneration,
      observedRequestUrl: disposedUrl,
      purposes: ['resource-download'],
      requestId: 6,
      resourceUrl: disposedUrl,
      sourceResourceType: 'xhr',
      tabId: disposedBinding.tabId,
      webContentsId: 41,
    })).toBeNull()
    expect(() => harness.adapter.dispose()).not.toThrow()
  })
})

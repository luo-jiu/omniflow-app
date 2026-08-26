import { describe, expect, it, vi } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'
import {
  CapturedResourceDownloadService,
  CapturedResourcePageDragService,
  type CapturedResourceTransferRequest,
} from './captured-resource-transfer-consumers'

function createHarness() {
  const resourceUrl = 'https://media.example/video.mp4?public=1'
  const vault = new NetworkContextVault({
    createContextRef: () => 'context-main-only',
  })
  const store = new ResourceStateStore({
    createResourceId: () => 'resource-opaque',
    releaseContext: contextRef => vault.release(contextRef),
  })
  const registration = store.registerTab({
    pageUrl: 'https://page.example/watch/episode-1',
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  store.setCaptureMode('tab-1', 'network')
  expect(vault.recordRequest({
    navigationGeneration: registration.binding.navigationGeneration,
    observedRequestUrl: resourceUrl,
    pageOrigin: registration.binding.pageOrigin!,
    requestHeaders: {
      Authorization: 'Bearer main-owned-secret',
      Cookie: 'session=main-owned-secret',
      Referer: 'https://page.example/watch/episode-1',
      'X-Media-Token': 'main-owned-media-token',
    },
    requestId: 1,
    sourceResourceType: 'media',
    tabId: 'tab-1',
    webContentsId: 41,
  })).toBe(true)
  const context = vault.promoteRequest({
    navigationGeneration: registration.binding.navigationGeneration,
    observedRequestUrl: resourceUrl,
    purposes: NETWORK_CONTEXT_PURPOSES,
    requestId: 1,
    resourceUrl,
    sourceResourceType: 'media',
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  expect(store.recordNetworkResource({
    binding: registration.binding,
    context,
    metadata: {
      kind: 'media',
      mimeType: 'video/mp4',
      name: 'episode-1.mp4',
      resourceType: 'media',
      url: resourceUrl,
    },
  }).decision).toBe('accepted')

  const fetchCalls: Array<{ init: RequestInit; url: string }> = []
  const access = new CapturedResourceAccessService({
    fetch: async (url, init) => {
      fetchCalls.push({ init, url })
      return new Response(`body-${fetchCalls.length}`, {
        headers: { 'content-type': 'video/mp4' },
      })
    },
    store,
    vault,
  })
  const downloadSink = vi.fn(async ({ resource, response }) => ({
    body: await response.text(),
    resourceId: resource.id,
  }))
  const pageDragSink = vi.fn(async ({ resource, response }) => ({
    body: await response.text(),
    stagedResourceId: resource.id,
  }))
  return {
    binding: registration.binding,
    download: new CapturedResourceDownloadService({
      access,
      consume: downloadSink,
    }),
    downloadSink,
    fetchCalls,
    pageDrag: new CapturedResourcePageDragService({
      access,
      consume: pageDragSink,
    }),
    pageDragSink,
    resourceUrl,
    store,
    vault,
  }
}

describe('network.owned-resource-transfer-consumers', () => {
  it('opens downloads from main-owned URL and request context only', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    const untrustedRequest = {
      headers: { Authorization: 'Bearer renderer-injected-secret' },
      maxRedirects: Number.MAX_SAFE_INTEGER,
      outputPath: '/renderer/injected/path',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
      url: 'https://renderer-injected.example/video.mp4',
    } as CapturedResourceTransferRequest

    await expect(harness.download.download(untrustedRequest, {
      signal: controller.signal,
    })).resolves.toEqual({
      body: 'body-1',
      resourceId: 'resource-opaque',
    })

    expect(harness.fetchCalls).toHaveLength(1)
    expect(harness.fetchCalls[0]?.url).toBe(harness.resourceUrl)
    expect(harness.fetchCalls[0]?.init).toMatchObject({
      redirect: 'manual',
      signal: controller.signal,
    })
    expect(harness.fetchCalls[0]?.init.credentials).toBeUndefined()
    const headers = new Headers(harness.fetchCalls[0]?.init.headers)
    expect(headers.get('authorization')).toBe('Bearer main-owned-secret')
    expect(headers.get('cookie')).toBe('session=main-owned-secret')
    expect(headers.get('x-media-token')).toBe('main-owned-media-token')
    expect(JSON.stringify(harness.downloadSink.mock.calls)).not.toContain('renderer-injected')
  })

  it('stages page drags with the captured session cookie jar and no replayed Cookie header', async () => {
    const harness = createHarness()

    await expect(harness.pageDrag.stage({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).resolves.toEqual({
      body: 'body-1',
      stagedResourceId: 'resource-opaque',
    })

    expect(harness.fetchCalls).toHaveLength(1)
    expect(harness.fetchCalls[0]).toMatchObject({
      init: {
        credentials: 'include',
        redirect: 'manual',
      },
      url: harness.resourceUrl,
    })
    const headers = new Headers(harness.fetchCalls[0]?.init.headers)
    expect(headers.get('authorization')).toBe('Bearer main-owned-secret')
    expect(headers.has('cookie')).toBe(false)
  })

  it('cancels an unconsumed response body when the main sink fails', async () => {
    const harness = createHarness()
    const cancelled = vi.fn()
    const access = new CapturedResourceAccessService({
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        cancel: cancelled,
        start(controller) {
          controller.enqueue(new TextEncoder().encode('unconsumed'))
        },
      })),
      store: harness.store,
      vault: harness.vault,
    })
    const download = new CapturedResourceDownloadService({
      access,
      consume: async () => {
        throw new Error('download sink failed')
      },
    })

    await expect(download.download({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).rejects.toThrow('download sink failed')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('rejects invalid, cross-tab, and stale requests before either sink runs', async () => {
    const harness = createHarness()

    await expect(harness.download.download({
      resourceId: '',
      tabId: 'tab-1',
    })).rejects.toThrow('Captured resource transfer request is invalid')
    await expect(harness.pageDrag.stage({
      resourceId: 'resource-opaque',
      tabId: 'tab-2',
    })).rejects.toThrow('Captured resource access is unavailable or stale')

    expect(harness.store.commitNavigation({
      binding: harness.binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/episode-2',
    })?.change).toBeNull()
    await expect(harness.download.download({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).rejects.toThrow('Captured resource access is unavailable or stale')
    expect(harness.fetchCalls).toHaveLength(0)
    expect(harness.downloadSink).not.toHaveBeenCalled()
    expect(harness.pageDragSink).not.toHaveBeenCalled()
  })
})

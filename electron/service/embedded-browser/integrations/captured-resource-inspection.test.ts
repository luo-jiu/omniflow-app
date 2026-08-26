import { describe, expect, it, vi } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'
import {
  CapturedResourceInspectionService,
  type CapturedResourceInspectionRequest,
} from './captured-resource-inspection'

function createHarness(
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  maxBytes = 1024,
) {
  const resourceUrl = 'https://media.example/playlist.m3u8?public=1'
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
      'X-Manifest-Token': 'main-owned-manifest-token',
    },
    requestId: 1,
    sourceResourceType: 'xhr',
    tabId: 'tab-1',
    webContentsId: 41,
  })).toBe(true)
  const context = vault.promoteRequest({
    navigationGeneration: registration.binding.navigationGeneration,
    observedRequestUrl: resourceUrl,
    purposes: NETWORK_CONTEXT_PURPOSES,
    requestId: 1,
    resourceUrl,
    sourceResourceType: 'xhr',
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  expect(store.recordNetworkResource({
    binding: registration.binding,
    context,
    metadata: {
      kind: 'manifest',
      mimeType: 'application/vnd.apple.mpegurl',
      name: 'playlist.m3u8',
      resourceType: 'xhr',
      url: resourceUrl,
    },
  }).decision).toBe('accepted')

  const access = new CapturedResourceAccessService({
    fetch: fetchImpl,
    store,
    vault,
  })
  return {
    binding: registration.binding,
    inspection: new CapturedResourceInspectionService({ access, maxBytes }),
    resourceUrl,
    store,
  }
}

describe('network.owned-resource-inspection', () => {
  it('reads text from main-owned URL and headers without projecting credentials', async () => {
    const fetchCalls: Array<{ init: RequestInit; url: string }> = []
    const harness = createHarness(async (url, init) => {
      fetchCalls.push({ init, url })
      return new Response('#EXTM3U\n#EXT-X-VERSION:3\n', {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'set-cookie': 'response-cookie-secret=1',
        },
        status: 200,
      })
    })
    const untrustedRequest = {
      encoding: 'utf8',
      headers: { Authorization: 'Bearer renderer-injected-secret' },
      maxBytes: Number.MAX_SAFE_INTEGER,
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
      url: 'https://renderer-injected.example/manifest.m3u8',
    } as CapturedResourceInspectionRequest

    const result = await harness.inspection.inspect(untrustedRequest)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe(harness.resourceUrl)
    const requestHeaders = new Headers(fetchCalls[0]?.init.headers)
    expect(requestHeaders.get('authorization')).toBe('Bearer main-owned-secret')
    expect(requestHeaders.get('cookie')).toBe('session=main-owned-secret')
    expect(requestHeaders.get('x-manifest-token')).toBe('main-owned-manifest-token')
    expect(result).toMatchObject({
      body: '#EXTM3U\n#EXT-X-VERSION:3\n',
      contentType: 'application/vnd.apple.mpegurl; charset=utf-8',
      encoding: 'utf8',
      receivedBytes: 25,
      resource: {
        id: 'resource-opaque',
        tabId: 'tab-1',
        url: harness.resourceUrl,
      },
      status: 200,
      truncated: false,
    })
    const serializedResult = JSON.stringify(result)
    expect(serializedResult).not.toContain('main-owned-secret')
    expect(serializedResult).not.toContain('main-owned-manifest-token')
    expect(serializedResult).not.toContain('response-cookie-secret')
    expect(serializedResult).not.toContain('renderer-injected')
  })

  it('cancels the response stream at the main-owned byte budget', async () => {
    const cancelled = vi.fn()
    const harness = createHarness(async () => (
      new Response(new ReadableStream<Uint8Array>({
        cancel: cancelled,
        start(controller) {
          controller.enqueue(new TextEncoder().encode('abcdef'))
        },
      }), {
        headers: { 'content-type': 'application/octet-stream' },
        status: 206,
      })
    ), 5)

    const result = await harness.inspection.inspect({
      encoding: 'base64',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })

    expect(result).toMatchObject({
      body: Buffer.from('abcde').toString('base64'),
      contentType: 'application/octet-stream',
      encoding: 'base64',
      receivedBytes: 5,
      status: 206,
      truncated: true,
    })
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('handles an empty response and releases a failed response stream', async () => {
    const emptyHarness = createHarness(async () => new Response(null, { status: 204 }))

    await expect(emptyHarness.inspection.inspect({
      encoding: 'utf8',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).resolves.toMatchObject({
      body: '',
      receivedBytes: 0,
      status: 204,
      truncated: false,
    })

    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('response stream failed'))
      },
    })
    const failedHarness = createHarness(async () => new Response(failedBody))

    await expect(failedHarness.inspection.inspect({
      encoding: 'base64',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).rejects.toThrow('response stream failed')
    expect(failedBody.locked).toBe(false)
  })

  it('rejects invalid and stale commands before opening the transport', async () => {
    const fetchImpl = vi.fn(async () => new Response('unused'))
    const harness = createHarness(fetchImpl)

    await expect(harness.inspection.inspect({
      encoding: 'binary' as never,
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).rejects.toThrow('Captured resource inspection request is invalid')
    expect(harness.store.commitNavigation({
      binding: harness.binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/episode-2',
    })?.change).toBeNull()
    await expect(harness.inspection.inspect({
      encoding: 'utf8',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).rejects.toThrow('Captured resource access is unavailable or stale')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

import http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
  type NetworkContextPurpose,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'

const servers: http.Server[] = []

async function listen(
  handler: http.RequestListener,
) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server port')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => (
    new Promise<void>(resolve => server.close(() => resolve()))
  )))
})

function createHarness(resourceUrl: string) {
  const vault = new NetworkContextVault({
    createContextRef: () => 'context-main-only',
  })
  const store = new ResourceStateStore({
    createResourceId: () => 'resource-opaque',
    releaseContext: contextRef => vault.release(contextRef),
  })
  const registration = store.registerTab({
    pageUrl: 'https://page.example/watch',
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  store.setCaptureMode('tab-1', 'network')
  expect(vault.recordRequest({
    navigationGeneration: registration.binding.navigationGeneration,
    observedRequestUrl: resourceUrl,
    pageOrigin: registration.binding.pageOrigin!,
    requestHeaders: {
      Authorization: 'Bearer source-secret',
      Cookie: 'session=source-secret',
      'X-Media-Token': 'media-secret',
      'X-Trace': 'not-retained',
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
  const write = store.recordNetworkResource({
    binding: registration.binding,
    context,
    metadata: {
      kind: 'media',
      mimeType: 'video/mp4',
      resourceType: 'media',
      url: resourceUrl,
    },
  })
  expect(write.decision).toBe('accepted')
  const access = new CapturedResourceAccessService({
    fetch: (input, init) => fetch(input, init),
    store,
    vault,
  })
  return {
    access,
    binding: registration.binding,
    store,
    vault,
  }
}

function headerRecord(headers: Array<[string, string]>) {
  return Object.fromEntries(headers)
}

describe('network.owned-resource-consumer', () => {
  it('derives all four purpose grants from main-owned resource and context facts', async () => {
    const resourceUrl = 'https://media.example:443/video.mp4'
    const harness = createHarness(resourceUrl)
    const purposes: NetworkContextPurpose[] = [
      'resource-download',
      'resource-inspection',
      'page-drag-stage',
      'external-tool',
    ]

    for (const purpose of purposes) {
      const grant = harness.access.redeem({
        purpose,
        resourceId: 'resource-opaque',
        tabId: 'tab-1',
      })!
      expect(grant).toMatchObject({
        purpose,
        redirectMode: 'manual',
        replayResourceType: 'media',
        resource: {
          id: 'resource-opaque',
          tabId: 'tab-1',
          url: resourceUrl,
        },
      })
      expect(Object.keys(grant.resource)).not.toContain('contextRef')
      const headers = headerRecord(grant.headers)
      expect(headers.authorization).toBe('Bearer source-secret')
      expect(headers['x-media-token']).toBe('media-secret')
      expect(headers['x-trace']).toBeUndefined()
      if (purpose === 'page-drag-stage') {
        expect(headers.cookie).toBeUndefined()
      } else {
        expect(headers.cookie).toBe('session=source-secret')
      }
    }

    expect(harness.access.redeem({
      purpose: 'resource-download',
      resourceId: 'missing-resource',
      tabId: 'tab-1',
    })).toBeNull()
    expect(harness.access.redeem({
      purpose: 'resource-download',
      resourceId: 'resource-opaque',
      tabId: 'other-tab',
    })).toBeNull()

    const fetchCalls: Array<{ init: RequestInit; url: string }> = []
    const pageDragAccess = new CapturedResourceAccessService({
      fetch: async (url, init) => {
        fetchCalls.push({ init, url })
        return new Response('page-drag-body', { status: 200 })
      },
      store: harness.store,
      vault: harness.vault,
    })
    await pageDragAccess.fetch({
      purpose: 'page-drag-stage',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]).toMatchObject({
      init: {
        credentials: 'include',
        redirect: 'manual',
      },
      url: resourceUrl,
    })
    const pageDragHeaders = new Headers(fetchCalls[0].init.headers)
    expect(pageDragHeaders.get('authorization')).toBe('Bearer source-secret')
    expect(pageDragHeaders.has('cookie')).toBe(false)

    const retained = harness.store.commitNavigation({
      binding: harness.binding,
      clearResources: false,
      pageUrl: 'https://page.example/next',
    })!
    expect(retained.change).toBeNull()
    expect(harness.store.getOwnedResource('tab-1', 'resource-opaque')).not.toBeNull()
    expect(harness.access.redeem({
      purpose: 'resource-download',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })).toBeNull()
  })

  it('rejects a retained context-free resource after its document owner changes', () => {
    const vault = new NetworkContextVault()
    const store = new ResourceStateStore({
      createResourceId: () => 'probe-resource-opaque',
    })
    const registration = store.registerTab({
      pageUrl: 'https://page.example/watch',
      tabId: 'tab-probe',
      webContentsId: 51,
    })!
    store.setCaptureMode('tab-probe', 'deep')
    expect(store.upsertProbeResource({
      binding: registration.binding,
      metadata: {
        kind: 'manifest',
        resourceKey: 'probe-manifest',
        url: 'https://media.example/playlist.m3u8',
      },
    }).decision).toBe('accepted')

    const access = new CapturedResourceAccessService({
      fetch: (input, init) => fetch(input, init),
      store,
      vault,
    })
    expect(access.redeem({
      purpose: 'external-tool',
      resourceId: 'probe-resource-opaque',
      tabId: 'tab-probe',
    })).not.toBeNull()

    const navigation = store.commitNavigation({
      binding: registration.binding,
      clearResources: false,
      pageUrl: 'https://page.example/next',
    })!
    expect(navigation.change).toBeNull()
    expect(store.getOwnedResource('tab-probe', 'probe-resource-opaque')).not.toBeNull()
    expect(access.redeem({
      purpose: 'external-tool',
      resourceId: 'probe-resource-opaque',
      tabId: 'tab-probe',
    })).toBeNull()
  })
})

describe('network.redirect-hop-isolation', () => {
  it('manually follows redirects without forwarding protected headers to the next hop', async () => {
    const received: Array<{
      authorization?: string
      cookie?: string
      mediaToken?: string
      server: 'source' | 'target'
    }> = []
    const targetOrigin = await listen((request, response) => {
      received.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        mediaToken: request.headers['x-media-token'] as string | undefined,
        server: 'target',
      })
      response.writeHead(200, { 'Content-Type': 'video/mp4' })
      response.end('redirected-body')
    })
    const sourceOrigin = await listen((request, response) => {
      received.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        mediaToken: request.headers['x-media-token'] as string | undefined,
        server: 'source',
      })
      response.writeHead(302, { Location: `${targetOrigin}/final.mp4` })
      response.end()
    })
    const resourceUrl = `${sourceOrigin}/source.mp4`
    const harness = createHarness(resourceUrl)

    const result = await harness.access.fetch({
      purpose: 'resource-download',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
    })

    expect(result.finalUrl).toBe(`${targetOrigin}/final.mp4`)
    expect(result.redirectCount).toBe(1)
    await expect(result.response.text()).resolves.toBe('redirected-body')
    expect(received).toEqual([
      {
        authorization: 'Bearer source-secret',
        cookie: 'session=source-secret',
        mediaToken: 'media-secret',
        server: 'source',
      },
      {
        authorization: undefined,
        cookie: undefined,
        mediaToken: undefined,
        server: 'target',
      },
    ])
  })
})

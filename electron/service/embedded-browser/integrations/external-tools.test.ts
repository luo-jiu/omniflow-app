import { describe, expect, it, vi } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'
import {
  ExternalToolDispatcher,
  type ExternalToolDispatchRequest,
} from './external-tools'

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
      'X-Ignored': 'renderer-must-not-add-this',
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

  const access = new CapturedResourceAccessService({
    fetch: (input, init) => fetch(input, init),
    store,
    vault,
  })
  const execute = vi.fn(async () => undefined)
  return {
    access,
    binding: registration.binding,
    dispatcher: new ExternalToolDispatcher({ access, execute }),
    execute,
    resourceUrl,
    store,
  }
}

describe('output.external-tool-auth-boundary', () => {
  it('derives execution data from main-owned resource state and ignores injected payload fields', async () => {
    const harness = createHarness()
    const untrustedRequest = {
      headers: {
        Authorization: 'Bearer renderer-injected-secret',
      },
      pageUrl: 'https://renderer-injected.example/page',
      referer: 'https://renderer-injected.example/referer',
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
      toolKey: 'aria2',
      url: 'https://renderer-injected.example/payload',
    } as ExternalToolDispatchRequest

    await harness.dispatcher.dispatch(untrustedRequest)

    expect(harness.execute).toHaveBeenCalledOnce()
    expect(harness.execute).toHaveBeenCalledWith('aria2', {
      fileName: 'episode-1.mp4',
      headers: {
        authorization: 'Bearer main-owned-secret',
        cookie: 'session=main-owned-secret',
        referer: 'https://page.example/watch/episode-1',
        'x-media-token': 'main-owned-media-token',
      },
      kind: 'media',
      mimeType: 'video/mp4',
      pageUrl: 'https://page.example/watch/episode-1',
      referer: 'https://page.example/watch/episode-1',
      title: 'episode-1.mp4',
      url: harness.resourceUrl,
    })
    const serializedExecution = JSON.stringify(harness.execute.mock.calls)
    expect(serializedExecution).not.toContain('renderer-injected')
    expect(serializedExecution).not.toContain('renderer-must-not-add-this')
  })

  it('rejects invalid, cross-tab, and stale requests before execution', async () => {
    const harness = createHarness()

    await expect(harness.dispatcher.dispatch({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
      toolKey: 'unsupported' as never,
    })).rejects.toThrow('External tool request is invalid')
    await expect(harness.dispatcher.dispatch({
      resourceId: 'resource-opaque',
      tabId: 'tab-2',
      toolKey: 'command',
    })).rejects.toThrow('Captured resource access is unavailable or stale')

    expect(harness.store.commitNavigation({
      binding: harness.binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/episode-2',
    })?.change).toBeNull()
    await expect(harness.dispatcher.dispatch({
      resourceId: 'resource-opaque',
      tabId: 'tab-1',
      toolKey: 'protocol',
    })).rejects.toThrow('Captured resource access is unavailable or stale')
    expect(harness.execute).not.toHaveBeenCalled()
  })
})

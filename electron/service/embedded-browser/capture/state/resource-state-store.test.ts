import { describe, expect, it } from 'vitest'

import {
  ResourceStateStore,
  type CapturedResourceMetadataInput,
} from './resource-state-store'
import type { NetworkContextProjection } from './network-context-vault'

const NETWORK_CONTEXT: NetworkContextProjection = {
  capabilities: {
    hasAuthorization: true,
    hasCookie: true,
  },
  contextRef: 'context-1',
  headerNames: ['authorization', 'cookie'],
}

const NETWORK_RESOURCE: CapturedResourceMetadataInput = {
  capturedAt: 900,
  contentLength: 1_024,
  ext: 'mp4',
  kind: 'media',
  method: 'GET',
  mimeType: 'video/mp4',
  name: 'video.mp4',
  resourceType: 'other',
  statusCode: 200,
  streamType: 'video',
  url: 'https://media.example/video.mp4',
}

function createStore(options: Partial<ConstructorParameters<typeof ResourceStateStore>[0]> = {}) {
  let resourceIndex = 0
  const releasedContexts: string[] = []
  const store = new ResourceStateStore({
    createResourceId: () => `resource-${++resourceIndex}`,
    releaseContext: contextRef => releasedContexts.push(contextRef),
    ...options,
  })
  return { releasedContexts, store }
}

function registerCapturingTab(
  store: ResourceStateStore,
  input: { pageUrl?: string; tabId?: string; webContentsId?: number } = {},
) {
  const tabId = input.tabId || 'tab-1'
  const registration = store.registerTab({
    pageUrl: input.pageUrl || 'https://page.example/watch/one',
    tabId,
    webContentsId: input.webContentsId || 41,
  })
  expect(registration).not.toBeNull()
  store.setCaptureMode(tabId, 'deep')
  return registration!.binding
}

function getActiveSnapshot(store: ResourceStateStore, tabId: string) {
  const snapshot = store.getSnapshot(tabId)
  expect(snapshot?.status).toBe('active')
  if (!snapshot || snapshot.status !== 'active') throw new Error('Expected active resource state')
  return snapshot
}

function networkContext(contextRef: string): NetworkContextProjection {
  return { ...NETWORK_CONTEXT, contextRef }
}

function recordNetworkResource(
  store: ResourceStateStore,
  binding: ReturnType<typeof registerCapturingTab>,
  input: {
    capturedAt?: number
    contextRef?: string
    url?: string
  } = {},
) {
  return store.recordNetworkResource({
    binding,
    context: input.contextRef ? networkContext(input.contextRef) : undefined,
    metadata: {
      ...NETWORK_RESOURCE,
      capturedAt: input.capturedAt ?? NETWORK_RESOURCE.capturedAt,
      url: input.url || NETWORK_RESOURCE.url,
    },
  })
}

describe('state.capacity-ttl-dedupe', () => {
  it('returns revisioned register and mode barriers without fabricating missing state', () => {
    const { store } = createStore()

    expect(store.getSnapshot('missing-tab')).toBeNull()
    const registration = store.registerTab({
      pageUrl: 'https://page.example/watch/one',
      tabId: 'tab-1',
      webContentsId: 41,
    })!
    expect(registration.change).toMatchObject({
      captureMode: 'off',
      cause: 'register',
      incarnation: 1,
      revision: 1,
      status: 'active',
      type: 'reset',
    })
    expect(store.registerTab({ tabId: 'tab-1', webContentsId: 41 })).toEqual({
      binding: registration.binding,
      change: null,
    })

    const networkMode = store.setCaptureMode('tab-1', 'network')!
    const repeatedNetworkMode = store.setCaptureMode('tab-1', 'network')!
    const deepMode = store.setCaptureMode('tab-1', 'deep')!
    expect([
      networkMode.revision,
      repeatedNetworkMode.revision,
      deepMode.revision,
    ]).toEqual([2, 3, 4])
    expect(deepMode).toMatchObject({ captureMode: 'deep', type: 'mode' })
    expect(getActiveSnapshot(store, 'tab-1')).toMatchObject({
      captureMode: 'deep',
      incarnation: 1,
      revision: 4,
    })
  })

  it('keeps owner facts and context refs internal while projecting whitelisted metadata', () => {
    const { releasedContexts, store } = createStore()
    const binding = registerCapturingTab(store)
    const metadata = {
      ...NETWORK_RESOURCE,
      headers: { Cookie: 'renderer-secret-cookie' },
      requestHeaders: { Authorization: 'Bearer renderer-secret' },
    } as CapturedResourceMetadataInput

    const result = store.recordNetworkResource({
      binding,
      context: NETWORK_CONTEXT,
      metadata,
    })
    expect(result.decision).toBe('accepted')
    expect(result.resource).toEqual({
      capturedAt: 900,
      contentLength: 1_024,
      context: {
        hasAuthorization: true,
        hasCookie: true,
        headerNames: ['authorization', 'cookie'],
      },
      ext: 'mp4',
      id: 'resource-1',
      kind: 'media',
      method: 'GET',
      mimeType: 'video/mp4',
      name: 'video.mp4',
      resourceType: 'other',
      source: 'network',
      statusCode: 200,
      streamType: 'video',
      tabId: 'tab-1',
      url: 'https://media.example/video.mp4',
    })

    metadata.url = 'https://mutated.example/video.mp4'
    result.resource!.context!.headerNames.push('mutated')
    const snapshot = getActiveSnapshot(store, 'tab-1')
    expect(snapshot.resources[0]?.url).toBe('https://media.example/video.mp4')
    expect(snapshot.resources[0]?.context?.headerNames).toEqual(['authorization', 'cookie'])

    const serialized = JSON.stringify(snapshot)
    for (const secret of [
      'context-1',
      'renderer-secret-cookie',
      'Bearer renderer-secret',
      'https://page.example',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    const projectedKeys = Object.keys(snapshot.resources[0] || {})
    for (const internalKey of [
      'capturedIncarnation',
      'capturedNavigationGeneration',
      'capturedPageOrigin',
      'capturedWebContentsId',
      'contextRef',
      'headers',
      'requestHeaders',
    ]) {
      expect(projectedKeys).not.toContain(internalKey)
    }

    const owned = store.getOwnedResource('tab-1', result.resource!.id)
    expect(owned).toMatchObject({
      capturedIncarnation: binding.incarnation,
      capturedNavigationGeneration: binding.navigationGeneration,
      capturedPageOrigin: 'https://page.example',
      capturedWebContentsId: 41,
      contextRef: 'context-1',
    })
    expect(releasedContexts).toEqual([])
  })

  it('applies Cat Catch exact-URL dedupe while allowing explicit duplicate capture', () => {
    const { releasedContexts, store } = createStore()
    const binding = registerCapturingTab(store)
    const first = store.recordNetworkResource({
      binding,
      context: NETWORK_CONTEXT,
      metadata: NETWORK_RESOURCE,
    })
    const duplicate = store.recordNetworkResource({
      binding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-duplicate' },
      metadata: NETWORK_RESOURCE,
    })
    const allowedDuplicate = store.recordNetworkResource({
      binding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-allowed' },
      metadata: NETWORK_RESOURCE,
    }, { checkDuplicates: false })

    expect(first.decision).toBe('accepted')
    expect(duplicate).toMatchObject({ decision: 'duplicate', resource: null })
    expect(allowedDuplicate.decision).toBe('accepted')
    expect(allowedDuplicate.resource?.id).not.toBe(first.resource?.id)
    expect(getActiveSnapshot(store, binding.tabId).resources).toHaveLength(2)
    expect(releasedContexts).toEqual(['context-duplicate'])
  })

  it('resolves the newest live resource for a page URL without exposing owner metadata', () => {
    const { store } = createStore()
    const binding = registerCapturingTab(store)
    const url = 'https://media.example/dragged.mp4'
    const first = recordNetworkResource(store, binding, { url })
    const second = store.recordNetworkResource({
      binding,
      metadata: { ...NETWORK_RESOURCE, url },
    }, { checkDuplicates: false })

    expect(first.decision).toBe('accepted')
    expect(second.decision).toBe('accepted')
    expect(store.getOwnedResourceByUrl(binding.tabId, url)).toMatchObject({
      id: second.resource?.id,
      url,
    })
    expect(store.getOwnedResourceByUrl(binding.tabId, 'https://media.example/missing.mp4'))
      .toBeNull()

    const retainedNavigation = store.commitNavigation({
      binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/two',
    })!
    expect(store.getOwnedResourceByUrl(binding.tabId, url)).toBeNull()
    expect(store.getOwnedResourceByUrl(retainedNavigation.binding.tabId, url)).toBeNull()
  })

  it('keeps a contextRef single-owned and releases it exactly once', () => {
    const { releasedContexts, store } = createStore()
    const binding = registerCapturingTab(store)
    const first = recordNetworkResource(store, binding, { contextRef: 'shared-context' })

    expect(first.decision).toBe('accepted')
    expect(recordNetworkResource(store, binding, {
      contextRef: 'shared-context',
      url: 'https://media.example/other.mp4',
    })).toMatchObject({
      change: null,
      decision: 'context-already-owned',
      resource: null,
    })
    expect(releasedContexts).toEqual([])

    store.clearResources(binding.tabId)
    store.clearResources(binding.tabId)
    expect(releasedContexts).toEqual(['shared-context'])
  })

  it('preserves the current fingerprint epoch when an old resource expires', () => {
    let now = 0
    const { store } = createStore({
      now: () => now,
      resourceTtlMs: 100,
    })
    const binding = registerCapturingTab(store)
    const reusedUrl = 'https://media.example/reused.mp4'

    expect(recordNetworkResource(store, binding, {
      capturedAt: 0,
      url: reusedUrl,
    }).decision).toBe('accepted')
    now = 50
    for (let index = 1; index < 499; index += 1) {
      expect(recordNetworkResource(store, binding, {
        capturedAt: now,
        url: `https://media.example/unique-${index}.mp4`,
      }).decision).toBe('accepted')
    }
    expect(recordNetworkResource(store, binding, {
      capturedAt: now,
      url: 'https://media.example/fingerprint-reset.mp4',
    }).decision).toBe('accepted')

    now = 60
    expect(recordNetworkResource(store, binding, {
      capturedAt: now,
      url: reusedUrl,
    }).decision).toBe('accepted')
    expect(getActiveSnapshot(store, binding.tabId).resources).toHaveLength(501)

    now = 100
    expect(store.sweepExpired()).toMatchObject([{
      reason: 'ttl',
      resourceIds: ['resource-1'],
      type: 'remove',
    }])
    expect(recordNetworkResource(store, binding, {
      capturedAt: now,
      url: reusedUrl,
    }).decision).toBe('duplicate')
  })

  it('matches the upstream 500/501 dedupe boundary', () => {
    const { store } = createStore()
    const binding = registerCapturingTab(store)
    for (let index = 0; index < 501; index += 1) {
      expect(recordNetworkResource(store, binding, {
        url: `https://media.example/boundary-${index}.mp4`,
      }).decision).toBe('accepted')
    }

    expect(recordNetworkResource(store, binding, {
      url: 'https://media.example/boundary-500.mp4',
    }).decision).toBe('accepted')
  })

  it('keeps stable probe updates within one generation and isolates the next document', () => {
    const { store } = createStore({ maxResourcesPerTab: 1 })
    const binding = registerCapturingTab(store)
    const first = store.upsertProbeResource({
      binding,
      metadata: {
        capturedAt: 1_000,
        contentLength: 10,
        kind: 'media',
        mimeType: 'video/mp4',
        resourceKey: 'mse-stream:video-1',
        streamType: 'video',
        url: 'blob:https://page.example/video-1',
      },
    })
    const updated = store.upsertProbeResource({
      binding,
      metadata: {
        capturedAt: 1_100,
        contentLength: 20,
        kind: 'media',
        resourceKey: 'mse-stream:video-1',
        url: 'blob:https://page.example/video-1',
      },
    })

    expect(first.decision).toBe('accepted')
    expect(updated.decision).toBe('accepted')
    expect(updated.resource?.id).toBe(first.resource?.id)
    expect(updated.resource).toMatchObject({
      contentLength: 20,
      mimeType: 'video/mp4',
      streamType: 'video',
    })
    expect(JSON.stringify(updated.resource)).not.toContain('mse-stream:video-1')
    expect(store.getOwnedResource(binding.tabId, updated.resource!.id)?.resourceKey)
      .toBe('mse-stream:video-1')
    expect(store.getOwnedResourceByResourceKey(binding.tabId, 'mse-stream:video-1')?.id)
      .toBe(updated.resource?.id)
    expect(getActiveSnapshot(store, binding.tabId).resources).toHaveLength(1)

    const nextNavigation = store.commitNavigation({
      binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/two',
    })!
    const nextPage = store.upsertProbeResource({
      binding: nextNavigation.binding,
      metadata: {
        capturedAt: 1_200,
        contentLength: 5,
        kind: 'media',
        resourceKey: 'mse-stream:video-1',
        url: 'blob:https://page.example/video-2',
      },
    })

    expect(nextPage).toMatchObject({
      decision: 'capacity-reset',
      resource: null,
    })
    expect(getActiveSnapshot(store, binding.tabId).resources).toEqual([])
  })

  it('does not inherit stable probe metadata across a retained navigation', () => {
    const { store } = createStore()
    const binding = registerCapturingTab(store)
    const first = store.upsertProbeResource({
      binding,
      metadata: {
        capturedAt: 1_000,
        kind: 'media',
        mimeType: 'video/mp4',
        resourceKey: 'mse-stream:shared',
        url: 'blob:https://page.example/first',
      },
    })
    const navigation = store.commitNavigation({
      binding,
      clearResources: false,
      pageUrl: 'https://other-page.example/watch/two',
    })!
    const second = store.upsertProbeResource({
      binding: navigation.binding,
      metadata: {
        capturedAt: 1_100,
        kind: 'media',
        resourceKey: 'mse-stream:shared',
        url: 'blob:https://other-page.example/second',
      },
    })

    expect(second.resource?.id).not.toBe(first.resource?.id)
    expect(second.resource?.mimeType).toBeUndefined()
    expect(getActiveSnapshot(store, binding.tabId).resources).toHaveLength(2)
    expect(store.getOwnedResource(binding.tabId, second.resource!.id)).toMatchObject({
      capturedNavigationGeneration: 1,
      capturedPageOrigin: 'https://other-page.example',
    })
  })

  it('matches upstream overflow reset and removes expired entries on explicit maintenance', () => {
    let now = 1_000
    const { releasedContexts, store } = createStore({
      maxResourcesPerTab: 2,
      now: () => now,
      resourceTtlMs: 100,
    })
    const binding = registerCapturingTab(store)
    for (const index of [1, 2]) {
      expect(store.recordNetworkResource({
        binding,
        context: { ...NETWORK_CONTEXT, contextRef: `context-${index}` },
        metadata: { ...NETWORK_RESOURCE, url: `https://media.example/video-${index}.mp4` },
      }).decision).toBe('accepted')
    }

    expect(store.recordNetworkResource({
      binding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-overflow' },
      metadata: { ...NETWORK_RESOURCE, url: 'https://media.example/video-3.mp4' },
    })).toMatchObject({ decision: 'capacity-reset', resource: null })
    expect(getActiveSnapshot(store, binding.tabId)).toMatchObject({
      captureMode: 'deep',
      resources: [],
    })
    expect(releasedContexts).toEqual(['context-1', 'context-2', 'context-overflow'])

    expect(store.recordNetworkResource({
      binding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-expiring' },
      metadata: NETWORK_RESOURCE,
    }).decision).toBe('accepted')
    now = 1_100
    expect(store.sweepExpired()).toHaveLength(1)
    expect(getActiveSnapshot(store, binding.tabId).resources).toEqual([])
    expect(releasedContexts.at(-1)).toBe('context-expiring')
  })

  it('keeps reads pure and emits one grouped TTL removal per tab', () => {
    let now = 1_000
    const { store } = createStore({
      now: () => now,
      resourceTtlMs: 100,
    })
    const firstBinding = registerCapturingTab(store)
    const secondBinding = registerCapturingTab(store, {
      tabId: 'tab-2',
      webContentsId: 42,
    })
    recordNetworkResource(store, firstBinding, {
      capturedAt: 1_000,
      url: 'https://media.example/older.mp4',
    })
    recordNetworkResource(store, firstBinding, {
      capturedAt: 1_100,
      url: 'https://media.example/newer.mp4',
    })
    recordNetworkResource(store, secondBinding, {
      capturedAt: 1_200,
      url: 'https://media.example/second-tab.mp4',
    })

    const beforeExpiry = getActiveSnapshot(store, firstBinding.tabId)
    expect(beforeExpiry.resources.map(resource => resource.url)).toEqual([
      'https://media.example/newer.mp4',
      'https://media.example/older.mp4',
    ])
    beforeExpiry.resources.pop()
    expect(getActiveSnapshot(store, firstBinding.tabId).resources).toHaveLength(2)

    now = 1_100
    expect(store.getOwnedResource(firstBinding.tabId, 'resource-1')).toBeNull()
    expect(getActiveSnapshot(store, firstBinding.tabId)).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ id: 'resource-1' }),
      ]),
      revision: beforeExpiry.revision,
    })

    const changes = store.sweepExpired()
    expect(changes).toHaveLength(2)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceIds: ['resource-1', 'resource-2'],
        tabId: firstBinding.tabId,
        type: 'remove',
      }),
      expect.objectContaining({
        resourceIds: ['resource-3'],
        tabId: secondBinding.tabId,
        type: 'remove',
      }),
    ]))
  })
})

describe('state.tab-navigation-close', () => {
  it('rejects disabled and stale writes while preserving an existing context owner', () => {
    const { releasedContexts, store } = createStore()
    const registration = store.registerTab({
      pageUrl: 'https://page.example/watch/one',
      tabId: 'tab-1',
      webContentsId: 41,
    })!

    expect(recordNetworkResource(store, registration.binding, {
      contextRef: 'disabled-context',
    })).toMatchObject({ decision: 'capture-disabled' })
    expect(releasedContexts).toEqual(['disabled-context'])

    store.setCaptureMode('tab-1', 'network')
    expect(recordNetworkResource(store, registration.binding, {
      contextRef: 'owned-context',
    }).decision).toBe('accepted')
    const navigation = store.commitNavigation({
      binding: registration.binding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/two',
    })!
    expect(recordNetworkResource(store, registration.binding, {
      contextRef: 'owned-context',
      url: 'https://media.example/stale.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    expect(releasedContexts).toEqual(['disabled-context'])
    expect(store.getOwnedResource('tab-1', 'resource-1')).toMatchObject({
      capturedNavigationGeneration: 0,
      contextRef: 'owned-context',
    })
    expect(navigation.change).toBeNull()
  })

  it('rejects stale generation writes and makes navigation clearing explicit', () => {
    const { releasedContexts, store } = createStore()
    const firstBinding = registerCapturingTab(store)
    const first = store.recordNetworkResource({
      binding: firstBinding,
      context: NETWORK_CONTEXT,
      metadata: NETWORK_RESOURCE,
    })
    expect(first.decision).toBe('accepted')

    const retained = store.commitNavigation({
      binding: firstBinding,
      clearResources: false,
      pageUrl: 'https://page.example/watch/two',
    })
    const retainedBinding = retained!.binding
    expect(retainedBinding.navigationGeneration).toBe(firstBinding.navigationGeneration + 1)
    expect(getActiveSnapshot(store, firstBinding.tabId).resources).toHaveLength(1)

    expect(store.recordNetworkResource({
      binding: firstBinding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-stale' },
      metadata: { ...NETWORK_RESOURCE, url: 'https://media.example/stale.mp4' },
    })).toMatchObject({ decision: 'stale-binding', resource: null })
    expect(releasedContexts).toEqual(['context-stale'])

    expect(store.recordNetworkResource({
      binding: retainedBinding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-current' },
      metadata: { ...NETWORK_RESOURCE, url: 'https://media.example/current.mp4' },
    }).decision).toBe('accepted')

    const cleared = store.commitNavigation({
      binding: retainedBinding,
      clearResources: true,
      pageUrl: 'https://other-page.example/watch/three',
    })
    expect(cleared?.binding).toMatchObject({
      navigationGeneration: retainedBinding.navigationGeneration + 1,
      pageOrigin: 'https://other-page.example',
    })
    expect(getActiveSnapshot(store, firstBinding.tabId)).toMatchObject({
      captureMode: 'deep',
      resources: [],
    })
    expect(releasedContexts).toEqual([
      'context-stale',
      'context-1',
      'context-current',
    ])
  })

  it('clears context capabilities after vault invalidation without deleting metadata', () => {
    const { releasedContexts, store } = createStore()
    const binding = registerCapturingTab(store)
    const result = store.recordNetworkResource({
      binding,
      context: NETWORK_CONTEXT,
      metadata: NETWORK_RESOURCE,
    })

    expect(store.invalidateContext('context-1')).toHaveLength(1)
    expect(getActiveSnapshot(store, binding.tabId).resources[0]).toMatchObject({
      id: result.resource!.id,
      url: NETWORK_RESOURCE.url,
    })
    expect(getActiveSnapshot(store, binding.tabId).resources[0]?.context).toBeUndefined()
    expect(store.getOwnedResource(binding.tabId, result.resource!.id)?.contextRef).toBeUndefined()
    expect(releasedContexts).toEqual([])
    expect(store.invalidateContext('context-1')).toHaveLength(0)
  })

  it('isolates tab, WebContents, and application disposal while preserving capture mode on clear', () => {
    const { releasedContexts, store } = createStore()
    const firstBinding = registerCapturingTab(store)
    const secondBinding = registerCapturingTab(store, {
      pageUrl: 'https://second-page.example',
      tabId: 'tab-2',
      webContentsId: 42,
    })
    store.recordNetworkResource({
      binding: firstBinding,
      context: NETWORK_CONTEXT,
      metadata: NETWORK_RESOURCE,
    })
    store.recordNetworkResource({
      binding: secondBinding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-2' },
      metadata: { ...NETWORK_RESOURCE, url: 'https://media.example/second.mp4' },
    })

    expect(store.clearResources(firstBinding.tabId)).toMatchObject({ cause: 'clear' })
    expect(getActiveSnapshot(store, firstBinding.tabId)).toMatchObject({
      captureMode: 'deep',
      resources: [],
    })
    expect(getActiveSnapshot(store, secondBinding.tabId).resources).toHaveLength(1)
    expect(releasedContexts).toEqual(['context-1'])

    store.setCaptureMode(secondBinding.tabId, 'off')
    expect(getActiveSnapshot(store, secondBinding.tabId)).toMatchObject({
      captureMode: 'off',
    })
    expect(getActiveSnapshot(store, secondBinding.tabId).resources).toHaveLength(1)

    expect(store.disposeWebContents(secondBinding.webContentsId)).toHaveLength(1)
    expect(store.getCaptureBinding(secondBinding.tabId)).toBeNull()
    expect(releasedContexts).toEqual(['context-1', 'context-2'])

    const thirdBinding = registerCapturingTab(store, {
      pageUrl: 'https://third-page.example',
      tabId: 'tab-3',
      webContentsId: 43,
    })
    store.recordNetworkResource({
      binding: thirdBinding,
      context: { ...NETWORK_CONTEXT, contextRef: 'context-3' },
      metadata: { ...NETWORK_RESOURCE, url: 'https://media.example/third.mp4' },
    })
    expect(store.disposeAll()).toHaveLength(2)
    expect(store.getCaptureBinding(thirdBinding.tabId)).toBeNull()
    expect(releasedContexts).toEqual(['context-1', 'context-2', 'context-3'])
  })

  it('keeps incarnation and revision monotonic across replacement and disposal', () => {
    const { releasedContexts, store } = createStore()
    const firstBinding = registerCapturingTab(store)
    const firstWrite = recordNetworkResource(store, firstBinding, {
      contextRef: 'context-first',
    })
    const firstRevision = firstWrite.change!.revision

    const replacement = store.registerTab({
      pageUrl: 'https://replacement.example',
      tabId: firstBinding.tabId,
      webContentsId: 42,
    })!
    expect(replacement.change).toMatchObject({
      cause: 'replace',
      revision: firstRevision + 1,
      status: 'active',
    })
    expect(replacement.binding.incarnation).toBeGreaterThan(firstBinding.incarnation)
    expect(recordNetworkResource(store, firstBinding, {
      contextRef: 'context-stale-instance',
      url: 'https://media.example/stale-instance.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    expect(releasedContexts).toEqual(['context-first', 'context-stale-instance'])

    const disposed = store.disposeTab(firstBinding.tabId)!
    expect(disposed).toMatchObject({
      cause: 'tab-dispose',
      revision: replacement.change!.revision + 1,
      status: 'disposed',
    })
    expect(store.getSnapshot(firstBinding.tabId)).toEqual({
      incarnation: replacement.binding.incarnation,
      revision: disposed.revision,
      status: 'disposed',
      tabId: firstBinding.tabId,
    })

    const restored = store.registerTab({
      pageUrl: 'https://restored.example',
      tabId: firstBinding.tabId,
      webContentsId: 43,
    })!
    expect(restored.change).toMatchObject({
      cause: 'register',
      revision: disposed.revision + 1,
      status: 'active',
    })
    expect(restored.binding.incarnation).toBeGreaterThan(replacement.binding.incarnation)
  })
})

import { describe, expect, it } from 'vitest'

import { ResourceStateStore } from '../capture/state/resource-state-store'
import type { NetworkContextProjection } from '../capture/state/network-context-vault'
import {
  CapturedResourceContract,
  type ResourceStateChange,
  type ResourceStateSnapshot,
} from './captured-resource'

const CONTEXT: NetworkContextProjection = {
  capabilities: {
    hasAuthorization: true,
    hasCookie: true,
  },
  contextRef: 'main-only-context-ref',
  headerNames: ['authorization', 'cookie'],
}

function createStore() {
  let resourceId = 0
  return new ResourceStateStore({
    createResourceId: () => `resource-${++resourceId}`,
  })
}

describe('contract.resource-dto-single-source', () => {
  it('reduces only sequential changes and uses reset/snapshot barriers for recovery', () => {
    const store = createStore()
    const registration = store.registerTab({
      pageUrl: 'https://page.example/watch/one',
      tabId: 'tab-1',
      webContentsId: 41,
    })!
    let state: ResourceStateSnapshot | null = null

    const missingBaseline = CapturedResourceContract.reduce(state, {
      incarnation: registration.binding.incarnation,
      resources: [],
      revision: 2,
      tabId: 'tab-1',
      type: 'upsert',
    })
    expect(missingBaseline).toEqual({ decision: 'resync', state: null })

    const registered = CapturedResourceContract.reduce(state, registration.change)
    expect(registered).toMatchObject({
      decision: 'applied',
      state: {
        captureMode: 'off',
        incarnation: 1,
        resources: [],
        revision: 1,
        status: 'active',
      },
    })
    state = registered.state

    const modeChange = store.setCaptureMode('tab-1', 'network')!
    const mode = CapturedResourceContract.reduce(state, modeChange)
    expect(mode).toMatchObject({ decision: 'applied', state: { revision: 2 } })
    state = mode.state

    const write = store.recordNetworkResource({
      binding: registration.binding,
      context: CONTEXT,
      metadata: {
        capturedAt: 1_000,
        contentLength: 4_096,
        ext: 'mp4',
        kind: 'media',
        method: 'GET',
        mimeType: 'video/mp4',
        name: 'video.mp4',
        resourceType: 'xhr',
        statusCode: 200,
        streamType: 'video',
        url: 'https://media.example/video.mp4',
      },
    })
    const upsert = CapturedResourceContract.reduce(state, write.change)
    expect(upsert).toMatchObject({
      decision: 'applied',
      state: {
        resources: [{ id: 'resource-1' }],
        revision: 3,
      },
    })
    state = upsert.state

    expect(CapturedResourceContract.reduce(state, modeChange)).toMatchObject({
      decision: 'ignored',
      state: { revision: 3 },
    })
    expect(CapturedResourceContract.reduce(state, {
      ...write.change,
      revision: 5,
    })).toMatchObject({
      decision: 'resync',
      state: { revision: 3 },
    })

    const snapshotBarrier = CapturedResourceContract.reduce(state, {
      ...store.getSnapshot('tab-1'),
      revision: 5,
    })
    expect(snapshotBarrier).toMatchObject({ decision: 'applied', state: { revision: 5 } })

    const disposed = store.disposeTab('tab-1')!
    const disposedState = CapturedResourceContract.reduce(state, disposed)
    expect(disposedState).toMatchObject({
      decision: 'applied',
      state: { incarnation: 1, revision: 4, status: 'disposed' },
    })
    expect(CapturedResourceContract.reduce(disposedState.state, write.change)).toMatchObject({
      decision: 'ignored',
      state: { status: 'disposed' },
    })
    expect(CapturedResourceContract.reduce(disposedState.state, {
      captureMode: 'network',
      incarnation: 1,
      resources: [],
      revision: 5,
      status: 'active',
      tabId: 'tab-1',
    })).toMatchObject({
      decision: 'resync',
      state: { revision: 4, status: 'disposed' },
    })

    const replacement = store.registerTab({
      pageUrl: 'https://page.example/watch/two',
      tabId: 'tab-1',
      webContentsId: 42,
    })!
    expect(CapturedResourceContract.reduce(disposedState.state, replacement.change)).toMatchObject({
      decision: 'applied',
      state: {
        captureMode: 'off',
        incarnation: 2,
        resources: [],
        revision: 5,
        status: 'active',
      },
    })
  })
})

describe('contract.renderer-safe-projection', () => {
  it('whitelists snapshots and changes without leaking main owner or header values', () => {
    const store = createStore()
    const binding = store.registerTab({
      pageUrl: 'https://page.example/watch/one',
      tabId: 'tab-1',
      webContentsId: 41,
    })!.binding
    store.setCaptureMode('tab-1', 'network')
    const write = store.recordNetworkResource({
      binding,
      context: CONTEXT,
      metadata: {
        capturedAt: 1_000,
        kind: 'media',
        url: 'https://media.example/video.mp4',
      },
    })
    const safeChange = write.change as Extract<ResourceStateChange, { type: 'upsert' }>
    const unsafeResource = {
      ...safeChange.resources[0],
      capturedPageOrigin: 'https://page.example',
      capturedWebContentsId: 41,
      context: {
        ...safeChange.resources[0]!.context,
        contextRef: 'main-only-context-ref',
        headers: { Authorization: 'Bearer renderer-secret' },
      },
      requestHeaders: { Cookie: 'renderer-cookie-secret' },
      resourceKey: 'main-only-resource-key',
    }
    const parsedChange = CapturedResourceContract.parseChange({
      ...safeChange,
      contextRef: 'top-level-context-ref',
      resources: [unsafeResource],
    })
    expect(parsedChange).toMatchObject({
      resources: [{
        context: {
          hasAuthorization: true,
          hasCookie: true,
          headerNames: ['authorization', 'cookie'],
        },
        id: 'resource-1',
      }],
      type: 'upsert',
    })

    unsafeResource.context.headerNames!.push('mutated')
    expect(parsedChange && 'resources' in parsedChange
      ? parsedChange.resources[0]?.context?.headerNames
      : []).toEqual(['authorization', 'cookie'])

    const unsafeSnapshot = {
      ...store.getSnapshot('tab-1'),
      contextRef: 'snapshot-context-ref',
      resources: [unsafeResource],
    }
    const parsedSnapshot = CapturedResourceContract.parseSnapshot(unsafeSnapshot)
    const serialized = JSON.stringify({ parsedChange, parsedSnapshot })
    for (const forbidden of [
      'main-only-context-ref',
      'top-level-context-ref',
      'snapshot-context-ref',
      'main-only-resource-key',
      'Bearer renderer-secret',
      'renderer-cookie-secret',
      'capturedPageOrigin',
      'capturedWebContentsId',
      'requestHeaders',
      'resourceKey',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(CapturedResourceContract.parseChange({
      ...safeChange,
      resources: [{ ...safeChange.resources[0], kind: 'not-a-kind' }],
    })).toBeNull()
    expect(CapturedResourceContract.parseChange({
      ...safeChange,
      resources: [{
        ...safeChange.resources[0],
        context: {
          ...safeChange.resources[0]!.context,
          headerNames: ['authorization: Bearer smuggled-secret'],
        },
      }],
    })).toBeNull()
  })
})

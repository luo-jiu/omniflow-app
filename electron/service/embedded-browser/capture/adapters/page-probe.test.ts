import { describe, expect, it } from 'vitest'

import { ResourceStateStore, type ResourceStateChange } from '../state/resource-state-store'
import { PageProbeCaptureAdapter } from './page-probe'

describe('network.probe-store-handoff', () => {
  it('upserts stable probe resources only for the bound deep-capture document', () => {
    const changes: ResourceStateChange[] = []
    let resourceIndex = 0
    let now = 100
    const store = new ResourceStateStore({
      createResourceId: () => `resource-${++resourceIndex}`,
      now: () => now,
    })
    const registration = store.registerTab({
      pageUrl: 'https://page.example/watch',
      tabId: 'tab-1',
      webContentsId: 41,
    })!
    store.setCaptureMode('tab-1', 'deep')
    const adapter = new PageProbeCaptureAdapter({
      binding: registration.binding,
      emitChange: change => changes.push(change),
      now: () => now,
      store,
    })

    expect(adapter.capture({
      capturedAt: 9_999_999,
      contentLength: 512,
      ext: 'AVIF',
      kind: 'other',
      resourceKey: 'page-resource-1',
      resourceType: 'fetch',
      tabId: 'forged-tab',
      url: 'https://cdn.example/cover.avif',
    })).toMatchObject({
      decision: 'accepted',
      resource: {
        capturedAt: 100,
        ext: 'avif',
        id: 'resource-1',
        kind: 'image',
        source: 'probe',
        tabId: 'tab-1',
      },
    })
    expect(changes).toHaveLength(1)
    expect(JSON.stringify(changes[0])).not.toContain('page-resource-1')

    now = 200
    expect(adapter.capture({
      contentLength: 1_024,
      ext: 'avif',
      resourceKey: 'page-resource-1',
      url: 'https://cdn.example/cover-updated.avif',
    })).toMatchObject({
      decision: 'accepted',
      resource: {
        capturedAt: 200,
        contentLength: 1_024,
        id: 'resource-1',
        url: 'https://cdn.example/cover-updated.avif',
      },
    })
    expect(changes).toHaveLength(2)

    const nextNavigation = store.commitNavigation({
      binding: registration.binding,
      clearResources: false,
      pageUrl: 'https://page.example/next',
    })!
    expect(adapter.capture({
      resourceKey: 'stale-resource',
      url: 'https://cdn.example/stale.mp4',
    })).toMatchObject({ decision: 'stale-binding' })
    expect(changes).toHaveLength(2)

    const nextAdapter = new PageProbeCaptureAdapter({
      binding: nextNavigation.binding,
      emitChange: change => changes.push(change),
      now: () => now,
      store,
    })
    expect(nextAdapter.capture({
      kind: 'subtitle',
      resourceKey: 'page-resource-1',
      url: 'blob:https://page.example/new-subtitle',
    })).toMatchObject({
      decision: 'accepted',
      resource: {
        id: 'resource-2',
        kind: 'subtitle',
      },
    })

    store.setCaptureMode('tab-1', 'network')
    expect(nextAdapter.capture({
      resourceKey: 'network-mode-resource',
      url: 'https://cdn.example/ignored.mp4',
    })).toMatchObject({ decision: 'capture-disabled' })
    expect(nextAdapter.capture({
      url: 'https://cdn.example/missing-key.mp4',
    })).toMatchObject({ decision: 'invalid' })
    expect(changes).toHaveLength(3)
  })
})

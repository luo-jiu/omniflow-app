import { describe, expect, it } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'
import {
  resolveHlsManifestAuthority,
  resolveHlsTrackAuthorities,
} from './hls-manifest-authority'

function createHarness() {
  let contextId = 0
  let resourceId = 0
  const vault = new NetworkContextVault({
    createContextRef: () => `context-${++contextId}`,
  })
  const store = new ResourceStateStore({
    createResourceId: () => `resource-${++resourceId}`,
    releaseContext: contextRef => vault.release(contextRef),
  })
  const registration = store.registerTab({
    pageUrl: 'https://page.example/watch',
    tabId: 'tab-1',
    webContentsId: 41,
  })!
  store.setCaptureMode('tab-1', 'network')

  const addManifest = (input: {
    authorization: string
    requestId: number
    url: string
  }) => {
    expect(vault.recordRequest({
      navigationGeneration: registration.binding.navigationGeneration,
      observedRequestUrl: input.url,
      pageOrigin: registration.binding.pageOrigin!,
      requestHeaders: {
        Authorization: input.authorization,
        Cookie: `session=${input.requestId}`,
      },
      requestId: input.requestId,
      sourceResourceType: 'xhr',
      tabId: 'tab-1',
      webContentsId: 41,
    })).toBe(true)
    const context = vault.promoteRequest({
      navigationGeneration: registration.binding.navigationGeneration,
      observedRequestUrl: input.url,
      purposes: NETWORK_CONTEXT_PURPOSES,
      requestId: input.requestId,
      resourceUrl: input.url,
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
        resourceType: 'xhr',
        url: input.url,
      },
    }).decision).toBe('accepted')
  }

  addManifest({
    authorization: 'Bearer video-secret',
    requestId: 1,
    url: 'https://video.example/track.m3u8',
  })
  addManifest({
    authorization: 'Bearer audio-secret',
    requestId: 2,
    url: 'https://audio.example/track.m3u8',
  })

  const snapshot = store.getSnapshot('tab-1')
  if (!snapshot || snapshot.status !== 'active') throw new Error('Missing active snapshot')
  const videoResourceId = snapshot.resources.find(resource => resource.url.includes('video.example'))?.id
  const audioResourceId = snapshot.resources.find(resource => resource.url.includes('audio.example'))?.id
  if (!videoResourceId || !audioResourceId) throw new Error('Missing manifest resources')

  return {
    access: new CapturedResourceAccessService({
      fetch: (url, init) => fetch(url, init),
      store,
      vault,
    }),
    audioResourceId,
    registration,
    store,
    videoResourceId,
  }
}

describe('HLS manifest authority', () => {
  it('hls.direct-manifest-authority', () => {
    const harness = createHarness()
    const hostileRendererPayload = {
      headers: { authorization: 'Bearer attacker' },
      manifestUrl: 'https://attacker.example/manifest.m3u8',
      resourceId: harness.videoResourceId,
      tabId: 'tab-1',
    }

    expect(resolveHlsManifestAuthority(harness.access, hostileRendererPayload)).toEqual({
      headers: {
        authorization: 'Bearer video-secret',
        cookie: 'session=1',
      },
      manifestUrl: 'https://video.example/track.m3u8',
      resourceId: harness.videoResourceId,
    })
    expect(resolveHlsManifestAuthority(harness.access, {
      resourceId: harness.videoResourceId,
      tabId: 'other-tab',
    })).toBeNull()

    harness.store.commitNavigation({
      binding: harness.registration.binding,
      clearResources: false,
      pageUrl: 'https://page.example/next',
    })
    expect(resolveHlsManifestAuthority(harness.access, hostileRendererPayload)).toBeNull()
  })

  it('hls.track-independent-authority', () => {
    const harness = createHarness()
    const hostileRendererPayload = {
      audioManifestUrl: 'https://attacker.example/audio.m3u8',
      audioResourceId: harness.audioResourceId,
      headers: { authorization: 'Bearer attacker' },
      tabId: 'tab-1',
      videoManifestUrl: 'https://attacker.example/video.m3u8',
      videoResourceId: harness.videoResourceId,
    }

    expect(resolveHlsTrackAuthorities(harness.access, hostileRendererPayload)).toEqual({
      audio: {
        headers: {
          authorization: 'Bearer audio-secret',
          cookie: 'session=2',
        },
        manifestUrl: 'https://audio.example/track.m3u8',
        resourceId: harness.audioResourceId,
      },
      video: {
        headers: {
          authorization: 'Bearer video-secret',
          cookie: 'session=1',
        },
        manifestUrl: 'https://video.example/track.m3u8',
        resourceId: harness.videoResourceId,
      },
    })
    expect(resolveHlsTrackAuthorities(harness.access, {
      audioResourceId: 'missing-audio',
      tabId: 'tab-1',
      videoResourceId: harness.videoResourceId,
    })).toBeNull()
  })
})

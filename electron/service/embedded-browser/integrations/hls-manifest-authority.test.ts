import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  NETWORK_CONTEXT_PURPOSES,
  NetworkContextVault,
} from '../capture/state/network-context-vault'
import { ResourceStateStore } from '../capture/state/resource-state-store'
import { CapturedResourceAccessService } from './captured-resource-access'
import {
  resolveHlsCapturedMediaPlan,
  resolveHlsLiveParentVariableList,
  resolveHlsManifestAuthority,
  resolveHlsTrackParentVariableList,
  resolveHlsTrackAuthorities,
} from './hls-manifest-authority'

function createHarness(fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)) {
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
  addManifest({
    authorization: 'Bearer master-secret',
    requestId: 3,
    url: 'https://origin.example/master.m3u8?token=abc%2F123&cdn=edge.example',
  })

  const snapshot = store.getSnapshot('tab-1')
  if (!snapshot || snapshot.status !== 'active') throw new Error('Missing active snapshot')
  const videoResourceId = snapshot.resources.find(resource => resource.url.includes('video.example'))?.id
  const audioResourceId = snapshot.resources.find(resource => resource.url.includes('audio.example'))?.id
  const masterResourceId = snapshot.resources.find(resource => resource.url.includes('origin.example'))?.id
  if (!videoResourceId || !audioResourceId || !masterResourceId) throw new Error('Missing manifest resources')

  return {
    access: new CapturedResourceAccessService({
      fetch: fetchImpl,
      store,
      vault,
    }),
    audioResourceId,
    masterResourceId,
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

  it('hls.live-parent-variable-authority', async () => {
    const masterPlaylist = readFileSync(
      new URL('../../../../tools/cat-catch-lab/fixtures/hls-variable-substitution/master.m3u8', import.meta.url),
      'utf8',
    )
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer master-secret')
      expect(headers.get('cookie')).toBe('session=3')
      return new Response(masterPlaylist)
    })
    const harness = createHarness(fetchImpl)
    const selectedManifestUrl = 'https://edge.example/assets/abc/123/video/index.m3u8?session=media%20query'

    await expect(resolveHlsLiveParentVariableList(harness.access, {
      selectedManifestUrl,
      sourceResourceId: harness.masterResourceId,
      tabId: 'tab-1',
    })).resolves.toEqual({
      cdn: 'edge.example',
      root: 'https://edge.example/assets/abc/123',
      token: 'abc/123',
    })
    await expect(resolveHlsLiveParentVariableList(harness.access, {
      selectedManifestUrl: 'https://attacker.example/live.m3u8',
      sourceResourceId: harness.masterResourceId,
      tabId: 'tab-1',
    })).rejects.toThrow('所选直播 playlist 不属于当前 captured master')
    await expect(resolveHlsLiveParentVariableList(harness.access, {
      selectedManifestUrl: 'https://video.example/track.m3u8',
      sourceResourceId: harness.videoResourceId,
      tabId: 'tab-1',
    })).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('hls.master-rendition-authority', async () => {
    const masterPlaylist = readFileSync(
      new URL('../../../../tools/cat-catch-lab/fixtures/hls-master-rendition-projection/master.m3u8', import.meta.url),
      'utf8',
    )
    const fetchImpl = vi.fn(async () => new Response(masterPlaylist))
    const harness = createHarness(fetchImpl)

    await expect(resolveHlsLiveParentVariableList(harness.access, {
      selectedManifestUrl: 'https://origin.example/audio/en.m3u8',
      sourceResourceId: harness.masterResourceId,
      tabId: 'tab-1',
    })).resolves.toBeUndefined()
    await expect(resolveHlsLiveParentVariableList(harness.access, {
      selectedManifestUrl: 'https://origin.example/cc/weird.m3u8',
      sourceResourceId: harness.masterResourceId,
      tabId: 'tab-1',
    })).rejects.toThrow('所选直播 playlist 不属于当前 captured master')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('hls.segment-query-track-plan-authority', async () => {
    const masterPlaylist = [
      '#EXTM3U',
      '#EXT-X-DEFINE:NAME="token",VALUE="parent-token"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",URI="https://audio.example/track.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"',
      'https://video.example/track.m3u8',
    ].join('\n')
    const childPlaylist = (kind: 'audio' | 'video') => [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-DEFINE:IMPORT="token"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?keep=1"',
      '#EXT-X-MAP:URI="init.mp4?keep=1"',
      '#EXTINF:4,',
      `${kind}-{$token}.ts?old=1`,
      '#EXT-X-ENDLIST',
    ].join('\n')
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      if (url.includes('origin.example')) {
        expect(headers.get('authorization')).toBe('Bearer master-secret')
        return new Response(masterPlaylist)
      }
      expect(headers.get('authorization')).toBe(
        url.includes('audio.example') ? 'Bearer audio-secret' : 'Bearer video-secret',
      )
      return new Response(childPlaylist(url.includes('audio.example') ? 'audio' : 'video'))
    })
    const harness = createHarness(fetchImpl)
    const parentVariableList = await resolveHlsTrackParentVariableList(harness.access, {
      audioManifestUrl: 'https://audio.example/track.m3u8',
      sourceResourceId: harness.masterResourceId,
      tabId: 'tab-1',
      videoManifestUrl: 'https://video.example/track.m3u8',
    })

    await expect(Promise.all([
      resolveHlsCapturedMediaPlan(harness.access, {
        parentVariableList,
        resourceId: harness.videoResourceId,
        segmentQuery: 'token=new',
        tabId: 'tab-1',
      }),
      resolveHlsCapturedMediaPlan(harness.access, {
        parentVariableList,
        resourceId: harness.audioResourceId,
        segmentQuery: 'token=new',
        tabId: 'tab-1',
      }),
    ])).resolves.toEqual([
      expect.objectContaining({
        plan: expect.objectContaining({
          fragments: [expect.objectContaining({
            initSegment: expect.objectContaining({ url: 'https://video.example/init.mp4?keep=1' }),
            key: expect.objectContaining({ url: 'https://video.example/key.bin?keep=1' }),
            url: 'https://video.example/video-parent-token.ts?token=new',
          })],
        }),
      }),
      expect.objectContaining({
        plan: expect.objectContaining({
          fragments: [expect.objectContaining({
            initSegment: expect.objectContaining({ url: 'https://audio.example/init.mp4?keep=1' }),
            key: expect.objectContaining({ url: 'https://audio.example/key.bin?keep=1' }),
            url: 'https://audio.example/audio-parent-token.ts?token=new',
          })],
        }),
      }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries a captured media playlist once with force-cache', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4,',
      'segment.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer video-secret')
      return init.cache === 'force-cache'
        ? new Response(playlist)
        : new Response('temporary failure', { status: 503 })
    })
    const harness = createHarness(fetchImpl)

    await expect(resolveHlsCapturedMediaPlan(harness.access, {
      resourceId: harness.videoResourceId,
      segmentQuery: '',
      tabId: 'tab-1',
    })).resolves.toEqual(expect.objectContaining({
      plan: expect.objectContaining({
        fragments: [expect.objectContaining({ url: 'https://video.example/segment.ts' })],
      }),
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]?.[1].cache).toBe('force-cache')
  })

  it('hls.effective-url-authority', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4,',
      'segment one.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
    const harness = createHarness(async () => new Response(playlist))
    const canonicalFragmentUrl = 'https://video.example/segment%20one.ts'
    const capturedFragment = harness.store.recordNetworkResource({
      binding: harness.registration.binding,
      metadata: {
        kind: 'media',
        resourceType: 'xhr',
        url: canonicalFragmentUrl,
      },
    })
    expect(capturedFragment.decision).toBe('accepted')

    const result = await resolveHlsCapturedMediaPlan(harness.access, {
      resourceId: harness.videoResourceId,
      tabId: 'tab-1',
    })
    expect(result?.plan.fragments[0]?.url).toBe(canonicalFragmentUrl)
    expect(harness.store.getOwnedResourceByUrl(
      'tab-1',
      result?.plan.fragments[0]?.url || '',
    )?.id).toBe(capturedFragment.resource?.id)
  })
})

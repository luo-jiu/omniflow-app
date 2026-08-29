import { describe, expect, it, vi } from 'vitest'

import {
  createDashLiveSnapshotLoader,
  DEFAULT_DASH_MPD_MAX_BYTES,
  loadDashLiveSnapshot,
} from './dash-live-adapter'

const dynamicMpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" minimumUpdatePeriod="PT2S" availabilityStartTime="2026-08-29T12:00:00Z">
  <BaseURL>video/</BaseURL>
  <Period id="p0">
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate timescale="1" media="seg-$Number$.m4s" initialization="init.mp4" duration="2" startNumber="10" />
      <Representation id="v1" bandwidth="1000000" width="1280" height="720" />
    </AdaptationSet>
  </Period>
</MPD>`

describe('DASH live MPD adapter', () => {
  it('dash.main-xml-adapter', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://origin.example/live.mpd')
      expect(new Headers(init?.headers).get('accept')).toBe('application/dash+xml')
      expect(init?.signal).toBeDefined()
      return new Response(dynamicMpd, {
        headers: { 'content-type': 'application/dash+xml' },
        status: 200,
      })
    })
    const signal = new AbortController().signal
    const plan = await loadDashLiveSnapshot({
      clientOffsetMs: 1000,
      fetch,
      headers: { accept: 'application/dash+xml' },
      manifestUrl: 'https://origin.example/live.mpd',
      nowMs: () => Date.parse('2026-08-29T12:00:10Z'),
      signal,
    })

    expect(plan).toMatchObject({
      hasDrm: false,
      isDynamic: true,
      manifestUrl: 'https://origin.example/live.mpd',
      minimumUpdatePeriodSeconds: 2,
    })
    expect(plan.representations[0]).toMatchObject({
      baseUrls: ['https://origin.example/video/'],
      id: 'v1',
      initializationUrl: 'https://origin.example/video/init.mp4',
    })
    expect(plan.representations[0]?.segments.map(segment => segment.number)).toEqual([10, 11, 12, 13, 14])
  })

  it('returns a loader that keeps the original manifest URL across refreshes', async () => {
    const fetch = vi.fn(async () => new Response(dynamicMpd, { status: 200 }))
    const loader = createDashLiveSnapshotLoader({
      fetch,
      manifestUrl: 'https://origin.example/live.mpd',
    })
    await loader({ signal: new AbortController().signal })
    await loader({
      previousPlan: {
        hasDrm: false,
        isDynamic: true,
        manifestUrl: 'https://origin.example/live.mpd',
        representations: [],
      },
      signal: new AbortController().signal,
    })
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://origin.example/live.mpd', expect.any(Object))
  })

  it.each([
    [404, 'HTTP 404'],
    [500, 'HTTP 500'],
  ])('rejects non-success responses (%s)', async (status, reason) => {
    await expect(loadDashLiveSnapshot({
      fetch: async () => new Response('', { status }),
      manifestUrl: 'https://origin.example/live.mpd',
    })).rejects.toThrow(reason)
  })

  it('rejects malformed XML and XML external entity declarations', async () => {
    await expect(loadDashLiveSnapshot({
      fetch: async () => new Response('<MPD><Period>', { status: 200 }),
      manifestUrl: 'https://origin.example/live.mpd',
    })).rejects.toThrow('XML 解析失败')
    await expect(loadDashLiveSnapshot({
      fetch: async () => new Response('<!DOCTYPE MPD [<!ENTITY x SYSTEM "file:///tmp/x">]><MPD/>', { status: 200 }),
      manifestUrl: 'https://origin.example/live.mpd',
    })).rejects.toThrow('DOCTYPE 或 ENTITY')
  })

  it('enforces the MPD byte limit before building an AST', async () => {
    const oversized = 'x'.repeat(DEFAULT_DASH_MPD_MAX_BYTES + 1)
    await expect(loadDashLiveSnapshot({
      fetch: async () => new Response(oversized, {
        headers: { 'content-length': String(oversized.length) },
        status: 200,
      }),
      manifestUrl: 'https://origin.example/live.mpd',
    })).rejects.toThrow(`${DEFAULT_DASH_MPD_MAX_BYTES} 字节限制`)
  })

  it('propagates cancellation to the fetch and aborts before parsing', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      observedSignal = init?.signal || undefined
      controller.abort()
      return new Response(dynamicMpd, { status: 200 })
    })
    await expect(loadDashLiveSnapshot({
      fetch,
      manifestUrl: 'https://origin.example/live.mpd',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(observedSignal).toBe(controller.signal)
  })
})

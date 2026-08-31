import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import type { DashRepresentation } from './embedded-browser/cat-catch-port/dash/parser'
import { appendDashRepresentationSegments } from './embedded-browser/processing/dash-task'
import type { DashTaskPlan } from './embedded-browser/processing/dash-task'
import { DashLiveTask } from './embedded-browser/processing/dash-live-task'
import { HlsLiveTask } from './embedded-browser/processing/hls-live-task'

const ENABLED = process.env.CAT_CATCH_LIVE_WALL_CLOCK === '1'
const MIN_DURATION_MS = 60_000
const MAX_DURATION_MS = 60 * 60_000
const DEFAULT_DURATION_MS = 5 * 60_000
const RSS_BUDGET_BYTES = 512 * 1024 * 1024
const SEGMENT_BYTES = 64 * 1024
const HLS_MANIFEST_URL = 'https://live.example/channel/index.m3u8'
const DASH_MANIFEST_URL = 'https://live.example/channel/index.mpd'

function readDurationMs() {
  const configured = Number(process.env.CAT_CATCH_LIVE_WALL_CLOCK_MS || DEFAULT_DURATION_MS)
  if (!Number.isFinite(configured) || configured < MIN_DURATION_MS || configured > MAX_DURATION_MS) {
    throw new Error(`CAT_CATCH_LIVE_WALL_CLOCK_MS must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}`)
  }
  return Math.floor(configured)
}

function createHlsManifest(firstSequence: number) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:1',
    `#EXT-X-MEDIA-SEQUENCE:${firstSequence}`,
    ...Array.from({ length: 3 }, (_, index) => (
      `#EXTINF:1,\nsegment-${firstSequence + index}.ts`
    )),
    '',
  ].join('\n')
}

function createDashRepresentation(firstSequence: number): DashRepresentation {
  const segments = Array.from({ length: 3 }, (_, index) => {
    const number = firstSequence + index
    return {
      duration: 1,
      index,
      number,
      url: `https://live.example/channel/segment-${number}.m4s`,
    }
  })
  return {
    baseUrls: ['https://live.example/channel/'],
    contentType: 'video',
    id: 'video-main',
    initializationUrl: 'https://live.example/channel/init.mp4',
    segmentCount: segments.length,
    segments,
    unsupportedReasons: [],
  }
}

function createDashPlan(firstSequence: number): DashTaskPlan {
  return {
    hasDrm: false,
    isDynamic: true,
    manifestUrl: DASH_MANIFEST_URL,
    minimumUpdatePeriodSeconds: 1,
    representations: [createDashRepresentation(firstSequence)],
  }
}

function createSegmentResponse(url: string) {
  const sequence = Number(/segment-(\d+)/u.exec(url)?.[1] || 0)
  return new Response(new Uint8Array(SEGMENT_BYTES).fill(sequence % 251), { status: 200 })
}

describe.skipIf(!ENABLED)('Embedded browser live wall-clock smoke', () => {
  it('hls-dash.real-wall-clock-output-and-cleanup', async () => {
    const durationMs = readDurationMs()
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-live-wall-clock-'))
    const hlsWorkPath = path.join(rootPath, 'hls')
    const dashTrackPath = path.join(rootPath, 'dash-video-track.bin')
    const hlsSegmentRequests = new Map<number, number>()
    const dashSegmentRequests = new Map<number, number>()
    let hlsManifestRequests = 0
    let dashSnapshotRequests = 0
    let peakRssBytes = process.memoryUsage().rss
    await mkdir(hlsWorkPath)

    const hlsTask = new HlsLiveTask({
      fetch: async (url: string) => {
        if (url === HLS_MANIFEST_URL) {
          const response = new Response(createHlsManifest(1000 + hlsManifestRequests), { status: 200 })
          hlsManifestRequests += 1
          return response
        }
        const sequence = Number(/segment-(\d+)\.ts$/u.exec(url)?.[1])
        if (!Number.isFinite(sequence)) return new Response('not found', { status: 404 })
        hlsSegmentRequests.set(sequence, (hlsSegmentRequests.get(sequence) || 0) + 1)
        return createSegmentResponse(url)
      },
      manifestUrl: HLS_MANIFEST_URL,
      suggestedThreadCount: 4,
      workDirectoryPath: hlsWorkPath,
    })
    const dashTask = new DashLiveTask({
      loadSnapshot: async () => {
        const snapshot = createDashPlan(2000 + dashSnapshotRequests)
        dashSnapshotRequests += 1
        return snapshot
      },
      minPollIntervalMs: 250,
      maxPollIntervalMs: 2000,
      onNewSegments: async (delta, signal) => {
        for (const representation of delta.representations) {
          await appendDashRepresentationSegments(representation, dashTrackPath, {
            appendInitialization: dashSegmentRequests.size === 0,
            fetch: async (url: string) => {
              if (url.endsWith('/init.mp4')) {
                return new Response(new Uint8Array(SEGMENT_BYTES).fill(255), { status: 200 })
              }
              const sequence = Number(/segment-(\d+)\.m4s$/u.exec(url)?.[1])
              if (!Number.isFinite(sequence)) return new Response('not found', { status: 404 })
              dashSegmentRequests.set(sequence, (dashSegmentRequests.get(sequence) || 0) + 1)
              return createSegmentResponse(url)
            },
            signal,
            threadCount: 4,
          })
        }
      },
      pollIntervalMs: 1000,
    })
    const rssSampler = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
    }, 1000)

    const startedAt = Date.now()
    try {
      await Promise.all([hlsTask.start(), dashTask.start()])
      await new Promise(resolve => setTimeout(resolve, durationMs))
      const [hlsResult, dashResult] = await Promise.all([hlsTask.stop(), dashTask.stop()])
      const elapsedMs = Date.now() - startedAt
      const hlsManifestRequestsAtStop = hlsManifestRequests
      const dashSnapshotRequestsAtStop = dashSnapshotRequests

      await new Promise(resolve => setTimeout(resolve, 2000))

      expect(elapsedMs).toBeGreaterThanOrEqual(durationMs)
      expect(hlsManifestRequests).toBe(hlsManifestRequestsAtStop)
      expect(dashSnapshotRequests).toBe(dashSnapshotRequestsAtStop)
      expect(hlsManifestRequests).toBeGreaterThanOrEqual(Math.floor(durationMs / 2000))
      expect(dashSnapshotRequests).toBeGreaterThanOrEqual(Math.floor(durationMs / 1500))
      expect([...hlsSegmentRequests.values()]).toEqual(
        Array.from({ length: hlsSegmentRequests.size }, () => 1),
      )
      expect([...dashSegmentRequests.values()]).toEqual(
        Array.from({ length: dashSegmentRequests.size }, () => 1),
      )
      expect(hlsResult.totalFragments).toBe(hlsSegmentRequests.size)
      expect(dashResult.totalSegments).toBe(dashSegmentRequests.size)
      expect((await readFile(hlsResult.playlistPath, 'utf8')).match(/#EXTINF:/gu))
        .toHaveLength(hlsResult.totalFragments)
      expect((await stat(dashTrackPath)).size)
        .toBe((dashSegmentRequests.size + 1) * SEGMENT_BYTES)
      expect((await readdir(rootPath)).some(name => name.includes('.parts-'))).toBe(false)
      expect(peakRssBytes).toBeLessThan(RSS_BUDGET_BYTES)

      console.info(JSON.stringify({
        dashSegments: dashResult.totalSegments,
        dashSnapshots: dashSnapshotRequests,
        durationMs: elapsedMs,
        hlsFragments: hlsResult.totalFragments,
        hlsManifests: hlsManifestRequests,
        peakRssBytes,
      }))
    } finally {
      clearInterval(rssSampler)
      await Promise.allSettled([hlsTask.discard(), dashTask.discard()])
      await rm(rootPath, { force: true, recursive: true })
    }
  }, readDurationMs() + 30_000)
})

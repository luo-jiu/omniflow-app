import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import { parseHlsManifest } from './embedded-browser/cat-catch-port/hls/parser'
import { createHlsDownloadPlan } from './embedded-browser/cat-catch-port/hls/plan'
import type { EmbeddedBrowserHlsDownloadPlan } from './embedded-browser/contracts/hls'
import { loadDashLiveSnapshot } from './embedded-browser/processing/dash-live-adapter'
import { mergeDashTaskTracksToOutput } from './embedded-browser/processing/dash-output'
import {
  DashTaskExecutor,
  type DashTaskPlan,
} from './embedded-browser/processing/dash-task'
import { defaultHlsTaskExecutor } from './embedded-browser/processing/hls-task'
import { downloadEmbeddedBrowserManifestResource } from './embeddedBrowserResourceManifestDownloadService'

const ENABLED = process.env.CAT_CATCH_REAL_WEBSITE_MEDIA === '1'
const HLS_MASTER_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
const DASH_MANIFEST_URL = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd'
const SAMPLE_FRAGMENT_COUNT = 3
const REQUEST_TIMEOUT_MS = 20_000
const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return fetch(url, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal,
  })
}

async function fetchManifest(url: string) {
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`真实媒体 manifest 请求失败：HTTP ${response.status}`)
  return response.text()
}

function samplePlan(plan: EmbeddedBrowserHlsDownloadPlan) {
  const fragments = plan.fragments.slice(0, SAMPLE_FRAGMENT_COUNT)
  const sequences = new Set(fragments.map(fragment => fragment.sequence))
  const segments = plan.segments.filter(segment => sequences.has(segment.sequence))
  return {
    ...plan,
    durationSeconds: fragments.reduce((sum, fragment) => sum + fragment.duration, 0),
    fragmentCount: fragments.length,
    fragments,
    segmentCount: segments.length,
    segments,
  }
}

function sampleDashRepresentation(
  representation: DashTaskPlan['representations'][number],
) {
  const segments = representation.segments.slice(0, SAMPLE_FRAGMENT_COUNT)
  return {
    ...representation,
    segmentCount: segments.length,
    segments,
  }
}

function probeMediaOutput(outputPath: string) {
  const probeResult = spawnSync(ffprobePath!, [
    '-v',
    'error',
    '-show_entries',
    'format=format_name,duration:stream=codec_name,codec_type',
    '-of',
    'json',
    outputPath,
  ], {
    encoding: 'utf8',
    timeout: REQUEST_TIMEOUT_MS,
  })
  expect(probeResult.status, probeResult.stderr).toBe(0)
  return JSON.parse(probeResult.stdout) as {
    format?: { duration?: string; format_name?: string }
    streams?: Array<{ codec_name?: string; codec_type?: string }>
  }
}

function expectH264AacMp4(probe: ReturnType<typeof probeMediaOutput>) {
  expect(probe.format?.format_name).toContain('mp4')
  expect(probe.streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_name: 'h264', codec_type: 'video' }),
    expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' }),
  ]))
}

describe.skipIf(!ENABLED || !ffmpegPath || !ffprobePath)('Embedded browser real website media smoke', () => {
  it('hls.real-website-parser-download-ffprobe', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-real-website-media-'))
    const workDirectoryPath = path.join(rootPath, 'hls-work')
    const outputPath = path.join(rootPath, 'output.mp4')
    const requestedFragments = new Map<string, number>()

    try {
      await mkdir(workDirectoryPath)
      const masterText = await fetchManifest(HLS_MASTER_URL)
      const masterManifest = parseHlsManifest({ baseUrl: HLS_MASTER_URL, text: masterText })
      const masterPlan = createHlsDownloadPlan({ manifest: masterManifest, manifestUrl: HLS_MASTER_URL })
      const selectedVariant = [...masterPlan.variants]
        .sort((left, right) => Number(left.bandwidth || 0) - Number(right.bandwidth || 0))[0]

      expect(masterPlan.isMaster).toBe(true)
      expect(masterPlan.variants).toHaveLength(5)
      expect(selectedVariant?.resolution).toBe('320x184')
      expect(selectedVariant?.url).toContain('test-streams.mux.dev/x36xhzz/url_2/')

      const mediaUrl = selectedVariant!.url
      const mediaText = await fetchManifest(mediaUrl)
      const mediaManifest = parseHlsManifest({ baseUrl: mediaUrl, text: mediaText })
      const mediaPlan = createHlsDownloadPlan({ manifest: mediaManifest, manifestUrl: mediaUrl })
      const plan = samplePlan(mediaPlan)

      expect(mediaPlan.isMaster).toBe(false)
      expect(mediaPlan.isLive).toBe(false)
      expect(mediaPlan.fragmentCount).toBe(64)
      expect(plan.fragmentCount).toBe(SAMPLE_FRAGMENT_COUNT)
      expect(plan.durationSeconds).toBe(30)

      const result = await defaultHlsTaskExecutor.executePlanToOutput({
        fetch: async (url, init) => {
          requestedFragments.set(url, (requestedFragments.get(url) || 0) + 1)
          return fetchWithTimeout(url, init)
        },
        outputPath,
        plan,
        runFfmpeg: input => downloadEmbeddedBrowserManifestResource({
          ...input,
          kind: 'hls',
        }),
        workDirectoryPath,
      })

      expect([...requestedFragments.values()]).toEqual(
        Array.from({ length: SAMPLE_FRAGMENT_COUNT }, () => 1),
      )
      expect((await stat(result.outputPath)).size).toBeGreaterThan(100_000)

      const probe = probeMediaOutput(result.outputPath)
      expectH264AacMp4(probe)
      expect(Number(probe.format?.duration || 0)).toBeGreaterThan(20)
      expect(Number(probe.format?.duration || 0)).toBeLessThanOrEqual(31)

      console.info(JSON.stringify({
        durationSeconds: Number(probe.format?.duration || 0),
        fragmentCount: requestedFragments.size,
        outputBytes: (await stat(result.outputPath)).size,
        source: new URL(HLS_MASTER_URL).host,
        variant: selectedVariant?.resolution,
      }))
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  }, 90_000)

  it('dash.real-website-parser-download-ffprobe', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-real-website-dash-'))
    const workDirectoryPath = path.join(rootPath, 'dash-work')
    const outputPath = path.join(rootPath, 'output.mp4')
    const requestedFragments = new Map<string, number>()

    try {
      await mkdir(workDirectoryPath)
      const sourcePlan = await loadDashLiveSnapshot({
        fetch: fetchWithTimeout,
        manifestUrl: DASH_MANIFEST_URL,
      })
      const sourceVideo = sourcePlan.representations
        .filter(item => item.contentType === 'video' && item.codecs?.startsWith('avc1'))
        .sort((left, right) => Number(left.bandwidth || 0) - Number(right.bandwidth || 0))[0]
      const sourceAudio = sourcePlan.representations
        .filter(item => item.contentType === 'audio' && item.codecs?.startsWith('mp4a'))
        .sort((left, right) => Number(left.bandwidth || 0) - Number(right.bandwidth || 0))[0]

      expect(sourcePlan.isDynamic).toBe(false)
      expect(sourcePlan.hasDrm).toBe(false)
      expect(sourcePlan.durationSeconds).toBeCloseTo(634.566, 3)
      expect(sourceVideo?.id).toBe('bbb_30fps_320x180_200k')
      expect(sourceAudio?.id).toBe('bbb_a64k')

      const video = sampleDashRepresentation(sourceVideo!)
      const audio = sampleDashRepresentation(sourceAudio!)
      const sampleDurationSeconds = video.segments.reduce(
        (sum, segment) => sum + Number(segment.duration || 0),
        0,
      )
      const plan: DashTaskPlan = {
        ...sourcePlan,
        durationSeconds: sampleDurationSeconds,
        representations: [video, audio],
      }

      expect(video.initializationUrl).toContain('/bbb_30fps_320x180_200k_0.m4v')
      expect(video.segments).toHaveLength(SAMPLE_FRAGMENT_COUNT)
      expect(audio.initializationUrl).toContain('/bbb_a64k_0.m4a')
      expect(audio.segments).toHaveLength(SAMPLE_FRAGMENT_COUNT)
      expect(sampleDurationSeconds).toBe(12)

      const result = await new DashTaskExecutor({
        fetch: async (url, init) => {
          requestedFragments.set(url, (requestedFragments.get(url) || 0) + 1)
          return fetchWithTimeout(url, init)
        },
        mergeTracks: input => mergeDashTaskTracksToOutput({
          ...input,
          durationSeconds: sampleDurationSeconds,
          ffmpegPath: ffmpegPath!,
        }),
        outputPath,
        plan,
        selectedAudioRepresentation: audio,
        selectedVideoRepresentation: video,
        workDirectoryPath,
      }).run()

      expect(requestedFragments.size).toBe((SAMPLE_FRAGMENT_COUNT + 1) * 2)
      expect([...requestedFragments.values()]).toEqual(
        Array.from({ length: requestedFragments.size }, () => 1),
      )
      expect((await stat(result.outputPath)).size).toBeGreaterThan(100_000)

      const probe = probeMediaOutput(result.outputPath)
      expectH264AacMp4(probe)
      expect(Number(probe.format?.duration || 0)).toBeGreaterThan(10)
      expect(Number(probe.format?.duration || 0)).toBeLessThan(14)

      console.info(JSON.stringify({
        audio: sourceAudio?.id,
        durationSeconds: Number(probe.format?.duration || 0),
        fragmentCount: requestedFragments.size,
        outputBytes: (await stat(result.outputPath)).size,
        source: new URL(DASH_MANIFEST_URL).host,
        video: sourceVideo?.id,
      }))
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  }, 90_000)
})

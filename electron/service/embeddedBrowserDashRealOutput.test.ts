import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import {
  loadDashLiveSnapshot,
} from './embedded-browser/processing/dash-live-adapter'
import {
  DashLiveTask,
} from './embedded-browser/processing/dash-live-task'
import {
  appendDashRepresentationSegments,
  DashTaskExecutor,
} from './embedded-browser/processing/dash-task'
import type { DashTaskPlan } from './embedded-browser/processing/dash-task'
import {
  mergeDashTaskTracksToOutput,
} from './embedded-browser/processing/dash-output'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

function makeDynamicMpd(input: string, limitSegments?: number) {
  const document = new DOMParser().parseFromString(input, 'application/xml')
  const root = document.documentElement
  root.setAttribute('type', 'dynamic')
  root.removeAttribute('mediaPresentationDuration')
  root.setAttribute('minimumUpdatePeriod', 'PT0.5S')
  root.setAttribute('availabilityStartTime', '2026-08-29T12:00:00Z')

  if (limitSegments !== undefined) {
    const timelines = document.getElementsByTagName('SegmentTimeline')
    for (let index = 0; index < timelines.length; index += 1) {
      const timeline = timelines.item(index)
      if (!timeline) continue
      const sourceSegments = Array.from(timeline.getElementsByTagName('S'))
      const expanded: Array<{ duration: string; time: number }> = []
      let currentTime = 0
      sourceSegments.forEach(segment => {
        const duration = Number(segment.getAttribute('d') || 0)
        if (!Number.isFinite(duration) || duration <= 0) return
        const explicitTime = Number(segment.getAttribute('t') || '')
        if (Number.isFinite(explicitTime)) currentTime = explicitTime
        const repeat = Number(segment.getAttribute('r') || 0)
        const count = Number.isInteger(repeat) && repeat >= 0 ? repeat + 1 : 1
        for (let repeatIndex = 0; repeatIndex < count && expanded.length < limitSegments; repeatIndex += 1) {
          expanded.push({ duration: String(duration), time: currentTime })
          currentTime += duration
        }
      })
      while (timeline.firstChild) timeline.removeChild(timeline.firstChild)
      expanded.forEach(item => {
        const segment = document.createElement('S')
        segment.setAttribute('t', String(item.time))
        segment.setAttribute('d', item.duration)
        timeline.appendChild(segment)
      })
    }
  }

  return new XMLSerializer().serializeToString(document)
}

async function expectDashOutput(outputPath: string) {
  const output = await stat(outputPath)
  expect(output.isFile()).toBe(true)
  expect(output.size).toBeGreaterThan(0)
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
    timeout: 10_000,
  })
  expect(probeResult.status, probeResult.stderr).toBe(0)
  const probe = JSON.parse(probeResult.stdout) as {
    format?: {
      duration?: string
      format_name?: string
    }
    streams?: Array<{
      codec_name?: string
      codec_type?: string
    }>
  }
  expect(probe.format?.format_name).toContain('mp4')
  expect(Number(probe.format?.duration || 0)).toBeGreaterThan(0)
  expect(probe.streams).toEqual(expect.arrayContaining([
    expect.objectContaining({ codec_name: 'h264', codec_type: 'video' }),
    expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' }),
  ]))
}

describe.skipIf(!ffmpegPath || !ffprobePath)('EmbeddedBrowser real DASH output', () => {
  it('dash.real-ffmpeg-ffprobe-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-real-output-test-'))
    const sourceMpdPath = path.join(directory, 'source.mpd')
    const outputPath = path.join(directory, 'output.mp4')
    const manifestUrl = 'https://media.example/source.mpd'

    try {
      const generateResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=128x72:rate=25:duration=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=1',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'dash',
        '-seg_duration',
        '0.5',
        '-use_template',
        '1',
        '-use_timeline',
        '1',
        '-init_seg_name',
        'init-$RepresentationID$.m4s',
        '-media_seg_name',
        'chunk-$RepresentationID$-$Number%05d$.m4s',
        sourceMpdPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateResult.status, generateResult.stderr).toBe(0)

      const fetchAsset = async (url: string) => {
        const assetPath = path.join(directory, path.basename(new URL(url).pathname))
        return new Response(await readFile(assetPath), { status: 200 })
      }
      const plan = await loadDashLiveSnapshot({
        fetch: async (url) => {
          if (url === manifestUrl) return new Response(await readFile(sourceMpdPath), { status: 200 })
          return fetchAsset(url)
        },
        manifestUrl,
      })
      const video = plan.representations.find(item => item.contentType === 'video')
      const audio = plan.representations.find(item => item.contentType === 'audio')
      expect(video?.segments.length).toBeGreaterThan(0)
      expect(audio?.segments.length).toBeGreaterThan(0)

      const result = await new DashTaskExecutor({
        fetch: fetchAsset,
        mergeTracks: input => mergeDashTaskTracksToOutput({
          ...input,
          durationSeconds: plan.durationSeconds,
          ffmpegPath: ffmpegPath!,
        }),
        outputPath,
        plan,
        selectedAudioRepresentation: audio,
        selectedVideoRepresentation: video,
      }).run()

      expect(result.outputPath).toBe(outputPath)
      await expectDashOutput(outputPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('dash.real-dynamic-refresh-append-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-real-live-output-test-'))
    const sourceMpdPath = path.join(directory, 'source.mpd')
    const outputPath = path.join(directory, 'output.mp4')
    const videoTrackPath = path.join(directory, 'video-track.bin')
    const audioTrackPath = path.join(directory, 'audio-track.bin')
    const manifestUrl = 'https://media.example/live.mpd'

    try {
      const generateResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=128x72:rate=25:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=3',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-g',
        '13',
        '-keyint_min',
        '13',
        '-sc_threshold',
        '0',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'dash',
        '-seg_duration',
        '0.5',
        '-use_template',
        '1',
        '-use_timeline',
        '1',
        '-init_seg_name',
        'init-$RepresentationID$.m4s',
        '-media_seg_name',
        'chunk-$RepresentationID$-$Number%05d$.m4s',
        sourceMpdPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateResult.status, generateResult.stderr).toBe(0)

      const sourceMpd = await readFile(sourceMpdPath, 'utf8')
      const snapshots = [makeDynamicMpd(sourceMpd, 2), makeDynamicMpd(sourceMpd)]
      const fetchAsset = async (url: string, init?: RequestInit) => {
        if (url === manifestUrl) {
          const snapshot = snapshots.shift()
          if (!snapshot) throw new Error('unexpected extra DASH MPD refresh')
          return new Response(snapshot, { status: 200 })
        }
        const assetPath = path.join(directory, path.basename(new URL(url).pathname))
        return new Response(await readFile(assetPath), { status: 200, headers: init?.headers })
      }
      const appendInitialized = new Set<string>()
      const appendSegments = async (
        representation: DashTaskPlan['representations'][number] | undefined,
        outputTrackPath: string,
      ) => {
        if (!representation) return
        await appendDashRepresentationSegments(representation, outputTrackPath, {
          appendInitialization: !appendInitialized.has(representation.id),
          fetch: fetchAsset,
          signal: deltaSignal,
        })
        appendInitialized.add(representation.id)
      }
      const deltaSignal = new AbortController().signal
      const refreshCallbacks: Array<() => void> = []
      const appendedCounts: number[] = []
      const task = new DashLiveTask({
        loadSnapshot: async ({ signal }) => loadDashLiveSnapshot({
          fetch: fetchAsset,
          manifestUrl,
          nowMs: () => Date.parse('2026-08-29T12:00:10Z'),
          signal,
        }),
        onNewSegments: async ({ representations }) => {
          for (const representation of representations) {
            if (representation.contentType === 'video') {
              await appendSegments(representation, videoTrackPath)
            } else if (representation.contentType === 'audio') {
              await appendSegments(representation, audioTrackPath)
            }
          }
          appendedCounts.push(representations.reduce((sum, representation) => sum + representation.segments.length, 0))
        },
        schedule: callback => {
          refreshCallbacks.push(callback)
          return callback as unknown as ReturnType<typeof setTimeout>
        },
        clearSchedule: handle => {
          const callback = handle as unknown as () => void
          const index = refreshCallbacks.indexOf(callback)
          if (index >= 0) refreshCallbacks.splice(index, 1)
        },
      })

      // Feed the first snapshot through the same live owner used by production.
      await task.start()
      expect(appendedCounts).toEqual([4])
      refreshCallbacks.shift()?.()
      await vi.waitFor(() => {
        expect(appendedCounts).toHaveLength(2)
        expect(appendedCounts[1]).toBeGreaterThan(appendedCounts[0] || 0)
      })
      const stopped = await task.stop()
      expect(stopped.totalSegments).toBeGreaterThan(10)

      const result = await mergeDashTaskTracksToOutput({
        audio: { path: audioTrackPath, representation: stopped.plan.representations.find(item => item.contentType === 'audio')! },
        durationSeconds: stopped.plan.durationSeconds,
        ffmpegPath: ffmpegPath!,
        outputPath,
        signal: deltaSignal,
        video: { path: videoTrackPath, representation: stopped.plan.representations.find(item => item.contentType === 'video')! },
      })
      expect(result.outputPath).toBe(outputPath)
      await expectDashOutput(outputPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

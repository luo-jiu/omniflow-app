import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import {
  loadDashLiveSnapshot,
} from './embedded-browser/processing/dash-live-adapter'
import {
  DashTaskExecutor,
} from './embedded-browser/processing/dash-task'
import {
  mergeDashTaskTracksToOutput,
} from './embedded-browser/processing/dash-output'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

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
})

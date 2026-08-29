import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import { mergeEmbeddedBrowserResourceTracks } from './embeddedBrowserResourceMergeService'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

async function expectMseOutput(outputPath: string) {
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

describe.skipIf(!ffmpegPath || !ffprobePath)('EmbeddedBrowser real MSE output', () => {
  it('mse.real-ffmpeg-ffprobe-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-real-output-test-'))
    const videoPath = path.join(directory, 'video-track.mp4')
    const audioPath = path.join(directory, 'audio-track.mp4')
    const outputPath = path.join(directory, 'merged-output.mp4')

    try {
      const videoResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=128x72:rate=25:duration=1',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        'empty_moov+default_base_moof',
        '-f',
        'mp4',
        videoPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(videoResult.status, videoResult.stderr).toBe(0)

      const audioResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=1',
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        'empty_moov+default_base_moof',
        '-f',
        'mp4',
        audioPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(audioResult.status, audioResult.stderr).toBe(0)

      const result = await mergeEmbeddedBrowserResourceTracks({
        audio: {
          fileName: 'fixture-audio.mp4',
          filePath: audioPath,
          mimeType: 'audio/mp4',
          resourceKey: 'mse-stream:audio',
          streamType: 'audio',
        },
        ffmpegPath: ffmpegPath!,
        outputPath,
        video: {
          fileName: 'fixture-video.mp4',
          filePath: videoPath,
          mimeType: 'video/mp4',
          resourceKey: 'mse-stream:video',
          streamType: 'video',
        },
      })

      expect(result.outputPath).toBe(outputPath)
      await expectMseOutput(outputPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

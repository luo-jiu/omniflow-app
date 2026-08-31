import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import {
  mergeEmbeddedBrowserResourceTracks,
  transcodeEmbeddedBrowserResource,
} from './embeddedBrowserResourceMergeService'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()
const stressEnabled = process.env.CAT_CATCH_REAL_MEDIA_STRESS === '1'
const MIB = 1024 * 1024
const VIDEO_DURATION_SECONDS = 30
const PCM_DURATION_SECONDS = 20 * 60

function runFixtureFfmpeg(args: string[]) {
  const result = spawnSync(ffmpegPath!, ['-y', '-v', 'error', ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.status, result.stderr).toBe(0)
}

async function probeMedia(filePath: string) {
  const file = await stat(filePath)
  expect(file.isFile()).toBe(true)
  expect(file.size).toBeGreaterThan(0)

  const result = spawnSync(ffprobePath!, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_name,codec_type',
    '-of',
    'json',
    filePath,
  ], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as {
    format?: { duration?: string; size?: string }
    streams?: Array<{ codec_name?: string; codec_type?: string }>
  }
}

describe.skipIf(!stressEnabled || !ffmpegPath || !ffprobePath)('EmbeddedBrowser large real FFmpeg budget', () => {
  it('output.real-large-ffmpeg-merge-transcode-budget', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-ffmpeg-large-media-test-'))
    const videoPath = path.join(directory, 'video.mp4')
    const audioPath = path.join(directory, 'audio.m4a')
    const mergedPath = path.join(directory, 'merged.mp4')
    const pcmPath = path.join(directory, 'source.wav')
    const transcodedPath = path.join(directory, 'transcoded.mp3')

    try {
      runFixtureFfmpeg([
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=1280x720:rate=30:duration=${VIDEO_DURATION_SECONDS}`,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        '40M',
        '-minrate',
        '40M',
        '-maxrate',
        '40M',
        '-bufsize',
        '80M',
        '-x264-params',
        'nal-hrd=cbr:force-cfr=1',
        '-movflags',
        '+faststart',
        videoPath,
      ])
      runFixtureFfmpeg([
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=880:sample_rate=44100:duration=${VIDEO_DURATION_SECONDS}`,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        audioPath,
      ])

      expect((await stat(videoPath)).size).toBeGreaterThan(128 * MIB)
      const merged = await mergeEmbeddedBrowserResourceTracks({
        audio: {
          fileName: 'large-audio.m4a',
          filePath: audioPath,
          mimeType: 'audio/mp4',
          streamType: 'audio',
        },
        ffmpegPath: ffmpegPath!,
        outputPath: mergedPath,
        video: {
          fileName: 'large-video.mp4',
          filePath: videoPath,
          mimeType: 'video/mp4',
          streamType: 'video',
        },
      })
      expect(merged.outputPath).toBe(mergedPath)
      expect((await stat(mergedPath)).size).toBeGreaterThan(128 * MIB)
      const mergedProbe = await probeMedia(mergedPath)
      expect(Number(mergedProbe.format?.duration || 0)).toBeGreaterThanOrEqual(VIDEO_DURATION_SECONDS - 0.1)
      expect(mergedProbe.streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_name: 'h264', codec_type: 'video' }),
        expect.objectContaining({ codec_name: 'aac', codec_type: 'audio' }),
      ]))

      runFixtureFfmpeg([
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:sample_rate=44100:duration=${PCM_DURATION_SECONDS}`,
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        pcmPath,
      ])
      expect((await stat(pcmPath)).size).toBeGreaterThan(192 * MIB)

      const transcoded = await transcodeEmbeddedBrowserResource({
        ffmpegPath: ffmpegPath!,
        outputFormat: 'mp3',
        outputPath: transcodedPath,
        resource: {
          fileName: 'large-source.wav',
          filePath: pcmPath,
          mimeType: 'audio/wav',
          streamType: 'audio',
        },
      })
      expect(transcoded.outputPath).toBe(transcodedPath)
      expect((await stat(transcodedPath)).size).toBeGreaterThan(20 * MIB)
      const transcodedProbe = await probeMedia(transcodedPath)
      expect(Number(transcodedProbe.format?.duration || 0)).toBeGreaterThanOrEqual(PCM_DURATION_SECONDS - 0.1)
      expect(transcodedProbe.streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_name: 'mp3', codec_type: 'audio' }),
      ]))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)
})

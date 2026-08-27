import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import { downloadEmbeddedBrowserManifestResource } from './embeddedBrowserResourceManifestDownloadService'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

describe.skipIf(!ffmpegPath || !ffprobePath)('EmbeddedBrowser real HLS output', () => {
  it('hls.real-ffmpeg-ffprobe-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-real-output-test-'))
    const playlistPath = path.join(directory, 'source.m3u8')
    const outputPath = path.join(directory, 'output.mp4')

    try {
      const generateResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:sample_rate=44100:duration=0.5',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'hls',
        '-hls_list_size',
        '0',
        '-hls_segment_filename',
        path.join(directory, 'segment-%03d.ts'),
        playlistPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateResult.status, generateResult.stderr).toBe(0)

      const result = await downloadEmbeddedBrowserManifestResource({
        ffmpegPath: ffmpegPath!,
        kind: 'hls',
        manifestUrl: playlistPath,
        outputPath,
      })
      const output = await stat(result.outputPath)
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
        expect.objectContaining({
          codec_name: 'aac',
          codec_type: 'audio',
        }),
      ]))
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

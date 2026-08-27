import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  resolveDesktopFfmpegPath,
  resolveDesktopFfprobePath,
} from '../platform/mediaExecutable'
import {
  createEmbeddedBrowserHlsDownloadPlan,
  parseEmbeddedBrowserHlsManifest,
} from '../../src/features/embedded-browser/resources/model/embedded-browser-hls-manifest'
import { downloadEmbeddedBrowserHlsToLocalWorkDirectory } from './embeddedBrowserHlsLocalDownloaderService'
import { downloadEmbeddedBrowserManifestResource } from './embeddedBrowserResourceManifestDownloadService'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

async function expectAacMp4Output(outputPath: string) {
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
    expect.objectContaining({
      codec_name: 'aac',
      codec_type: 'audio',
    }),
  ]))
}

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
      await expectAacMp4Output(result.outputPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.real-aes128-local-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-real-aes-output-test-'))
    const sourceDirectory = path.join(directory, 'source')
    const workDirectory = path.join(directory, 'work')
    const sourcePlaylistPath = path.join(sourceDirectory, 'source.m3u8')
    const sourceKeyPath = path.join(sourceDirectory, 'source.key')
    const keyInfoPath = path.join(sourceDirectory, 'key-info.txt')
    const outputPath = path.join(directory, 'output.mp4')
    const keyBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const manifestUrl = 'https://media.example/encrypted/source.m3u8'

    try {
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(workDirectory, { recursive: true }),
      ])
      await writeFile(sourceKeyPath, keyBytes)
      await writeFile(keyInfoPath, [
        'https://media.example/encrypted/key.bin',
        sourceKeyPath,
        '0000000000000000000000000000002a',
        '',
      ].join('\n'))

      const generateResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1200:sample_rate=44100:duration=0.5',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'hls',
        '-hls_list_size',
        '0',
        '-hls_key_info_file',
        keyInfoPath,
        '-hls_segment_filename',
        'segment-%03d.ts',
        'source.m3u8',
      ], {
        cwd: sourceDirectory,
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateResult.status, generateResult.stderr).toBe(0)

      const sourcePlaylist = await readFile(sourcePlaylistPath, 'utf8')
      const manifest = parseEmbeddedBrowserHlsManifest({
        baseUrl: manifestUrl,
        text: sourcePlaylist,
      })
      const plan = createEmbeddedBrowserHlsDownloadPlan({
        manifest,
        manifestUrl,
      })
      const localResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: async (url: string) => {
          const sourcePath = url.endsWith('/key.bin')
            ? sourceKeyPath
            : path.join(sourceDirectory, path.basename(new URL(url).pathname))
          const bytes = await readFile(sourcePath)
          return new Response(new Uint8Array(bytes).buffer)
        },
        plan,
        preprocessFragments: true,
        workDirectoryPath: workDirectory,
      })
      const localPlaylist = await readFile(localResult.playlistPath, 'utf8')
      expect(localPlaylist).toContain('#EXT-X-KEY:METHOD=AES-128')
      expect(localPlaylist).toContain('URI="keys/key-001.key"')
      expect(localPlaylist).toContain('IV=0x0000000000000000000000000000002a')

      const result = await downloadEmbeddedBrowserManifestResource({
        ffmpegPath: ffmpegPath!,
        kind: 'hls',
        manifestUrl: localResult.playlistPath,
        outputPath,
      })
      await expectAacMp4Output(result.outputPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

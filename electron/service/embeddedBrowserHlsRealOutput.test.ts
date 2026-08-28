import { spawnSync } from 'node:child_process'
import { createCipheriv } from 'node:crypto'
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
import { downloadEmbeddedBrowserHlsLocalTracks } from './embedded-browser/processing/hls-local-track-merge'

const ffmpegPath = await resolveDesktopFfmpegPath()
const ffprobePath = await resolveDesktopFfprobePath()

async function expectMp4Output(
  outputPath: string,
  expectedStreams: Array<{ codecName: string; codecType: 'audio' | 'video' }>,
) {
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
  for (const stream of expectedStreams) {
    expect(probe.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({
        codec_name: stream.codecName,
        codec_type: stream.codecType,
      }),
    ]))
  }
}

function encryptHlsAes128Bytes(
  input: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
) {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([cipher.update(input), cipher.final()])
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
      await expectMp4Output(result.outputPath, [{
        codecName: 'aac',
        codecType: 'audio',
      }])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.real-aes128-local-output', async () => {
    const keyBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const cases = [
      {
        expectedIv: '0x0000000000000000000000000000002a',
        keyInfoIv: '0000000000000000000000000000002a',
        name: 'explicit',
        startNumber: 0,
      },
      {
        expectedIv: '0x00000000000000000000000000000007',
        name: 'implicit-sequence',
        startNumber: 7,
      },
    ]

    for (const testCase of cases) {
      const directory = await mkdtemp(path.join(os.tmpdir(), `omniflow-hls-real-aes-${testCase.name}-test-`))
      const sourceDirectory = path.join(directory, 'source')
      const workDirectory = path.join(directory, 'work')
      const sourcePlaylistPath = path.join(sourceDirectory, 'source.m3u8')
      const sourceKeyPath = path.join(sourceDirectory, 'source.key')
      const keyInfoPath = path.join(sourceDirectory, 'key-info.txt')
      const outputPath = path.join(directory, 'output.mp4')
      const manifestUrl = `https://media.example/encrypted/${testCase.name}/source.m3u8`

      try {
        await Promise.all([
          mkdir(sourceDirectory, { recursive: true }),
          mkdir(workDirectory, { recursive: true }),
        ])
        await writeFile(sourceKeyPath, keyBytes)
        await writeFile(keyInfoPath, [
          `https://media.example/encrypted/${testCase.name}/key.bin`,
          sourceKeyPath,
          ...(testCase.keyInfoIv ? [testCase.keyInfoIv] : []),
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
          '-start_number',
          String(testCase.startNumber),
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
        expect(localPlaylist).toContain(`IV=${testCase.expectedIv}`)

        const result = await downloadEmbeddedBrowserManifestResource({
          ffmpegPath: ffmpegPath!,
          kind: 'hls',
          manifestUrl: localResult.playlistPath,
          outputPath,
        })
        await expectMp4Output(result.outputPath, [{
          codecName: 'aac',
          codecType: 'audio',
        }])
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    }
  })

  it('hls.real-encrypted-fmp4-track-merge-output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-real-encrypted-tracks-test-'))
    const videoClearDirectory = path.join(directory, 'video-clear')
    const videoSourceDirectory = path.join(directory, 'video-source')
    const audioSourceDirectory = path.join(directory, 'audio-source')
    const workDirectory = path.join(directory, 'work')
    const outputPath = path.join(directory, 'output.mp4')
    const videoManifestUrl = 'https://media.example/encrypted-tracks/video/index.m3u8'
    const audioManifestUrl = 'https://media.example/encrypted-tracks/audio/index.m3u8'
    const videoKeyBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const audioKeyBytes = Uint8Array.from({ length: 16 }, (_, index) => 0x20 + index)
    const videoIvHex = '0000000000000000000000000000002a'
    const audioIvHex = '0000000000000000000000000000003b'
    const videoIvBytes = Uint8Array.from(Buffer.from(videoIvHex, 'hex'))

    try {
      await Promise.all([
        mkdir(videoClearDirectory, { recursive: true }),
        mkdir(videoSourceDirectory, { recursive: true }),
        mkdir(audioSourceDirectory, { recursive: true }),
        mkdir(workDirectory, { recursive: true }),
      ])

      const videoClearPlaylistPath = path.join(videoClearDirectory, 'index.m3u8')
      const generateVideoResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=10:duration=1',
        '-an',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-f',
        'hls',
        '-hls_segment_type',
        'fmp4',
        '-hls_time',
        '0.5',
        '-hls_list_size',
        '0',
        '-hls_fmp4_init_filename',
        'init.mp4',
        '-hls_segment_filename',
        'segment-%03d.m4s',
        'index.m3u8',
      ], {
        cwd: videoClearDirectory,
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateVideoResult.status, generateVideoResult.stderr).toBe(0)

      const videoClearPlaylist = await readFile(videoClearPlaylistPath, 'utf8')
      const videoMapName = /#EXT-X-MAP:URI="([^"]+)"/.exec(videoClearPlaylist)?.[1]
      const videoSegmentNames = videoClearPlaylist
        .split(/\r?\n/)
        .filter(line => line && !line.startsWith('#'))
      expect(videoMapName).toBeTruthy()
      expect(videoSegmentNames.length).toBeGreaterThan(0)

      await writeFile(path.join(videoSourceDirectory, 'video.key'), videoKeyBytes)
      await writeFile(
        path.join(videoSourceDirectory, videoMapName!),
        encryptHlsAes128Bytes(
          await readFile(path.join(videoClearDirectory, videoMapName!)),
          videoKeyBytes,
          videoIvBytes,
        ),
      )
      await Promise.all(videoSegmentNames.map(async segmentName => writeFile(
        path.join(videoSourceDirectory, segmentName),
        encryptHlsAes128Bytes(
          await readFile(path.join(videoClearDirectory, segmentName)),
          videoKeyBytes,
          videoIvBytes,
        ),
      )))
      const videoPlaylist = videoClearPlaylist.replace(
        '#EXT-X-MAP:',
        `#EXT-X-KEY:METHOD=AES-128,URI="video.key",IV=0x${videoIvHex}\n#EXT-X-MAP:`,
      )

      const audioKeyPath = path.join(audioSourceDirectory, 'audio.key')
      const audioKeyInfoPath = path.join(audioSourceDirectory, 'key-info.txt')
      const audioPlaylistPath = path.join(audioSourceDirectory, 'index.m3u8')
      await writeFile(audioKeyPath, audioKeyBytes)
      await writeFile(audioKeyInfoPath, [
        'https://media.example/encrypted-tracks/audio/audio.key',
        audioKeyPath,
        audioIvHex,
        '',
      ].join('\n'))
      const generateAudioResult = spawnSync(ffmpegPath!, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1200:sample_rate=44100:duration=1',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-f',
        'hls',
        '-hls_list_size',
        '0',
        '-hls_key_info_file',
        audioKeyInfoPath,
        '-hls_segment_filename',
        'segment-%03d.ts',
        'index.m3u8',
      ], {
        cwd: audioSourceDirectory,
        encoding: 'utf8',
        timeout: 10_000,
      })
      expect(generateAudioResult.status, generateAudioResult.stderr).toBe(0)
      const audioPlaylist = await readFile(audioPlaylistPath, 'utf8')

      const videoManifest = parseEmbeddedBrowserHlsManifest({
        baseUrl: videoManifestUrl,
        text: videoPlaylist,
      })
      const audioManifest = parseEmbeddedBrowserHlsManifest({
        baseUrl: audioManifestUrl,
        text: audioPlaylist,
      })
      const videoPlan = createEmbeddedBrowserHlsDownloadPlan({
        manifest: videoManifest,
        manifestUrl: videoManifestUrl,
      })
      const audioPlan = createEmbeddedBrowserHlsDownloadPlan({
        manifest: audioManifest,
        manifestUrl: audioManifestUrl,
      })
      const fetchFromDirectory = (sourceDirectory: string) => async (url: string) => {
        const bytes = await readFile(path.join(
          sourceDirectory,
          path.basename(new URL(url).pathname),
        ))
        return new Response(new Uint8Array(bytes).buffer)
      }

      const result = await downloadEmbeddedBrowserHlsLocalTracks({
        audio: {
          fetch: fetchFromDirectory(audioSourceDirectory),
          plan: audioPlan,
        },
        ffmpegPath: ffmpegPath!,
        outputPath,
        signal: new AbortController().signal,
        video: {
          fetch: fetchFromDirectory(videoSourceDirectory),
          plan: videoPlan,
        },
        workDirectoryPath: workDirectory,
      })
      await expectMp4Output(result.outputPath, [
        { codecName: 'h264', codecType: 'video' },
        { codecName: 'aac', codecType: 'audio' },
      ])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

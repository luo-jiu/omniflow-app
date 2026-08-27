import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, terminateProcessTreeMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  terminateProcessTreeMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('../platform/processTree', () => ({
  terminateDesktopProcessTree: terminateProcessTreeMock,
}))

import { downloadEmbeddedBrowserHlsToLocalWorkDirectory } from './embeddedBrowserHlsLocalDownloaderService'
import {
  buildEmbeddedBrowserManifestTrackMergeArgs,
  downloadEmbeddedBrowserManifestResource,
} from './embeddedBrowserResourceManifestDownloadService'

function createFakeFfmpegChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.pid = 42
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

describe('EmbeddedBrowser HLS output handoff', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    terminateProcessTreeMock.mockReset()
  })

  it('hls.track-input-header-isolation', () => {
    const args = buildEmbeddedBrowserManifestTrackMergeArgs({
      audioHeaders: {
        authorization: 'Bearer audio-secret',
        range: 'bytes=1-2',
      },
      audioManifestUrl: 'https://audio.example/track.m3u8',
      outputPath: '/tmp/output.mp4',
      videoHeaders: {
        authorization: 'Bearer video-secret',
        cookie: 'video-session=1',
      },
      videoManifestUrl: 'https://video.example/track.m3u8',
    })
    const inputIndexes = args.reduce<number[]>((indexes, value, index) => {
      if (value === '-i') indexes.push(index)
      return indexes
    }, [])

    expect(inputIndexes).toHaveLength(2)
    expect(args[inputIndexes[0] - 4]).toBe('-headers')
    expect(args[inputIndexes[0] - 3]).toContain('authorization: Bearer video-secret')
    expect(args[inputIndexes[0] - 3]).toContain('cookie: video-session=1')
    expect(args[inputIndexes[0] - 3]).not.toContain('audio-secret')
    expect(args[inputIndexes[1] - 2]).toBe('-headers')
    expect(args[inputIndexes[1] - 1]).toContain('authorization: Bearer audio-secret')
    expect(args[inputIndexes[1] - 1]).not.toContain('video-secret')
    expect(args[inputIndexes[1] - 1]).not.toContain('range:')
  })

  it('hls.local-output-smoke', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-output-smoke-test-'))
    const outputPath = path.join(directory, 'output.mp4')
    const progress = vi.fn()
    const keyBytes = new Uint8Array(16).fill(0x11)
    const mapBytes = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
    const fragmentBytes = Uint8Array.from([0x47, 0x01, 0x02, 0x03])
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/key.bin')) {
        return new Response(keyBytes.buffer)
      }
      if (url.endsWith('/init.mp4')) {
        return new Response(mapBytes.buffer)
      }
      return new Response(fragmentBytes.buffer)
    })

    spawnMock.mockImplementation((_command: string, commandArgs: string[]) => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        void writeFile(outputPath, Buffer.from('fake-mp4-output')).then(() => {
          child.stdout.emit('data', 'out_time_us=2000000\nspeed=1.25x\n')
          child.emit('exit', 0)
        })
      })
      expect(commandArgs).toContain(outputPath)
      return child
    })

    try {
      const localResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan: {
          fragments: [{
            discontinuitySequence: 0,
            duration: 2,
            index: 0,
            initSegment: {
              url: 'https://media.example/init.mp4',
            },
            key: {
              iv: '0x00000000000000000000000000000007',
              method: 'AES-128',
              url: 'https://media.example/key.bin',
            },
            part: false,
            sequence: 7,
            url: 'https://media.example/segment.ts',
          }],
          manifestUrl: 'https://media.example/live.m3u8',
        },
        workDirectoryPath: directory,
      })
      const playlist = await readFile(localResult.playlistPath, 'utf8')

      expect(playlist).toContain('URI="keys/key-001.key"')
      expect(playlist).toContain('URI="maps/map-001.mp4"')
      expect(playlist).toContain('segments/00001.ts')
      await expect(readFile(path.join(directory, 'keys', 'key-001.key')))
        .resolves.toEqual(Buffer.from(keyBytes))
      await expect(readFile(path.join(directory, 'maps', 'map-001.mp4')))
        .resolves.toEqual(Buffer.from(mapBytes))
      await expect(readFile(path.join(directory, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(fragmentBytes))

      const outputResult = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: 2,
        ffmpegPath: process.execPath,
        kind: 'hls',
        manifestUrl: localResult.playlistPath,
        onProgress: progress,
        outputPath,
      })
      const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[]
      const inputIndex = spawnArgs.indexOf('-i')

      expect(spawnArgs[inputIndex + 1]).toBe(localResult.playlistPath)
      expect(outputResult.outputPath).toBe(outputPath)
      await expect(readFile(outputPath)).resolves.toEqual(Buffer.from('fake-mp4-output'))
      expect(progress).toHaveBeenLastCalledWith({
        processedSeconds: 2,
        speedText: '1.25x',
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects a zero-exit ffmpeg process that produced no output file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-output-missing-test-'))
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        child.emit('exit', 0)
      })
      return child
    })

    try {
      const resultPromise = downloadEmbeddedBrowserManifestResource({
        ffmpegPath: process.execPath,
        kind: 'hls',
        manifestUrl: path.join(directory, 'local-playlist.m3u8'),
        outputPath: path.join(directory, 'missing.mp4'),
      })
      await expect(resultPromise).rejects.toThrow('没有生成可用的输出文件')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('output.ffmpeg-cancel-exit', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-output-abort-test-'))
    const outputPath = path.join(directory, 'partial.mp4')
    const abortController = new AbortController()
    let child: ReturnType<typeof createFakeFfmpegChild> | undefined
    spawnMock.mockImplementation(() => {
      child = createFakeFfmpegChild()
      return child
    })
    terminateProcessTreeMock.mockImplementation((runningChild, options) => {
      if (!options.force) {
        queueMicrotask(() => {
          runningChild.emit('exit', null)
        })
      }
    })

    try {
      await writeFile(outputPath, Buffer.from('partial-output'))
      const resultPromise = downloadEmbeddedBrowserManifestResource({
        ffmpegPath: process.execPath,
        kind: 'hls',
        manifestUrl: path.join(directory, 'local-playlist.m3u8'),
        outputPath,
        signal: abortController.signal,
      })
      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      abortController.abort()

      await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(terminateProcessTreeMock).toHaveBeenCalledWith(child, expect.objectContaining({
        force: false,
      }))
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('output.ffmpeg-process-cleanup', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-output-failure-test-'))
    const outputPath = path.join(directory, 'partial.mp4')
    spawnMock.mockImplementation(() => {
      const child = createFakeFfmpegChild()
      queueMicrotask(() => {
        child.stderr.emit('data', 'invalid media')
        child.emit('exit', 1)
      })
      return child
    })

    try {
      await writeFile(outputPath, Buffer.from('partial-output'))
      const resultPromise = downloadEmbeddedBrowserManifestResource({
        ffmpegPath: process.execPath,
        kind: 'hls',
        manifestUrl: path.join(directory, 'local-playlist.m3u8'),
        outputPath,
      })

      await expect(resultPromise).rejects.toThrow('invalid media')
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

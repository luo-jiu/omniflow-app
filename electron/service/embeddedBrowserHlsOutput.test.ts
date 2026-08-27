import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import { downloadEmbeddedBrowserHlsToLocalWorkDirectory } from './embeddedBrowserHlsLocalDownloaderService'
import { downloadEmbeddedBrowserManifestResource } from './embeddedBrowserResourceManifestDownloadService'

function createFakeFfmpegChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter
    stdout: EventEmitter
  }
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  return child
}

describe('EmbeddedBrowser HLS output handoff', () => {
  beforeEach(() => {
    spawnMock.mockReset()
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
})

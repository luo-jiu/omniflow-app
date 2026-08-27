import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { EmbeddedBrowserHlsLiveRecorder } from './embeddedBrowserHlsLiveRecorder'

const LIVE_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:7',
  '#EXTINF:4,',
  'segment-7.ts',
  '',
].join('\n')

describe('EmbeddedBrowser HLS live recorder', () => {
  it('hls.live-terminal', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-terminal-test-'))
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/live.m3u8')) {
        return new Response(LIVE_MANIFEST)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8',
      workDirectoryPath: directory,
    })

    try {
      await recorder.start()
      const result = await recorder.stop()
      const playlist = await readFile(result.playlistPath, 'utf8')
      const segment = await readFile(path.join(result.workDirectoryPath, 'segments', '00001.ts'))

      expect(result).toMatchObject({
        durationSeconds: 4,
        totalFragments: 1,
        workDirectoryPath: directory,
      })
      expect(playlist).toContain('segments/00001.ts')
      expect(segment).toEqual(Buffer.from([0x47, 0x01, 0x02, 0x03]))
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.live-manifest-force-cache-fallback', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-cache-test-'))
    const fetchCalls: Array<{ cache?: RequestCache; url: string }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ cache: init?.cache, url })
      if (url.endsWith('/live.m3u8')) {
        return fetchCalls.length === 1
          ? new Response('expired one-shot URL', { status: 403 })
          : new Response(LIVE_MANIFEST)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8',
      workDirectoryPath: directory,
    })

    try {
      await recorder.start()
      await recorder.stop()
      expect(fetchCalls).toEqual([
        { cache: undefined, url: 'https://media.example/live.m3u8' },
        { cache: 'force-cache', url: 'https://media.example/live.m3u8' },
        { cache: undefined, url: 'https://media.example/segment-7.ts' },
      ])
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.live-discard-abort', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-discard-test-'))
    let resolveSegmentStarted: (() => void) | undefined
    const segmentStarted = new Promise<void>((resolve) => {
      resolveSegmentStarted = resolve
    })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/live.m3u8')) {
        return new Response(LIVE_MANIFEST)
      }
      resolveSegmentStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8',
      workDirectoryPath: directory,
    })
    const startPromise = recorder.start()
    const startExpectation = expect(startPromise).rejects.toMatchObject({ name: 'AbortError' })

    try {
      await segmentStarted
      await expect(Promise.race([
        recorder.discard(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('live discard timed out')), 250)
        }),
      ])).resolves.toBeUndefined()
      await startExpectation
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })
})

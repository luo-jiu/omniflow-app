import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
  HlsLiveTask as EmbeddedBrowserHlsLiveRecorder,
} from './embedded-browser/processing/hls-live-task'

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
    const resolveParentVariableList = vi.fn(async () => ({
      root: 'https://unused.example',
    }))
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/live.m3u8')) {
        return new Response(LIVE_MANIFEST)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8',
      resolveParentVariableList,
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
      expect(resolveParentVariableList).toHaveBeenCalledTimes(1)
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.segment-query-live-recorder', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-segment-query-test-'))
    const requestedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.includes('/live.m3u8?')) {
        return new Response(LIVE_MANIFEST)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8?manifest=keep',
      segmentQuery: 'token=new&expires=9',
      workDirectoryPath: directory,
    })

    try {
      await recorder.start()
      await recorder.stop()
      expect(requestedUrls).toEqual([
        'https://media.example/live.m3u8?manifest=keep',
        'https://media.example/segment-7.ts?token=new&expires=9',
      ])
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.live-selected-child-authority', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-child-authority-test-'))
    const fetchImpl = vi.fn(async () => new Response(LIVE_MANIFEST))
    const resolveParentVariableList = vi.fn(async () => {
      throw new Error('所选直播 playlist 不属于当前 captured master')
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://attacker.example/live.m3u8',
      resolveParentVariableList,
      workDirectoryPath: directory,
    })

    try {
      await expect(recorder.start()).rejects.toThrow('所选直播 playlist 不属于当前 captured master')
      expect(resolveParentVariableList).toHaveBeenCalledTimes(1)
      expect(fetchImpl).not.toHaveBeenCalled()
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

  it('hls.live-ll-parts-cumulative-parity', async () => {
    vi.useFakeTimers()
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-ll-parts-test-'))
    const initialManifest = await readFile(
      new URL('../../tools/cat-catch-lab/fixtures/hls-low-latency-parts/playlist.m3u8', import.meta.url),
      'utf8',
    )
    const nextManifest = await readFile(
      new URL('../../tools/cat-catch-lab/fixtures/hls-low-latency-parts/playlist-next.m3u8', import.meta.url),
      'utf8',
    )
    const requestedUrls: string[] = []
    let manifestRequestCount = 0
    let resolveNewCompleteFragment: (() => void) | undefined
    const newCompleteFragment = new Promise<void>((resolve) => {
      resolveNewCompleteFragment = resolve
    })
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/live.m3u8')) {
        manifestRequestCount += 1
        return new Response(manifestRequestCount === 1 ? initialManifest : nextManifest)
      }
      if (url.endsWith('/segment102.m4s')) {
        resolveNewCompleteFragment?.()
      }
      return new Response(Uint8Array.from([0x00, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/ll-hls/live.m3u8',
      workDirectoryPath: directory,
    })

    try {
      await recorder.start()
      await vi.advanceTimersByTimeAsync(4000)
      await newCompleteFragment
      const result = await recorder.stop()

      expect(result).toMatchObject({
        durationSeconds: 12,
        totalFragments: 3,
      })
      expect(requestedUrls.filter(url => url.endsWith('/live.m3u8'))).toHaveLength(2)
      expect(requestedUrls.filter(url => /segment\d+\.m4s$/.test(url))).toEqual([
        'https://media.example/ll-hls/segment100.m4s',
        'https://media.example/ll-hls/segment101.m4s',
        'https://media.example/ll-hls/segment102.m4s',
      ])
      expect(requestedUrls.some(url => /segment\d+\.\d+\.m4s$/.test(url))).toBe(false)
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
      vi.useRealTimers()
    }
  })

  it('hls.live-import-variable-recording', async () => {
    vi.useFakeTimers()
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-variable-test-'))
    const liveManifest = await readFile(
      new URL('../../tools/cat-catch-lab/fixtures/hls-variable-substitution/media-live.m3u8', import.meta.url),
      'utf8',
    )
    const requestedUrls: string[] = []
    const resolveParentVariableList = vi.fn(async () => ({
      root: 'https://edge.example/assets/abc/123',
    }))
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/live.m3u8')) {
        return new Response(liveManifest)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02, 0x03]).buffer)
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: fetchImpl,
      manifestUrl: 'https://media.example/live.m3u8',
      resolveParentVariableList,
      workDirectoryPath: directory,
    })

    try {
      await recorder.start()
      await vi.advanceTimersByTimeAsync(4000)
      await recorder.stop()
      expect(resolveParentVariableList).toHaveBeenCalledTimes(1)
      expect(requestedUrls).toEqual([
        'https://media.example/live.m3u8',
        'https://edge.example/assets/abc/123/segments/live-42.ts',
        'https://media.example/live.m3u8',
      ])
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
      vi.useRealTimers()
    }
  })

  it('hls.live-parent-variable-abort', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-live-variable-abort-test-'))
    const liveManifest = await readFile(
      new URL('../../tools/cat-catch-lab/fixtures/hls-variable-substitution/media-live.m3u8', import.meta.url),
      'utf8',
    )
    let markResolverStarted: (() => void) | undefined
    const resolverStarted = new Promise<void>((resolve) => {
      markResolverStarted = resolve
    })
    const resolveParentVariableList = vi.fn(async (signal?: AbortSignal) => {
      markResolverStarted?.()
      return new Promise<Readonly<Record<string, string>>>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const recorder = new EmbeddedBrowserHlsLiveRecorder({
      fetch: async () => new Response(liveManifest),
      manifestUrl: 'https://media.example/live.m3u8',
      resolveParentVariableList,
      workDirectoryPath: directory,
    })
    const startPromise = recorder.start()
    const startExpectation = expect(startPromise).rejects.toMatchObject({ name: 'AbortError' })

    try {
      await resolverStarted
      await recorder.discard()
      await startExpectation
      expect(resolveParentVariableList).toHaveBeenCalledTimes(1)
    } finally {
      await recorder.discard()
      await rm(directory, { force: true, recursive: true })
    }
  })
})

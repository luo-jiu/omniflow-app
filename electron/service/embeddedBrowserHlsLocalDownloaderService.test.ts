import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
  parseHlsManifest,
} from './embedded-browser/cat-catch-port/hls/parser'
import { createHlsDownloadPlan } from './embedded-browser/cat-catch-port/hls/plan'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from './embeddedBrowserHlsLocalDownloaderService'

function createPlan() {
  return {
    fragments: [{
      discontinuitySequence: 0,
      duration: 1,
      index: 0,
      part: false,
      sequence: 1,
      url: 'https://media.example/segment.ts',
    }],
    manifestUrl: 'https://media.example/playlist.m3u8',
  }
}

describe('EmbeddedBrowser HLS local downloader', () => {
  it('writes preprocessed fragment bytes while preserving the default raw path', async () => {
    const imagePrefix = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47,
      0x49, 0x45, 0x4e, 0x44,
      0x00, 0x00, 0x00, 0x00,
    ])
    const mediaBytes = Uint8Array.from([0x47, 0x01, 0x02, 0x03])
    const rawBytes = new Uint8Array(imagePrefix.byteLength + mediaBytes.byteLength)
    rawBytes.set(imagePrefix, 0)
    rawBytes.set(mediaBytes, imagePrefix.byteLength)
    const fetchImpl = vi.fn(async () => new Response(rawBytes.buffer))
    const preprocessedDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-preprocess-test-'))
    const rawDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-raw-test-'))

    try {
      const preprocessedResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan: createPlan(),
        preprocessFragments: true,
        workDirectoryPath: preprocessedDirectory,
      })
      const rawResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan: createPlan(),
        workDirectoryPath: rawDirectory,
      })

      await expect(readFile(path.join(preprocessedResult.workDirectoryPath, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(mediaBytes))
      await expect(readFile(path.join(rawResult.workDirectoryPath, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(rawBytes))
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      await Promise.all([
        rm(preprocessedDirectory, { force: true, recursive: true }),
        rm(rawDirectory, { force: true, recursive: true }),
      ])
    }
  })

  it('hls.key-length-validation', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/key.bin')) {
        return new Response(Uint8Array.from([1, 2, 3]).buffer)
      }
      return new Response(Uint8Array.from([0x47, 0x01]).buffer)
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-invalid-key-test-'))
    const plan = {
      ...createPlan(),
      fragments: [{
        ...createPlan().fragments[0],
        key: {
          method: 'AES-128',
          url: 'https://media.example/key.bin',
        },
      }],
    }

    try {
      await expect(downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })).rejects.toThrow('AES-128 key must be 16 bytes')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(fetchImpl).toHaveBeenCalledWith('https://media.example/key.bin', expect.anything())
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.cancel-aborts-local-download', async () => {
    const controller = new AbortController()
    let resolveStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      resolveStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-cancel-test-'))
    const downloadPromise = downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fetch: fetchImpl,
      plan: createPlan(),
      signal: controller.signal,
      workDirectoryPath: directory,
    })

    try {
      await started
      controller.abort()
      await expect(Promise.race([
        downloadPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('local downloader cancellation timed out')), 250)
        }),
      ])).rejects.toThrow('aborted')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.cancel-aborts-static-refs', async () => {
    const controller = new AbortController()
    let resolveKeyStarted: (() => void) | undefined
    const keyStarted = new Promise<void>((resolve) => {
      resolveKeyStarted = resolve
    })
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/key.bin')) {
        return new Response(Uint8Array.from([0x47, 0x01]).buffer)
      }
      resolveKeyStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-static-cancel-test-'))
    const plan = {
      ...createPlan(),
      fragments: [{
        ...createPlan().fragments[0],
        key: {
          method: 'AES-128',
          url: 'https://media.example/key.bin',
        },
      }],
    }
    const downloadPromise = downloadEmbeddedBrowserHlsToLocalWorkDirectory({
      fetch: fetchImpl,
      plan,
      signal: controller.signal,
      workDirectoryPath: directory,
    })

    try {
      await keyStarted
      controller.abort()
      await expect(Promise.race([
        downloadPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('static reference cancellation timed out')), 250)
        }),
      ])).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.static-ref-range', async () => {
    const calls: Array<{ range: string | null; url: string }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        range: new Headers(init?.headers).get('range'),
        url,
      })
      if (url.endsWith('/key.bin')) {
        return new Response(new Uint8Array(16).buffer)
      }
      if (url.endsWith('/init.mp4')) {
        return new Response(Uint8Array.from([0, 1]).buffer)
      }
      return new Response(Uint8Array.from([0x47, 0x01, 0x02]).buffer)
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-range-test-'))
    const baseFragment = createPlan().fragments[0]
    const plan = {
      ...createPlan(),
      fragments: [{
        ...baseFragment,
        byteRange: { length: 3, offset: 5, raw: '3@5' },
        initSegment: {
          byteRange: { length: 2, offset: 1, raw: '2@1' },
          url: 'https://media.example/init.mp4',
        },
        key: {
          method: 'AES-128',
          url: 'https://media.example/key.bin',
        },
      }],
    }

    try {
      await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })
      expect(calls).toEqual([
        { range: null, url: 'https://media.example/key.bin' },
        { range: 'bytes=1-2', url: 'https://media.example/init.mp4' },
        { range: 'bytes=5-7', url: 'https://media.example/segment.ts' },
      ])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.aes128-local-playlist-iv', async () => {
    const keyUrl = 'https://media.example/key.bin'
    const keyBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const fetchImpl = vi.fn(async (url: string) => (
      new Response(url === keyUrl
        ? keyBytes.buffer
        : Uint8Array.from([0x47, 0x01]).buffer)
    ))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-key-iv-test-'))
    const ivs = [
      '0x00000000000000000000000000000007',
      '0x00000000000000000000000000000008',
      '0x0000000000000000000000000000002a',
    ]
    const plan = {
      ...createPlan(),
      fragments: ivs.map((iv, index) => ({
        ...createPlan().fragments[0],
        index,
        key: {
          iv,
          method: 'AES-128',
          url: keyUrl,
        },
        sequence: 7 + index,
        url: `https://media.example/segment-${7 + index}.ts`,
      })),
    }

    try {
      const result = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })
      const playlist = await readFile(result.playlistPath, 'utf8')
      expect(playlist.split('\n').filter(line => line.startsWith('#EXT-X-KEY:'))).toEqual(
        ivs.map(iv => `#EXT-X-KEY:METHOD=AES-128,URI="keys/key-001.key",IV=${iv}`),
      )
      expect(fetchImpl.mock.calls.filter(([url]) => url === keyUrl)).toHaveLength(1)
      expect(result.keyCount).toBe(1)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.encrypted-map-local-playlist-key-order', async () => {
    const fixtureRoot = new URL('../../tools/cat-catch-lab/fixtures/hls-encrypted-map-key-context/', import.meta.url)
    const [playlist, expectedText] = await Promise.all([
      readFile(new URL('playlist.m3u8', fixtureRoot), 'utf8'),
      readFile(new URL('expected.json', fixtureRoot), 'utf8'),
    ])
    const expected = JSON.parse(expectedText) as {
      baseUrl: string
      localKeyLines: string[]
      localMapLine: string
    }
    const manifest = parseHlsManifest({
      baseUrl: expected.baseUrl,
      text: playlist,
    })
    const plan = createHlsDownloadPlan({
      manifest,
      manifestUrl: expected.baseUrl,
    })
    const keyUrls = new Set(['https://media.example/encrypted-map/map.key', 'https://media.example/encrypted-map/media.key'])
    const fetchImpl = vi.fn(async (url: string) => new Response(
      keyUrls.has(url)
        ? new Uint8Array(16).buffer
        : Uint8Array.from([0x47, 0x01]).buffer,
    ))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-encrypted-map-test-'))

    try {
      const result = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })
      const localPlaylist = await readFile(result.playlistPath, 'utf8')
      const lines = localPlaylist.trim().split('\n')
      expect(lines.filter(line => line.startsWith('#EXT-X-KEY:'))).toEqual(expected.localKeyLines)
      expect(lines.indexOf(expected.localKeyLines[0])).toBeLessThan(lines.indexOf(expected.localMapLine))
      expect(lines.indexOf(expected.localMapLine)).toBeLessThan(lines.indexOf(expected.localKeyLines[1]))
      expect(fetchImpl.mock.calls.filter(([url]) => keyUrls.has(url))).toHaveLength(2)
      expect(result).toMatchObject({ keyCount: 2, mapCount: 1 })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

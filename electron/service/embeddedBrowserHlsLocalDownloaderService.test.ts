import { createCipheriv } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
  parseHlsManifest,
} from './embedded-browser/cat-catch-port/hls/parser'
import { createHlsDownloadPlan } from './embedded-browser/cat-catch-port/hls/plan'
import {
  defaultHlsTaskExecutor,
} from './embedded-browser/processing/hls-task'

const downloadEmbeddedBrowserHlsToLocalWorkDirectory = (
  ...args: Parameters<typeof defaultHlsTaskExecutor.downloadToLocalWorkDirectory>
) => defaultHlsTaskExecutor.downloadToLocalWorkDirectory(...args)

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

  it('hls.aes256-local-predecrypt', async () => {
    const cbcKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
    const ctrKey = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index)
    const cbcIv = Uint8Array.from({ length: 16 }, (_, index) => 0x10 + index)
    const ctrIv = Uint8Array.from({ length: 16 }, (_, index) => 0x20 + index)
    const clearMap = Uint8Array.from({ length: 31 }, (_, index) => index + 1)
    const clearSegment = Uint8Array.from({ length: 47 }, (_, index) => 0x80 + index)
    const cbcCipher = createCipheriv('aes-256-cbc', cbcKey, cbcIv)
    const encryptedMap = Buffer.concat([cbcCipher.update(clearMap), cbcCipher.final()])
    const ctrCipher = createCipheriv('aes-256-ctr', ctrKey, ctrIv)
    const encryptedSegment = Buffer.concat([ctrCipher.update(clearSegment), ctrCipher.final()])
    const urls = {
      cbcKey: 'https://media.example/map.key',
      ctrKey: 'https://media.example/segment.key',
      map: 'https://media.example/init.mp4',
      segment: 'https://media.example/segment.ts',
    }
    const responses = new Map<string, Uint8Array>([
      [urls.cbcKey, cbcKey],
      [urls.ctrKey, ctrKey],
      [urls.map, encryptedMap],
      [urls.segment, encryptedSegment],
    ])
    const fetchImpl = vi.fn(async (url: string) => {
      const bytes = responses.get(url)
      if (!bytes) return new Response(null, { status: 404 })
      return new Response(new Uint8Array(bytes).buffer)
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-aes256-test-'))
    const plan = {
      ...createPlan(),
      fragments: [{
        ...createPlan().fragments[0],
        initSegment: {
          key: {
            iv: `0x${Buffer.from(cbcIv).toString('hex')}`,
            method: 'AES-256',
            url: urls.cbcKey,
          },
          url: urls.map,
        },
        key: {
          iv: `0x${Buffer.from(ctrIv).toString('hex')}`,
          method: 'AES-256-CTR',
          url: urls.ctrKey,
        },
        url: urls.segment,
      }],
    }

    try {
      const result = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })
      const playlist = await readFile(result.playlistPath, 'utf8')

      await expect(readFile(path.join(directory, 'maps', 'map-001.mp4')))
        .resolves.toEqual(Buffer.from(clearMap))
      await expect(readFile(path.join(directory, 'segments', '00001.ts')))
        .resolves.toEqual(Buffer.from(clearSegment))
      expect(playlist).toContain('#EXT-X-MAP:URI="maps/map-001.mp4"')
      expect(playlist).not.toContain('#EXT-X-KEY')
      expect(fetchImpl).toHaveBeenCalledTimes(4)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('hls.cbc-map-byterange-decrypt', async () => {
    const fixtureRoot = new URL('../../tools/cat-catch-lab/fixtures/hls-cbc-map-byterange-output/', import.meta.url)
    const [cases, expected] = await Promise.all([
      readFile(new URL('cases.json', fixtureRoot), 'utf8').then(text => JSON.parse(text) as {
        methods: Array<{
          cipher: 'aes-128-cbc' | 'aes-256-cbc'
          keyByteLength: number
          method: 'AES-128' | 'AES-256'
        }>
      }),
      readFile(new URL('expected.json', fixtureRoot), 'utf8').then(text => JSON.parse(text) as {
        clearLength: number
        mapByteRange: { length: number; offset: number; raw: string }
        requestRange: string
      }),
    ])

    for (const testCase of cases.methods) {
      const key = Uint8Array.from({ length: testCase.keyByteLength }, (_, index) => index + 1)
      const previousCiphertextBlock = Uint8Array.from({ length: 16 }, (_, index) => 0x40 + index)
      const clearMap = Uint8Array.from({ length: expected.clearLength }, (_, index) => 0x80 + index)
      const cipher = createCipheriv(testCase.cipher, key, previousCiphertextBlock)
      const encryptedMap = Buffer.concat([cipher.update(clearMap), cipher.final()])
      const rangedObject = Buffer.alloc(expected.mapByteRange.offset + encryptedMap.byteLength)
      rangedObject.set(previousCiphertextBlock, expected.mapByteRange.offset - 16)
      rangedObject.set(encryptedMap, expected.mapByteRange.offset)
      const urls = {
        key: `https://media.example/${testCase.method}.key`,
        map: `https://media.example/${testCase.method}.mp4`,
        segment: `https://media.example/${testCase.method}.m4s`,
      }
      const manualKeyBase64 = testCase.method === 'AES-128'
        ? Buffer.from(key).toString('base64')
        : undefined
      const calls: Array<{ range: string | null; url: string }> = []
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        const range = new Headers(init?.headers).get('range')
        calls.push({ range, url })
        if (url === urls.key) {
          return new Response(key.buffer)
        }
        if (url === urls.map) {
          const match = /^bytes=(\d+)-(\d+)$/.exec(range || '')
          if (!match) return new Response(null, { status: 416 })
          return new Response(rangedObject.subarray(Number(match[1]), Number(match[2]) + 1))
        }
        return new Response(Uint8Array.from([0x01, 0x02, 0x03]))
      })
      const directory = await mkdtemp(path.join(os.tmpdir(), `omniflow-hls-${testCase.method.toLowerCase()}-map-range-test-`))
      const plan = {
        ...createPlan(),
        fragments: [{
          ...createPlan().fragments[0],
          initSegment: {
            byteRange: expected.mapByteRange,
            key: {
              iv: '0x00000000000000000000000000000001',
              method: testCase.method,
              url: urls.key,
            },
            url: urls.map,
          },
          url: urls.segment,
        }],
      }

      try {
        const result = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
          fetch: fetchImpl,
          manualKeyBase64,
          plan,
          workDirectoryPath: directory,
        })
        const playlist = await readFile(result.playlistPath, 'utf8')

        await expect(readFile(path.join(directory, 'maps', 'map-001.mp4')))
          .resolves.toEqual(Buffer.from(clearMap))
        expect(calls).toEqual([
          ...(manualKeyBase64 ? [] : [{ range: null, url: urls.key }]),
          { range: expected.requestRange, url: urls.map },
          { range: null, url: urls.segment },
        ])
        expect(playlist).toContain('#EXT-X-MAP:URI="maps/map-001.mp4"')
        expect(playlist).not.toContain('#EXT-X-KEY')
        expect(result).toMatchObject({ keyCount: 1, mapCount: 1 })
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    }
  })

  it('rejects a CBC encrypted MAP range that cannot include a previous cipher block', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-cbc-map-invalid-offset-test-'))
    const plan = {
      ...createPlan(),
      fragments: [{
        ...createPlan().fragments[0],
        initSegment: {
          byteRange: { length: 31, offset: 8, raw: '31@8' },
          key: {
            method: 'AES-128',
            url: 'https://media.example/key.bin',
          },
          url: 'https://media.example/init.mp4',
        },
      }],
    }
    const fetchImpl = vi.fn(async (url: string) => new Response(
      url.endsWith('/key.bin')
        ? new Uint8Array(16).buffer
        : new Uint8Array(64).buffer,
    ))

    try {
      await expect(downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: fetchImpl,
        plan,
        workDirectoryPath: directory,
      })).rejects.toThrow('offset must be 0 or at least 16 bytes')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
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

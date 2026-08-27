import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

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
})

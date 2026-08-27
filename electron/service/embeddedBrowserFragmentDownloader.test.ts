import { describe, expect, it, vi } from 'vitest'

import { EmbeddedBrowserFragmentDownloader } from './embeddedBrowserFragmentDownloader'

describe('EmbeddedBrowserFragmentDownloader', () => {
  it('hls.plan-authority-fetch', async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=2-4')
      return new Response('abc', {
        headers: { 'content-length': '3' },
      })
    })
    const downloader = new EmbeddedBrowserFragmentDownloader({
      fetch: fetchImpl,
      fragments: [{
        byteRange: { length: 3, offset: 2 },
        index: 0,
        url: 'https://media.example/segment.m4s',
      }],
      thread: 1,
    })

    const completed = new Promise<void>((resolve, reject) => {
      downloader.on('allCompleted', () => resolve())
      downloader.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })
    downloader.start()
    await completed

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    downloader.destroy()
  })

  it('keeps raw bytes observable while processing bytes before sequential output', async () => {
    const raw = Uint8Array.from([1, 2, 3]).buffer
    const processed = Uint8Array.from([3, 2, 1]).buffer
    const fetchImpl = vi.fn(async () => new Response(raw, {
      headers: { 'content-length': '3' },
    }))
    const downloader = new EmbeddedBrowserFragmentDownloader({
      bufferProcessor: (buffer) => {
        expect(new Uint8Array(buffer)).toEqual(new Uint8Array(raw))
        return processed
      },
      fetch: fetchImpl,
      fragments: [{ index: 0, url: 'https://media.example/segment.ts' }],
      thread: 1,
    })

    const result = new Promise<void>((resolve, reject) => {
      downloader.on('rawBuffer', (buffer) => {
        expect(new Uint8Array(buffer)).toEqual(new Uint8Array(raw))
      })
      downloader.on('sequentialPush', (buffer) => {
        expect(new Uint8Array(buffer)).toEqual(new Uint8Array(processed))
      })
      downloader.on('allCompleted', () => resolve())
      downloader.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })
    downloader.start()
    await result
    downloader.destroy()
  })

  it('applies buffer processors in order and exposes each processed stage', async () => {
    const stages: string[] = []
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.from([1]).buffer))
    const downloader = new EmbeddedBrowserFragmentDownloader({
      bufferProcessors: [
        async (buffer) => {
          stages.push(`first:${new Uint8Array(buffer)[0]}`)
          return Uint8Array.from([2]).buffer
        },
        (buffer) => {
          stages.push(`second:${new Uint8Array(buffer)[0]}`)
          return Uint8Array.from([3]).buffer
        },
      ],
      fetch: fetchImpl,
      fragments: [{ index: 0, url: 'https://media.example/segment.ts' }],
      thread: 1,
    })

    const result = new Promise<void>((resolve, reject) => {
      downloader.on('processedBuffer', (buffer, _fragment, processorIndex) => {
        stages.push(`event${processorIndex}:${new Uint8Array(buffer)[0]}`)
      })
      downloader.on('sequentialPush', (buffer) => {
        expect(new Uint8Array(buffer)[0]).toBe(3)
      })
      downloader.on('allCompleted', () => resolve())
      downloader.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })
    downloader.start()
    await result

    expect(stages).toEqual(['first:1', 'event0:2', 'second:2', 'event1:3'])
    downloader.destroy()
  })
})

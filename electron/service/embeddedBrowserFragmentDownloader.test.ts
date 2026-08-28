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

  it('hls.retry-cancel-range', async () => {
    let attempt = 0
    let resolveRetryStarted: (() => void) | undefined
    const retryStarted = new Promise<void>((resolve) => {
      resolveRetryStarted = resolve
    })
    const bufferProcessor = vi.fn((buffer: ArrayBuffer) => buffer)
    const processedBuffer = vi.fn()
    const sequentialPush = vi.fn()
    const completed = vi.fn()
    const allCompleted = vi.fn()
    const failed = vi.fn()
    const aborted = vi.fn()
    const failedAttempts: number[] = []
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      attempt += 1
      expect(new Headers(init?.headers).get('range')).toBe('bytes=5-7')
      if (attempt === 1) {
        return new Response('temporary failure', { status: 503 })
      }
      resolveRetryStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const downloader = new EmbeddedBrowserFragmentDownloader({
      bufferProcessor,
      fetch: fetchImpl,
      fragments: [{
        byteRange: { length: 3, offset: 5 },
        index: 0,
        url: 'https://media.example/segment.ts',
      }],
      maxRetries: 2,
      thread: 1,
    })
    const stopped = new Promise<void>((resolve) => {
      downloader.on('stop', () => resolve())
    })
    downloader.on('downloadError', (_fragment, _error, failedAttempt) => {
      failedAttempts.push(failedAttempt)
    })
    downloader.on('processedBuffer', processedBuffer)
    downloader.on('sequentialPush', sequentialPush)
    downloader.on('completed', completed)
    downloader.on('allCompleted', allCompleted)
    downloader.on('failed', failed)
    downloader.on('aborted', aborted)

    downloader.start()
    await retryStarted
    downloader.stop()
    await stopped

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(downloader.running).toBe(0)
    })
    expect(downloader.state).toBe('aborted')
    expect(failedAttempts).toEqual([1])
    expect(bufferProcessor).not.toHaveBeenCalled()
    expect(processedBuffer).not.toHaveBeenCalled()
    expect(sequentialPush).not.toHaveBeenCalled()
    expect(completed).not.toHaveBeenCalled()
    expect(allCompleted).not.toHaveBeenCalled()
    expect(failed).not.toHaveBeenCalled()
    expect(aborted).toHaveBeenCalledTimes(1)

    downloader.destroy()
    expect(aborted).toHaveBeenCalledTimes(1)
  })

  it('hls.failed-fragment-retry', async () => {
    let attempts = 0
    const failedAttempts: number[] = []
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('temporary failure', { status: 503 })
      }
      return new Response(Uint8Array.from([7]).buffer)
    })
    const downloader = new EmbeddedBrowserFragmentDownloader({
      fetch: fetchImpl,
      fragments: [{ index: 0, url: 'https://media.example/segment.ts' }],
      maxRetries: 1,
      thread: 1,
    })
    const completed = new Promise<void>((resolve, reject) => {
      downloader.on('downloadError', (_fragment, _error, attempt) => {
        failedAttempts.push(attempt)
      })
      downloader.on('allCompleted', () => resolve())
      downloader.on('failed', (_fragments, errors) => reject(new Error(`unexpected failures: ${errors.size}`)))
    })

    downloader.start()
    await completed
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(failedAttempts).toEqual([1])
    expect(downloader.success).toBe(1)
    downloader.destroy()
  })
})

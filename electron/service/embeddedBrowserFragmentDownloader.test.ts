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
})

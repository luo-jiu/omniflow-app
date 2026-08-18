import { describe, expect, it, vi } from 'vitest'

import { EmbeddedBrowserDroppedFileStore } from './embeddedBrowserDroppedFileStore'

describe('EmbeddedBrowserDroppedFileStore', () => {
  it('enforces a total retained-file quota', async () => {
    const cleanupFile = vi.fn().mockResolvedValue(true)
    const store = new EmbeddedBrowserDroppedFileStore({ cleanupFile, maxTotalBytes: 10 })

    store.retain('tab-1', '/tmp/first', 7)
    expect(() => store.retain('tab-1', '/tmp/second', 4)).toThrow('总量超过 1GB 上限')
    expect(store.getSnapshot()).toEqual({ fileCount: 1, totalBytes: 7 })

    await store.dispose()
    expect(cleanupFile).toHaveBeenCalledWith('/tmp/first')
  })

  it('releases all retained files for a navigated tab', async () => {
    const cleanupFile = vi.fn().mockResolvedValue(true)
    const store = new EmbeddedBrowserDroppedFileStore({ cleanupFile })
    store.retain('tab-1', '/tmp/first', 3)
    store.retain('tab-1', '/tmp/second', 5)
    store.retain('tab-2', '/tmp/third', 7)

    await store.releaseTab('tab-1')

    expect(store.getSnapshot()).toEqual({ fileCount: 1, totalBytes: 7 })
    expect(cleanupFile).toHaveBeenCalledWith('/tmp/first')
    expect(cleanupFile).toHaveBeenCalledWith('/tmp/second')
    await store.dispose()
  })

  it('expires retained files after the configured ttl', async () => {
    vi.useFakeTimers()
    try {
      const cleanupFile = vi.fn().mockResolvedValue(true)
      const store = new EmbeddedBrowserDroppedFileStore({ cleanupFile, ttlMs: 1_000 })
      store.retain('tab-1', '/tmp/first', 3)

      await vi.advanceTimersByTimeAsync(1_000)

      expect(cleanupFile).toHaveBeenCalledWith('/tmp/first')
      expect(store.getSnapshot()).toEqual({ fileCount: 0, totalBytes: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans retained files synchronously during shutdown', () => {
    const cleanupFileSync = vi.fn()
    const store = new EmbeddedBrowserDroppedFileStore({
      cleanupFile: vi.fn().mockResolvedValue(true),
      cleanupFileSync,
    })
    store.retain('tab-1', '/tmp/first', 3)

    store.disposeSync()

    expect(cleanupFileSync).toHaveBeenCalledWith('/tmp/first')
    expect(store.getSnapshot()).toEqual({ fileCount: 0, totalBytes: 0 })
  })
})

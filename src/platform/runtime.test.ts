import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopPlatformDomState } from './runtime'

afterEach(() => vi.unstubAllGlobals())

function fixture(initial: Promise<boolean>) {
  const dataset: Record<string, string> = {}
  let listener!: (value: boolean) => void
  const unsubscribe = vi.fn()
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('window', { electronWindow: { platform: 'darwin',
    getFullScreen: () => initial,
    onFullScreenChange: (callback: typeof listener) => { listener = callback; return unsubscribe },
  } })
  const dispose = installDesktopPlatformDomState()
  return { dataset, dispose, unsubscribe, emit: (value: boolean) => listener(value) }
}

describe('Desktop fullscreen DOM projection', () => {
  it('restores a page opened in fullscreen and follows enter and exit events', async () => {
    const view = fixture(Promise.resolve(true))
    await Promise.resolve()
    expect(view.dataset).toEqual({ platform: 'macos', windowFullscreen: 'true' })
    view.emit(false)
    expect(view.dataset.windowFullscreen).toBe('false')
    view.emit(true)
    expect(view.dataset.windowFullscreen).toBe('true')
    view.dispose()
    expect(view.unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not let a stale initial reply overwrite a newer fullscreen event', async () => {
    let resolve!: (value: boolean) => void
    const view = fixture(new Promise<boolean>(done => { resolve = done }))
    view.emit(true)
    resolve(false)
    await Promise.resolve()
    expect(view.dataset.windowFullscreen).toBe('true')
    view.dispose()
  })

  it('ignores late callbacks after disposal', async () => {
    let resolve!: (value: boolean) => void
    const view = fixture(new Promise<boolean>(done => { resolve = done }))
    view.dispose()
    view.emit(true)
    resolve(true)
    await Promise.resolve()
    expect(view.dataset.windowFullscreen).toBe('false')
  })

  it('keeps normal spacing when an older main process has no fullscreen IPC', async () => {
    const view = fixture(Promise.reject(new Error('No handler')))
    await Promise.resolve()
    await Promise.resolve()
    expect(view.dataset.windowFullscreen).toBe('false')
    view.dispose()
  })
})

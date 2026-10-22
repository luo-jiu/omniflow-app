import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installMainWindowNavigationGuard } from './mainWindowNavigation'

function harness(appDocumentUrl = 'file:///Applications/OmniFlow.app/Contents/Resources/app.asar/dist/index.html') {
  let destroyed = false
  let popupHandler!: Parameters<WebContents['setWindowOpenHandler']>[0]
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    send: vi.fn(),
    setWindowOpenHandler: vi.fn((handler: typeof popupHandler) => { popupHandler = handler }),
  })
  const dispose = installMainWindowNavigationGuard(contents as never, appDocumentUrl)
  return {
    contents,
    dispose,
    navigate: (url: string) => {
      const event = { preventDefault: vi.fn() }
      contents.emit('will-navigate', event, url)
      return event
    },
    redirect: (url: string, isMainFrame = true) => {
      const event = { preventDefault: vi.fn() }
      contents.emit('will-redirect', event, url, false, isMainFrame, 1, 1)
      return event
    },
    popup: (url: string) => popupHandler({ url } as never),
    destroy: () => { destroyed = true; contents.emit('destroyed') },
  }
}

describe('Main window navigation guard', () => {
  it.each(['http://example.test/path?q=1#section', 'https://example.test/path'])('blocks main-frame %s and requests an embedded browser tab', url => {
    const { navigate, contents } = harness()
    expect(navigate(url).preventDefault).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledWith('app:open-web-url', { url })
  })

  it.each(['file:///tmp/document.html', 'javascript:alert(1)', 'data:text/html,hello', 'mailto:test@example.test', 'about:blank', 'invalid-url'])('blocks %s without forwarding unsupported URLs', url => {
    const { navigate, contents } = harness()
    expect(navigate(url).preventDefault).toHaveBeenCalledOnce()
    expect(contents.send).not.toHaveBeenCalled()
  })

  it.each([
    'file:///Applications/OmniFlow.app/Contents/Resources/app.asar/dist/index.html',
    'http://localhost:5173/',
  ])('allows trusted document reloads and hash routes for %s', appUrl => {
    const { navigate, redirect, contents } = harness(appUrl)
    expect(navigate(appUrl).preventDefault).not.toHaveBeenCalled()
    expect(navigate(`${appUrl}#/library/3`).preventDefault).not.toHaveBeenCalled()
    expect(redirect(`${appUrl}#/libraries`).preventDefault).not.toHaveBeenCalled()
    expect(contents.send).not.toHaveBeenCalled()
  })

  it('does not trust another document on the development server or a changed query', () => {
    const { navigate, contents } = harness('http://localhost:5173/')
    expect(navigate('http://localhost:5173/other').preventDefault).toHaveBeenCalledOnce()
    expect(navigate('http://localhost:5173/?other=1').preventDefault).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledTimes(2)
  })

  it('blocks external main-frame redirects while leaving subframe redirects alone', () => {
    const { redirect, contents } = harness()
    expect(redirect('https://example.test/redirect').preventDefault).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledWith('app:open-web-url', { url: 'https://example.test/redirect' })
    expect(redirect('https://example.test/iframe', false).preventDefault).not.toHaveBeenCalled()
    expect(contents.send).toHaveBeenCalledTimes(1)
  })

  it('denies every popup and only forwards web URLs', () => {
    const { popup, contents } = harness()
    expect(popup('https://example.test')).toEqual({ action: 'deny' })
    expect(contents.send).toHaveBeenCalledOnce()
    expect(contents.send).toHaveBeenCalledWith('app:open-web-url', { url: 'https://example.test/' })
    expect(popup('file:///tmp/document.html')).toEqual({ action: 'deny' })
    expect(popup('about:blank')).toEqual({ action: 'deny' })
    expect(popup('javascript:alert(1)')).toEqual({ action: 'deny' })
    expect(contents.send).toHaveBeenCalledTimes(1)
  })

  it('cleans up on explicit disposal and continues denying popups without forwarding', () => {
    const { contents, dispose, navigate, popup } = harness()
    dispose()
    dispose()
    expect(contents.listenerCount('will-navigate')).toBe(0)
    expect(contents.listenerCount('will-redirect')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
    expect(navigate('https://example.test').preventDefault).not.toHaveBeenCalled()
    expect(popup('https://example.test')).toEqual({ action: 'deny' })
    expect(contents.send).not.toHaveBeenCalled()
  })

  it('cleans up when its WebContents is destroyed and ignores stale popup callbacks', () => {
    const { contents, destroy, popup } = harness()
    destroy()
    expect(contents.listenerCount('will-navigate')).toBe(0)
    expect(contents.listenerCount('will-redirect')).toBe(0)
    expect(popup('https://example.test')).toEqual({ action: 'deny' })
    expect(contents.send).not.toHaveBeenCalled()
    expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
  })
})

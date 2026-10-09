import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const theme = vi.hoisted(() => ({ shouldUseDarkColors: false, vibrancy: undefined as string | undefined, on: vi.fn(), off: vi.fn() }))
vi.mock('electron', () => ({ nativeTheme: theme }))
vi.mock('../platform', () => ({ getMainWindowPlatformOptions: () => ({ vibrancy: theme.vibrancy }) }))
import { getMainWindowBackgroundColor, refreshMainWindowBackground, syncMainWindowBackground } from './mainWindowBackground'

describe('Main window backing color', () => {
  beforeEach(() => { vi.clearAllMocks(); theme.shouldUseDarkColors = false; theme.vibrancy = undefined })

  it('keeps the canvas transparent behind a vibrant sidebar in either theme', () => {
    theme.vibrancy = 'sidebar'
    expect(getMainWindowBackgroundColor()).toBe('#00000000')
    theme.shouldUseDarkColors = true
    expect(getMainWindowBackgroundColor()).toBe('#00000000')
  })

  it('matches the renderer canvas color for both themes', () => {
    const css = readFileSync(new URL('../../src/assets/css/reset.less', import.meta.url), 'utf8')
    const colors = [...css.matchAll(/--app-bg:\s*(#[\da-f]+);/g)].map(match => match[1])
    expect(getMainWindowBackgroundColor()).toBe(colors[0])
    theme.shouldUseDarkColors = true
    expect(getMainWindowBackgroundColor()).toBe(colors[1])
  })

  it('updates with the native theme and releases its listener when closed', () => {
    let destroyed = false
    const win = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed, setBackgroundColor: vi.fn() })
    syncMainWindowBackground(win as never)
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#f5f5f0')
    const update = theme.on.mock.calls[0][1] as () => void
    theme.shouldUseDarkColors = true
    update()
    expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#1e1e1e')
    destroyed = true
    update()
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(2)
    win.emit('closed')
    expect(theme.off).toHaveBeenCalledWith('updated', update)
  })

  it('restores the transparent backing used by vibrancy after fullscreen transitions', () => {
    theme.vibrancy = 'sidebar'
    const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, setBackgroundColor: vi.fn() })
    refreshMainWindowBackground(win as never)
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#00000000')
  })
})

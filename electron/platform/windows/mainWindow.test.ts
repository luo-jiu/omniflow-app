import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  nativeTheme: {
    off: vi.fn(),
    on: vi.fn(),
    shouldUseDarkColors: false,
  },
}))

vi.mock('electron', () => electronMock)

import {
  applyWindowsMainWindowBehavior,
  getWindowsMainWindowOptions,
} from './mainWindow'

describe('Windows main window behavior', () => {
  beforeEach(() => {
    electronMock.nativeTheme.off.mockClear()
    electronMock.nativeTheme.on.mockClear()
    electronMock.nativeTheme.shouldUseDarkColors = false
  })

  it('uses the native window controls overlay without a separate title bar', () => {
    expect(getWindowsMainWindowOptions()).toEqual({
      titleBarOverlay: {
        color: '#00000000',
        height: 38,
        symbolColor: '#202124',
      },
      titleBarStyle: 'hidden',
    })
  })

  it('keeps overlay symbols in sync with the native theme and removes its listener', () => {
    const setTitleBarOverlay = vi.fn()
    const win = {
      isDestroyed: () => false,
      once: vi.fn(),
      setTitleBarOverlay,
    }

    applyWindowsMainWindowBehavior(win as never)
    expect(setTitleBarOverlay).toHaveBeenLastCalledWith({
      color: '#00000000',
      height: 38,
      symbolColor: '#202124',
    })

    electronMock.nativeTheme.shouldUseDarkColors = true
    const updatedListener = electronMock.nativeTheme.on.mock.calls[0]?.[1] as (() => void) | undefined
    updatedListener?.()
    expect(setTitleBarOverlay).toHaveBeenLastCalledWith({
      color: '#00000000',
      height: 38,
      symbolColor: '#f2f2f2',
    })

    const closedListener = win.once.mock.calls[0]?.[1] as (() => void) | undefined
    closedListener?.()
    expect(electronMock.nativeTheme.off).toHaveBeenCalledWith('updated', updatedListener)
  })
})

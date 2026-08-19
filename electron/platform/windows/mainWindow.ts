import { nativeTheme } from 'electron'
import type { BrowserWindow } from 'electron'

import type { MainWindowPlatformOptions } from '../types'

const WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = 38
const WINDOWS_TITLE_BAR_OVERLAY_COLOR = '#00000000'
const WINDOWS_TITLE_BAR_SYMBOL_COLOR_DARK = '#f2f2f2'
const WINDOWS_TITLE_BAR_SYMBOL_COLOR_LIGHT = '#202124'

function getWindowsTitleBarOverlay() {
  return {
    color: WINDOWS_TITLE_BAR_OVERLAY_COLOR,
    symbolColor: nativeTheme.shouldUseDarkColors
      ? WINDOWS_TITLE_BAR_SYMBOL_COLOR_DARK
      : WINDOWS_TITLE_BAR_SYMBOL_COLOR_LIGHT,
    height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
  }
}

export function getWindowsMainWindowOptions(): MainWindowPlatformOptions {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: getWindowsTitleBarOverlay(),
  }
}

export function applyWindowsMainWindowBehavior(win: BrowserWindow) {
  const syncTitleBarOverlay = () => {
    if (win.isDestroyed()) return
    win.setTitleBarOverlay(getWindowsTitleBarOverlay())
  }
  const cleanup = () => {
    nativeTheme.off('updated', syncTitleBarOverlay)
  }

  syncTitleBarOverlay()
  nativeTheme.on('updated', syncTitleBarOverlay)
  win.once('closed', cleanup)
}

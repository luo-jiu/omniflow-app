import type { BrowserWindow } from 'electron'

import {
  applyMacOSMainWindowBehavior,
  getMacOSMainWindowOptions,
} from './macos/mainWindow'
import type { MainWindowPlatformOptions } from './types'
import { getWindowsMainWindowOptions } from './windows/mainWindow'

const DEFAULT_MAIN_WINDOW_OPTIONS: MainWindowPlatformOptions = {
  titleBarStyle: 'default',
}

export function getMainWindowPlatformOptions(
  platform: NodeJS.Platform = process.platform,
): MainWindowPlatformOptions {
  if (platform === 'darwin') {
    return getMacOSMainWindowOptions()
  }
  if (platform === 'win32') {
    return getWindowsMainWindowOptions()
  }
  return DEFAULT_MAIN_WINDOW_OPTIONS
}

export function applyMainWindowPlatformBehavior(
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === 'darwin') {
    applyMacOSMainWindowBehavior(win)
  }
}

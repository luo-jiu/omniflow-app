import type { BrowserWindow } from 'electron'

import type { MainWindowPlatformOptions } from '../types'

const MACOS_TRAFFIC_LIGHT_POSITION = { x: 14, y: 11 } as const

export function getMacOSMainWindowOptions(): MainWindowPlatformOptions {
  return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
  }
}

export function applyMacOSMainWindowBehavior(win: BrowserWindow) {
  win.setWindowButtonPosition(MACOS_TRAFFIC_LIGHT_POSITION)
}

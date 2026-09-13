import { nativeTheme, type BrowserWindow } from 'electron'
import { getMainWindowPlatformOptions } from '../platform'

// Vibrant sidebars need a transparent canvas; solid windows match --app-bg.
export function getMainWindowBackgroundColor(): string {
  if (getMainWindowPlatformOptions().vibrancy) return '#00000000'
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f0'
}

export function syncMainWindowBackground(win: BrowserWindow): void {
  const update = () => {
    if (!win.isDestroyed()) win.setBackgroundColor(getMainWindowBackgroundColor())
  }
  update()
  nativeTheme.on('updated', update)
  win.once('closed', () => nativeTheme.off('updated', update))
}

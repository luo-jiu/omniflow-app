import { nativeTheme, type BrowserWindow } from 'electron'
import { getMainWindowPlatformOptions } from '../platform'
const appearanceBackgrounds = new WeakMap<BrowserWindow, string>()

export function applyMainWindowAppearanceBackground(win: BrowserWindow, color: string): void {
  appearanceBackgrounds.set(win, color)
  if (!win.isDestroyed()) win.setBackgroundColor(getMainWindowPlatformOptions().vibrancy ? '#00000000' : color)
}

// Vibrant sidebars need a transparent canvas; solid windows match --app-bg.
export function getMainWindowBackgroundColor(): string {
  if (getMainWindowPlatformOptions().vibrancy) return '#00000000'
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f0'
}

export function syncMainWindowBackground(win: BrowserWindow): void {
  const update = () => {
    if (!win.isDestroyed()) win.setBackgroundColor(getMainWindowPlatformOptions().vibrancy ? '#00000000' : appearanceBackgrounds.get(win) ?? getMainWindowBackgroundColor())
  }
  update()
  nativeTheme.on('updated', update)
  win.once('closed', () => nativeTheme.off('updated', update))
}

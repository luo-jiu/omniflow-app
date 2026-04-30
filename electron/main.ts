import { app, BrowserWindow, Menu, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import registerIpcHandlers from './ipc'
import { createEmbeddedBrowserMainController } from './service/embeddedBrowserMainController'
import { registerWindowControlIpcHandlers } from './service/windowControlIpc'
import { createOverlayWindowController } from './service/overlayWindowController'
import { registerOverlayWindowIpcHandlers } from './service/overlayWindowIpc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

const APP_ICON_PATH = path.join(process.env.APP_ROOT, 'build', 'icons', 'icon.png')
const APP_DISPLAY_NAME = 'Omniflow'
const LEGACY_USER_DATA_DIRNAME = 'omniflow-app'
const DEFAULT_WINDOW_WIDTH = 1400
const DEFAULT_WINDOW_HEIGHT = 920
const MIN_WINDOW_WIDTH = 600
const MIN_WINDOW_HEIGHT = 400
const WINDOW_STATE_FILENAME = 'window-state.json'
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 200
const ENABLE_EMBEDDED_BROWSER_DEBUG =
  process.env.NODE_ENV === 'test' ||
  Boolean(VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) ||
  process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === 'true'
const ENABLE_CHROMIUM_RUNTIME_LOGS = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === 'true'

if (!ENABLE_CHROMIUM_RUNTIME_LOGS) {
  app.commandLine.appendSwitch('disable-logging')
  app.commandLine.appendSwitch('log-level', '3')
}

app.setName(APP_DISPLAY_NAME)
try {
  const stableUserDataPath = path.join(app.getPath('appData'), LEGACY_USER_DATA_DIRNAME)
  app.setPath('userData', stableUserDataPath)
} catch {
  // ignore
}

function getAppIconPath() {
  return existsSync(APP_ICON_PATH) ? APP_ICON_PATH : null
}

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null

interface PersistedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILENAME)
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input)
}

function isValidWindowSize(width: number, height: number) {
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT
}

function isWindowWithinAnyDisplay(bounds: { x: number; y: number; width: number; height: number }) {
  const displays = screen.getAllDisplays()
  return displays.some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y
    )
  })
}

function readPersistedWindowState(): PersistedWindowState | null {
  try {
    const filePath = getWindowStateFilePath()
    if (!existsSync(filePath)) {
      return null
    }

    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersistedWindowState>
    if (!isFiniteNumber(parsed.width) || !isFiniteNumber(parsed.height)) {
      return null
    }
    if (!isValidWindowSize(parsed.width, parsed.height)) {
      return null
    }

    const maximized = Boolean(parsed.maximized)
    const nextState: PersistedWindowState = {
      width: parsed.width,
      height: parsed.height,
      maximized,
    }

    if (isFiniteNumber(parsed.x) && isFiniteNumber(parsed.y)) {
      nextState.x = parsed.x
      nextState.y = parsed.y
    }

    if (isFiniteNumber(nextState.x) && isFiniteNumber(nextState.y)) {
      const isVisible = isWindowWithinAnyDisplay({
        x: nextState.x,
        y: nextState.y,
        width: nextState.width,
        height: nextState.height,
      })
      if (!isVisible) {
        delete nextState.x
        delete nextState.y
      }
    }

    return nextState
  } catch {
    return null
  }
}

function saveWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) {
    return
  }
  try {
    const normalBounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
    const payload: PersistedWindowState = {
      x: normalBounds.x,
      y: normalBounds.y,
      width: Math.max(Math.round(normalBounds.width), MIN_WINDOW_WIDTH),
      height: Math.max(Math.round(normalBounds.height), MIN_WINDOW_HEIGHT),
      maximized: win.isMaximized(),
    }
    const filePath = getWindowStateFilePath()
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(payload), 'utf-8')
  } catch {
    // ignore persistence failures
  }
}

function scheduleSaveWindowState(win: BrowserWindow) {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer)
  }
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    saveWindowState(win)
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
}

function isToggleDevToolsShortcut(input: Electron.Input) {
  if (input.type !== 'keyDown') {
    return false
  }

  const key = (input.key || '').toLowerCase()
  return (input.meta || input.control) && input.shift && key === 'i'
}

function isZoomShortcut(input: Electron.Input) {
  if (input.type !== 'keyDown') {
    return false
  }

  if (!(input.meta || input.control)) {
    return false
  }

  const key = (input.key || '').toLowerCase()
  return key === '+' || key === '=' || key === '-' || key === '_' || key === '0'
}

const embeddedBrowserMainController = createEmbeddedBrowserMainController({
  debugEnabled: ENABLE_EMBEDDED_BROWSER_DEBUG,
  getMainWindow: () => mainWindow,
})

const overlayWindowController = createOverlayWindowController({
  getMainWindow: () => mainWindow,
  preloadPath: path.join(MAIN_DIST, 'preload.mjs'),
  rendererDist: RENDERER_DIST,
  devServerUrl: VITE_DEV_SERVER_URL,
})

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }

  const appIconPath = getAppIconPath()
  const persistedWindowState = readPersistedWindowState()
  const initialWidth = persistedWindowState?.width ?? DEFAULT_WINDOW_WIDTH
  const initialHeight = persistedWindowState?.height ?? DEFAULT_WINDOW_HEIGHT

  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(isFiniteNumber(persistedWindowState?.x) && isFiniteNumber(persistedWindowState?.y)
      ? { x: persistedWindowState.x, y: persistedWindowState.y }
      : {}),
    webPreferences: {
      preload: path.join(MAIN_DIST, 'preload.mjs'),
      devTools: true,
    },
    autoHideMenuBar: true,
    ...(appIconPath ? { icon: appIconPath } : {}),
  })
  mainWindow = win

  if (persistedWindowState?.maximized) {
    win.maximize()
  }

  win.on('move', () => {
    scheduleSaveWindowState(win)
    overlayWindowController.syncBoundsFromMain()
  })
  win.on('resize', () => {
    scheduleSaveWindowState(win)
    overlayWindowController.syncBoundsFromMain()
  })
  win.on('maximize', () => {
    scheduleSaveWindowState(win)
    overlayWindowController.syncBoundsFromMain()
  })
  win.on('unmaximize', () => {
    scheduleSaveWindowState(win)
    overlayWindowController.syncBoundsFromMain()
  })
  win.on('enter-full-screen', () => {
    overlayWindowController.syncBoundsFromMain()
    // macOS fullscreen transition is animated; resync after it settles
    setTimeout(() => overlayWindowController.syncBoundsFromMain(), 300)
  })
  win.on('leave-full-screen', () => {
    overlayWindowController.syncBoundsFromMain()
    setTimeout(() => overlayWindowController.syncBoundsFromMain(), 300)
  })
  win.on('minimize', () => {
    const overlay = overlayWindowController.getWindow()
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      overlay.hide()
    }
  })
  win.on('restore', () => {
    overlayWindowController.syncBoundsFromMain()
  })
  win.on('hide', () => {
    const overlay = overlayWindowController.getWindow()
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
      overlay.hide()
    }
  })
  win.on('show', () => {
    overlayWindowController.syncBoundsFromMain()
  })

  win.on('close', (event) => {
    saveWindowState(win)
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
    overlayWindowController.destroy()
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (isZoomShortcut(input)) {
      event.preventDefault()
      const key = (input.key || '').toLowerCase()
      if (key === '+' || key === '=') {
        win.webContents.send('app:zoom-shortcut', 'in')
      } else if (key === '-' || key === '_') {
        win.webContents.send('app:zoom-shortcut', 'out')
      } else if (key === '0') {
        win.webContents.send('app:zoom-shortcut', 'reset')
      }
      return
    }
    if (!isToggleDevToolsShortcut(input)) {
      return
    }

    event.preventDefault()
    win.webContents.toggleDevTools()
  })
  win.on('app-command', (event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') {
      event.preventDefault()
    }
  })
  win.on('swipe', (event, direction) => {
    if (direction === 'left' || direction === 'right') {
      event.preventDefault()
    }
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  return win
}

app.on('before-quit', () => {
  isQuitting = true
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow)
  }
  overlayWindowController.destroy()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    return
  }

  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  const appIconPath = getAppIconPath()
  if (appIconPath && process.platform === 'darwin') {
    app.dock.setIcon(appIconPath)
  }

  embeddedBrowserMainController.configureSession()
  embeddedBrowserMainController.initializeBridges()
  registerIpcHandlers()
  registerWindowControlIpcHandlers({
    getMainWindow: () => mainWindow,
  })
  embeddedBrowserMainController.registerIpcHandlers()
  registerOverlayWindowIpcHandlers(overlayWindowController)

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  createWindow()
  // Pre-create overlay window so it's ready when first spec arrives
  void overlayWindowController.ensureReady()
})

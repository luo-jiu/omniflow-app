import { app, BrowserWindow, ipcMain, Menu, protocol, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import registerIpcHandlers from './ipc'
import { createEmbeddedBrowserMainController } from './service/embeddedBrowserMainController'
import { isDevToolsToggleShortcut } from './service/embeddedBrowserInputShortcuts'
import { registerWindowControlIpcHandlers } from './service/windowControlIpc'
import { createOverlayWindowController } from './service/overlayWindowController'
import { registerOverlayWindowIpcHandlers } from './service/overlayWindowIpc'
import { createSystemVideoWindowController } from './service/systemVideoWindowController'
import { registerSystemVideoWindowIpcHandlers } from './service/systemVideoWindowIpc'
import { registerAppUpdateIpcHandlers } from './service/appUpdateIpc'
import { clearFileTransferRuntime, initializeFileTransferRuntime } from './service/fileTransferRuntime'
import { createAppUpdateService } from './service/appUpdateService'
import { IMAGE_PREVIEW_PROTOCOL, registerImagePreviewProtocol } from './ipc/imagePreview'
import {
  applyMainWindowPlatformBehavior,
  getMainWindowPlatformOptions,
} from './platform'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PREVIEW_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
])

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
const MIN_WINDOW_WIDTH = 1120
const MIN_WINDOW_HEIGHT = 720
const WINDOW_STATE_FILENAME = 'window-state.json'
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 200
const APP_UPDATE_BASE_URL = typeof __OMNIFLOW_UPDATE_BASE_URL__ === 'string'
  ? __OMNIFLOW_UPDATE_BASE_URL__
  : ''
const ENABLE_EMBEDDED_BROWSER_DEBUG =
  process.env.NODE_ENV === 'test' ||
  Boolean(VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL) ||
  process.env.OMNIFLOW_ENABLE_RUNTIME_LOGS === 'true'
const ENABLE_CHROMIUM_RUNTIME_LOGS = process.env.OMNIFLOW_ENABLE_CHROMIUM_LOGS === 'true'

function resolveUserDataDirname() {
  const suffix = String(process.env.OMNIFLOW_USER_DATA_SUFFIX || '').trim()
  if (!suffix) {
    return LEGACY_USER_DATA_DIRNAME
  }
  const normalizedSuffix = suffix.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return normalizedSuffix ? `${LEGACY_USER_DATA_DIRNAME}-${normalizedSuffix}` : LEGACY_USER_DATA_DIRNAME
}

if (!ENABLE_CHROMIUM_RUNTIME_LOGS) {
  app.commandLine.appendSwitch('disable-logging')
  app.commandLine.appendSwitch('log-level', '3')
}

app.setName(APP_DISPLAY_NAME)
try {
  const stableUserDataPath = path.join(app.getPath('appData'), resolveUserDataDirname())
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
const appUpdateService = createAppUpdateService({
  getMainWindow: () => mainWindow,
  updateBaseUrl: APP_UPDATE_BASE_URL,
})

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

function getChromiumPageZoomShortcutAction(input: Electron.Input): 'zoom-in' | 'zoom-out' | 'reset' | null {
  if (input.type !== 'keyDown' || !(input.meta || input.control)) {
    return null
  }

  const key = (input.key || '').toLowerCase()
  const code = input.code || ''
  if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') {
    return 'zoom-in'
  }
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') {
    return 'zoom-out'
  }
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
    return 'reset'
  }
  return null
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

const systemVideoWindowController = createSystemVideoWindowController({
  getMainWindow: () => mainWindow,
  preloadPath: path.join(MAIN_DIST, 'preload.mjs'),
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
    ...getMainWindowPlatformOptions(),
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
  applyMainWindowPlatformBehavior(win)

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
    systemVideoWindowController.destroy()
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (embeddedBrowserMainController.handleActiveViewInputShortcut(input)) {
      event.preventDefault()
      return
    }

    const zoomShortcutAction = getChromiumPageZoomShortcutAction(input)
    if (zoomShortcutAction) {
      event.preventDefault()
      win.webContents.setZoomFactor(1)
      win.webContents.send('app:viewer-zoom-shortcut', { action: zoomShortcutAction })
      return
    }

    if (!isDevToolsToggleShortcut(input)) {
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
  appUpdateService.dispose()
  void clearFileTransferRuntime().catch(() => undefined)
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow)
  }
  overlayWindowController.destroy()
  systemVideoWindowController.destroy()
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

app.whenReady().then(async () => {
  const appIconPath = getAppIconPath()
  if (appIconPath && process.platform === 'darwin') {
    app.dock.setIcon(appIconPath)
  }

  embeddedBrowserMainController.configureSession()
  registerImagePreviewProtocol()
  embeddedBrowserMainController.initializeBridges()
  await initializeFileTransferRuntime().catch((error) => {
    console.error('[file-transfer] download URL broker failed to start', error)
  })
  registerIpcHandlers()
  registerWindowControlIpcHandlers({
    getMainWindow: () => mainWindow,
  })
  embeddedBrowserMainController.registerIpcHandlers()
  registerOverlayWindowIpcHandlers(overlayWindowController)
  registerSystemVideoWindowIpcHandlers(systemVideoWindowController)
  registerAppUpdateIpcHandlers(ipcMain, appUpdateService)

  const toggleActiveDevToolsFromMenu = () => {
    if (embeddedBrowserMainController.toggleActiveViewDevTools()) {
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools()
    }
  }
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
      label: 'View',
      submenu: [
        {
          accelerator: process.platform === 'darwin' ? 'Command+Alt+I' : 'CommandOrControl+Shift+I',
          click: toggleActiveDevToolsFromMenu,
          label: 'Toggle Developer Tools',
        },
        ...(process.platform === 'darwin'
          ? []
          : [{
              accelerator: 'F12',
              click: toggleActiveDevToolsFromMenu,
              label: 'Toggle Developer Tools (F12)',
            }]),
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
  appUpdateService.initialize()
  // Pre-create overlay window so it's ready when first spec arrives
  void overlayWindowController.ensureReady()
})

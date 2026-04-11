// main.ts (Electron 主进程入口文件)

import { app, BrowserWindow, ipcMain, screen, WebContentsView } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import registerIpcHandlers from './ipc'
import { runtimeLogger } from './runtimeLogger'

// __dirname 处理（因为 ESM 下没有内置 __dirname）
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 设置应用根路径（APP_ROOT = 项目根目录）
process.env.APP_ROOT = path.join(__dirname, '..')

// 渲染进程与主进程的打包产物路径
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

// 在开发环境使用 public，生产环境使用 dist
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

app.setName(APP_DISPLAY_NAME)
// 保持沿用历史用户数据目录，避免因应用显示名变化导致 zoom / 本地偏好重置。
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
let windowHandlersRegistered = false
let isQuitting = false
const WINDOW_ACTIVATE_TOPMOST_DURATION_MS = 240
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null
let embeddedBrowserView: WebContentsView | null = null
let embeddedBrowserLastCommittedUrl = ''
let embeddedBrowserPendingBounds: { x: number; y: number; width: number; height: number } | null = null

type EmbeddedBrowserStatePayload = {
  details?: string
  message?: string
  meta?: string[]
  state?: 'idle' | 'loading' | 'ready' | 'error'
  url?: string
}

type EmbeddedBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

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
  if (win.isDestroyed()) return
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

function registerWindowIpcHandlers() {
  if (windowHandlersRegistered) {
    return
  }
  windowHandlersRegistered = true

  ipcMain.handle('zoom-adjust', (event, delta: number) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null
    }

    const currentZoom = targetWindow.webContents.getZoomFactor()
    const nextZoom = Math.min(Math.max(currentZoom + delta, 0.25), 3)
    targetWindow.webContents.setZoomFactor(nextZoom)
    return nextZoom
  })

  ipcMain.on('window-minimize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    targetWindow?.minimize()
  })

  ipcMain.on('window-maximize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize()
    } else {
      targetWindow.maximize()
    }
  })

  ipcMain.on('window-close', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    targetWindow?.close()
  })

  ipcMain.handle('window-activate', (event, temporaryOnTop: boolean = false) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false
    }

    if (targetWindow.isMinimized()) {
      targetWindow.restore()
    }
    if (!targetWindow.isVisible()) {
      targetWindow.show()
    }

    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    } else {
      app.focus()
    }

    if (typeof targetWindow.moveTop === 'function') {
      targetWindow.moveTop()
    }
    targetWindow.focus()

    if (temporaryOnTop && !targetWindow.isAlwaysOnTop()) {
      targetWindow.setAlwaysOnTop(true, 'screen-saver')
      setTimeout(() => {
        if (!targetWindow.isDestroyed()) {
          targetWindow.setAlwaysOnTop(false)
        }
      }, WINDOW_ACTIVATE_TOPMOST_DURATION_MS)
    }
    return true
  })

  const emitEmbeddedBrowserState = (payload: EmbeddedBrowserStatePayload) => {
    runtimeLogger.log('[embedded-browser:main]', payload)
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:state', payload)
  }

  const collectEmbeddedBrowserDebugMeta = async (view: WebContentsView) => {
    if (!ENABLE_EMBEDDED_BROWSER_DEBUG || view.webContents.isDestroyed()) {
      return []
    }

    try {
      const snapshot = await view.webContents.executeJavaScript(`
        (() => {
          const bodyText = document.body?.innerText?.trim() || ''
          const bodyHtmlLength = document.body?.innerHTML?.length || 0
          return {
            title: document.title || '',
            readyState: document.readyState || '',
            bodyTextPreview: bodyText.slice(0, 120),
            bodyHtmlLength,
            innerWidth: window.innerWidth || 0,
            innerHeight: window.innerHeight || 0,
            clientWidth: document.documentElement?.clientWidth || 0,
            clientHeight: document.documentElement?.clientHeight || 0,
            devicePixelRatio: window.devicePixelRatio || 0,
            userAgent: navigator.userAgent || '',
          }
        })()
      `, true)

      const meta: string[] = []
      if (snapshot?.title) {
        meta.push(`title=${snapshot.title}`)
      }
      if (snapshot?.readyState) {
        meta.push(`readyState=${snapshot.readyState}`)
      }
      if (typeof snapshot?.bodyHtmlLength === 'number') {
        meta.push(`bodyHtml=${snapshot.bodyHtmlLength}`)
      }
      if (typeof snapshot?.innerWidth === 'number' && typeof snapshot?.innerHeight === 'number') {
        meta.push(`viewport=${snapshot.innerWidth}x${snapshot.innerHeight}`)
      }
      if (typeof snapshot?.clientWidth === 'number' && typeof snapshot?.clientHeight === 'number') {
        meta.push(`client=${snapshot.clientWidth}x${snapshot.clientHeight}`)
      }
      if (typeof snapshot?.devicePixelRatio === 'number') {
        meta.push(`dpr=${snapshot.devicePixelRatio}`)
      }
      if (snapshot?.bodyTextPreview) {
        meta.push(`preview=${snapshot.bodyTextPreview}`)
      }
      if (snapshot?.userAgent) {
        meta.push(`ua=${snapshot.userAgent}`)
      }
      return meta
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [`inspect=${message}`]
    }
  }

  const ensureEmbeddedBrowserView = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null
    }
    if (embeddedBrowserView && !embeddedBrowserView.webContents.isDestroyed()) {
      return embeddedBrowserView
    }

    embeddedBrowserView = new WebContentsView({
      webPreferences: {
        devTools: true,
      },
    })
    embeddedBrowserView.webContents.setZoomFactor(1)
    const currentUserAgent = embeddedBrowserView.webContents.getUserAgent()
    if (currentUserAgent.includes('Electron')) {
      embeddedBrowserView.webContents.setUserAgent(
        currentUserAgent.replace(/\sElectron\/[^\s]+/g, ''),
      )
    }
    embeddedBrowserView.setBounds(embeddedBrowserPendingBounds ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
    mainWindow.contentView.addChildView(embeddedBrowserView)

    embeddedBrowserView.webContents.on('did-start-loading', () => {
      emitEmbeddedBrowserState({
        details: 'did-start-loading',
        state: 'loading',
        url: embeddedBrowserView?.webContents.getURL() || undefined,
      })
    })
    embeddedBrowserView.webContents.on('did-stop-loading', async () => {
      const view = embeddedBrowserView
      if (!view || view.webContents.isDestroyed()) {
        return
      }
      embeddedBrowserLastCommittedUrl = view.webContents.getURL() || ''
      const meta = await collectEmbeddedBrowserDebugMeta(view)
      emitEmbeddedBrowserState({
        details: 'did-stop-loading',
        ...(meta.length ? { meta } : {}),
        state: 'ready',
        url: embeddedBrowserLastCommittedUrl || undefined,
      })
    })
    embeddedBrowserView.webContents.on('did-navigate', (_event, url) => {
      embeddedBrowserLastCommittedUrl = url
      emitEmbeddedBrowserState({ details: 'did-navigate', state: 'ready', url })
    })
    embeddedBrowserView.webContents.on('did-navigate-in-page', (_event, url) => {
      embeddedBrowserLastCommittedUrl = url
      emitEmbeddedBrowserState({ details: 'did-navigate-in-page', state: 'ready', url })
    })
    embeddedBrowserView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) {
        return
      }
      emitEmbeddedBrowserState({
        details: `did-fail-load(${errorCode})`,
        state: 'error',
        message: `页面加载失败：${errorDescription || '未知错误'}`,
        url: validatedURL,
      })
    })
    embeddedBrowserView.webContents.on('render-process-gone', (_event, details) => {
      emitEmbeddedBrowserState({
        details: `render-process-gone:${details.reason}`,
        state: 'error',
        message: `页面渲染进程异常退出：${details.reason}`,
        url: embeddedBrowserView?.webContents.getURL() || undefined,
      })
    })
    embeddedBrowserView.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (ENABLE_EMBEDDED_BROWSER_DEBUG && level >= 2) {
        emitEmbeddedBrowserState({
          details: `console:${sourceId}:${line}`,
          state: 'ready',
          message,
          meta: [`console-level=${level}`],
          url: embeddedBrowserLastCommittedUrl || embeddedBrowserView?.webContents.getURL() || undefined,
        })
      }
    })
    embeddedBrowserView.webContents.setWindowOpenHandler(({ url }) => {
      embeddedBrowserView?.webContents.loadURL(url)
      return { action: 'deny' }
    })

    return embeddedBrowserView
  }

  const attachEmbeddedBrowserView = (targetWindow: BrowserWindow) => {
    if (!embeddedBrowserView || embeddedBrowserView.webContents.isDestroyed()) {
      ensureEmbeddedBrowserView()
    }
    if (embeddedBrowserView && !targetWindow.contentView.children.includes(embeddedBrowserView)) {
      targetWindow.contentView.addChildView(embeddedBrowserView)
    }
    return embeddedBrowserView
  }

  const loadEmbeddedBrowserUrl = async (
    targetWindow: BrowserWindow | null,
    url: string,
    errorDetails: 'open-exception' | 'navigate-exception',
  ) => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    const normalizedUrl = String(url || '').trim()
    if (!normalizedUrl) {
      return
    }
    const view = attachEmbeddedBrowserView(targetWindow)
    if (!view || view.webContents.isDestroyed()) {
      return
    }
    emitEmbeddedBrowserState({ state: 'loading', url: normalizedUrl })
    try {
      await view.webContents.loadURL(normalizedUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_ABORTED')) {
        return
      }
      emitEmbeddedBrowserState({
        details: errorDetails,
        state: 'error',
        message: `页面加载失败：${message}`,
        url: normalizedUrl,
      })
      throw error
    }
  }

  ipcMain.handle('embedded-browser:open', async (event, url: string) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    await loadEmbeddedBrowserUrl(targetWindow, url, 'open-exception')
  })

  ipcMain.handle('embedded-browser:navigate', async (event, url: string) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    await loadEmbeddedBrowserUrl(targetWindow, url, 'navigate-exception')
  })

  ipcMain.handle('embedded-browser:reload', async () => {
    embeddedBrowserView?.webContents.reload()
  })

  ipcMain.handle('embedded-browser:set-bounds', (event, bounds: EmbeddedBrowserBounds) => {
    const nextBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    const zoomFactor = targetWindow && !targetWindow.isDestroyed()
      ? Math.max(targetWindow.webContents.getZoomFactor(), 0.01)
      : 1
    nextBounds.x = Math.max(0, Math.round(bounds.x * zoomFactor))
    nextBounds.y = Math.max(0, Math.round(bounds.y * zoomFactor))
    nextBounds.width = Math.max(0, Math.round(bounds.width * zoomFactor))
    nextBounds.height = Math.max(0, Math.round(bounds.height * zoomFactor))
    embeddedBrowserPendingBounds = nextBounds
    runtimeLogger.log('[embedded-browser:bounds]', { raw: bounds, zoomFactor, applied: nextBounds })
    if (!embeddedBrowserView) {
      return
    }
    embeddedBrowserView.setBounds(nextBounds)
  })

  ipcMain.handle('embedded-browser:close', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !embeddedBrowserView) {
      return
    }
    mainWindow.contentView.removeChildView(embeddedBrowserView)
    embeddedBrowserLastCommittedUrl = ''
    emitEmbeddedBrowserState({ state: 'idle' })
  })
}

/**
 * 创建应用窗口
 */
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
    backgroundColor: '#f5f5f0',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(isFiniteNumber(persistedWindowState?.x) && isFiniteNumber(persistedWindowState?.y)
      ? { x: persistedWindowState.x, y: persistedWindowState.y }
      : {}),
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: path.join(MAIN_DIST, 'preload.mjs'),

      // Electron 安全推荐配置
      devTools: true,
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: true, // 自动隐藏菜单栏
    ...(appIconPath ? { icon: appIconPath } : {})
  })
  mainWindow = win

  if (persistedWindowState?.maximized) {
    win.maximize()
  }

  win.on('move', () => {
    scheduleSaveWindowState(win)
  })

  win.on('resize', () => {
    scheduleSaveWindowState(win)
  })

  win.on('maximize', () => {
    scheduleSaveWindowState(win)
  })

  win.on('unmaximize', () => {
    scheduleSaveWindowState(win)
  })

  // macOS: 点击关闭按钮时隐藏窗口而不是销毁，保持当前页面与状态
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
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (!isToggleDevToolsShortcut(input)) {
      return
    }

    event.preventDefault()
    win.webContents.toggleDevTools()
  })

  // 加载页面：开发环境走 Vite Dev Server，生产环境加载 dist/index.html
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  return win
}

/**
 * 应用生命周期
 */
app.on('before-quit', () => {
  isQuitting = true
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow)
  }
})

// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 点击 Dock 图标时，如果没有窗口则重新创建
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

// app 初始化完成后创建窗口
app.whenReady().then(() => {
  const appIconPath = getAppIconPath()
  if (appIconPath && process.platform === 'darwin') {
    app.dock.setIcon(appIconPath)
  }

  registerIpcHandlers() // 注册自定义 IPC 事件
  registerWindowIpcHandlers()
  createWindow()        // 创建主窗口
})

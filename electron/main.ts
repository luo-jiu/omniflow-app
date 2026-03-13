// main.ts (Electron 主进程入口文件)

import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import registerIpcHandlers from './ipc'

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

let mainWindow: BrowserWindow | null = null
let windowHandlersRegistered = false

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

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,  // 最小宽度
    minHeight: 400, // 最小高度
    backgroundColor: '#f5f5f0',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // 预加载脚本，用于安全地与渲染进程通信
      preload: path.join(MAIN_DIST, 'preload.mjs'),

      // Electron 安全推荐配置
      webSecurity: false,
      // nodeIntegration: false,     // 禁用 Node.js 集成
      // contextIsolation: true,     // 启用上下文隔离
      // webSecurity: true           // 启用同源策略
    },
    autoHideMenuBar: true, // 自动隐藏菜单栏
  })
  mainWindow = win

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''] // 将其置为空
      }
    });
  });

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
  registerIpcHandlers() // 注册自定义 IPC 事件
  registerWindowIpcHandlers()
  createWindow()        // 创建主窗口
})

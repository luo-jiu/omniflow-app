import { app, BrowserWindow, ipcMain } from 'electron'

type WindowControlIpcOptions = {
  getMainWindow: () => BrowserWindow | null
}

const WINDOW_ACTIVATE_TOPMOST_DURATION_MS = 240

export function registerWindowControlIpcHandlers(options: WindowControlIpcOptions) {
  ipcMain.on('window-minimize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
    targetWindow?.minimize()
  })

  ipcMain.on('window-maximize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
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
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
    targetWindow?.close()
  })

  ipcMain.handle('window-activate', (event, temporaryOnTop: boolean = false) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
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
}

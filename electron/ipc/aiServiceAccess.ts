import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

export function assertMainWindowAIServiceSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): WebContents {
  return assertMainWindowSender(event, getMainWindow, '当前窗口无权访问 AI 服务配置')
}

export function assertMainWindowAgentSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): WebContents {
  return assertMainWindowSender(event, getMainWindow, '当前窗口无权访问内置 Agent')
}

function assertMainWindowSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
  errorMessage: string,
): WebContents {
  const mainWindow = getMainWindow()
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error(errorMessage)
  }
  return event.sender
}

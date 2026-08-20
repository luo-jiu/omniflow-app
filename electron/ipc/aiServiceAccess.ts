import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

export function assertMainWindowAIServiceSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): WebContents {
  const mainWindow = getMainWindow()
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.webContents.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('当前窗口无权访问 AI 服务配置')
  }
  return event.sender
}

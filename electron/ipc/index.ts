// 统一注册 ipcMain通信

import { ipcMain } from 'electron'
import { registerFileIpc } from './file'
// import { registerConfigIpc } from './config'
import { registerSystemIpc } from './system'
import { registerHttpIpc } from './http'
import { registerMediaToolIpc } from './mediaTool'
import { registerImagePreviewIpc } from './imagePreview'
import { registerFileTransferIpc } from './fileTransfer'

export default function registerIpcHandlers() {
  registerFileIpc(ipcMain)
  // registerConfigIpc(ipcMain)
  registerSystemIpc(ipcMain)
  registerHttpIpc(ipcMain)
  registerMediaToolIpc(ipcMain)
  registerImagePreviewIpc(ipcMain)
  registerFileTransferIpc()
}

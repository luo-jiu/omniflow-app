// 统一注册 ipcMain通信

import { ipcMain } from 'electron'
import { registerFileIpc } from './file'
// import { registerConfigIpc } from './config'
import { registerSystemIpc } from './system'
import { registerHttpIpc } from './http'

export default function registerIpcHandlers() {
  registerFileIpc(ipcMain)
  // registerConfigIpc(ipcMain)
  registerSystemIpc(ipcMain)
  registerHttpIpc(ipcMain)
}

// 统一注册 ipcMain通信

import { ipcMain, type BrowserWindow } from 'electron'
import { registerFileIpc } from './file'
// import { registerConfigIpc } from './config'
import { registerSystemIpc } from './system'
import { registerHttpIpc } from './http'
import { registerMediaToolIpc } from './mediaTool'
import { registerImagePreviewIpc } from './imagePreview'
import { registerFileTransferIpc } from './fileTransfer'
import { registerAIServiceIpc } from './aiService'
import { registerAgentIpc } from './agent'
import { registerQQMusicLyricsIpc } from './qqMusicLyrics'

export default function registerIpcHandlers(options: { getMainWindow: () => BrowserWindow | null }) {
  registerFileIpc(ipcMain)
  // registerConfigIpc(ipcMain)
  registerSystemIpc(ipcMain)
  registerHttpIpc(ipcMain)
  registerMediaToolIpc(ipcMain)
  registerImagePreviewIpc(ipcMain)
  registerFileTransferIpc()
  registerAIServiceIpc(ipcMain, options)
  registerAgentIpc(ipcMain, options)
  registerQQMusicLyricsIpc(ipcMain, options)
}

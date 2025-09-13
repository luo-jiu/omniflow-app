// 所有与文件相关的通信逻辑

import { dialog } from 'electron'
import fs from 'fs/promises'

export function registerFileIpc(ipcMain: Electron.IpcMain) {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const content = await fs.readFile(result.filePaths[0], 'utf-8')
    return content
  })

  ipcMain.handle('file:save', async (_e, path: string, content: string) => {
    await fs.writeFile(path, content, 'utf-8')
    return true
  })
}

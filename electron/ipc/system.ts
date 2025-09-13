import {getStaticData} from "../service/systemService.ts";

export function registerSystemIpc(ipcMain: Electron.IpcMain) {
  ipcMain.handle('sys:get-static-data', getStaticData)
}
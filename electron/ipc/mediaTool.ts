import type { IpcMain } from 'electron'
import {
  processMediaToolFile,
  type MediaToolProcessFileRequest,
} from '../service/mediaToolFfmpegService'

export function registerMediaToolIpc(ipcMain: IpcMain) {
  ipcMain.handle('media-tool:process-file', async (
    _event,
    payload: MediaToolProcessFileRequest,
  ) => processMediaToolFile(payload))
}

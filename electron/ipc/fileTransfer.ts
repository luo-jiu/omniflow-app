import { ipcMain } from 'electron'

import { getFileTransferDownloadUrlBroker } from '../service/fileTransferRuntime'

export function registerFileTransferIpc() {
  ipcMain.handle('file-transfer:get-download-url-environment', () => (
    getFileTransferDownloadUrlBroker()?.getEnvironment() || null
  ))

  ipcMain.handle('file-transfer:resolve-download-url-claim', (_event, input: {
    claimId: string
    fileName: string
    mimeType?: string
    sourceUrl: string
  }) => {
    const broker = getFileTransferDownloadUrlBroker()
    if (!broker) throw new Error('文件导出服务不可用')
    broker.resolveClaim({
      claimId: String(input?.claimId || ''),
      fileName: String(input?.fileName || 'file'),
      mimeType: String(input?.mimeType || '').trim() || undefined,
      sourceUrl: String(input?.sourceUrl || ''),
    })
    return true
  })

  ipcMain.handle('file-transfer:reject-download-url-claim', (_event, input: {
    claimId: string
    error: string
    fileName?: string
  }) => {
    const broker = getFileTransferDownloadUrlBroker()
    if (!broker) return false
    broker.rejectClaim({
      claimId: String(input?.claimId || ''),
      error: String(input?.error || '无法取得文件访问链接'),
      fileName: String(input?.fileName || '').trim() || undefined,
    })
    return true
  })
}

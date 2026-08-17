import { FileTransferDownloadUrlBroker } from './fileTransferDownloadUrlBroker'

let downloadUrlBroker: FileTransferDownloadUrlBroker | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null

export async function initializeFileTransferRuntime(): Promise<void> {
  if (downloadUrlBroker) return
  const nextBroker = new FileTransferDownloadUrlBroker()
  await nextBroker.start()
  downloadUrlBroker = nextBroker
  sweepTimer = setInterval(() => {
    downloadUrlBroker?.sweepExpired()
  }, 60_000)
  sweepTimer.unref?.()
}

export function getFileTransferDownloadUrlBroker(): FileTransferDownloadUrlBroker | null {
  return downloadUrlBroker
}

export async function clearFileTransferRuntime(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  const activeBroker = downloadUrlBroker
  downloadUrlBroker = null
  await activeBroker?.close()
}

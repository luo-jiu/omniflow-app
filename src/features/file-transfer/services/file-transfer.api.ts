import { normalizeDownloadFileName } from '../model/download-file-name'
import type { FileTransferDownloadUrlEnvironment } from '../model/file-transfer'

let downloadUrlEnvironment: FileTransferDownloadUrlEnvironment | null = null
let downloadUrlEnvironmentPromise: Promise<FileTransferDownloadUrlEnvironment | null> | null = null

function requireBridge() {
  if (!window.electronAPI?.fileTransferGetDownloadUrlEnvironment) {
    throw new Error('当前环境不支持文件传输')
  }
  return window.electronAPI
}

export function warmFileTransferDownloadUrlEnvironment(): Promise<FileTransferDownloadUrlEnvironment | null> {
  if (downloadUrlEnvironment) return Promise.resolve(downloadUrlEnvironment)
  if (downloadUrlEnvironmentPromise) return downloadUrlEnvironmentPromise
  const bridge = requireBridge()
  downloadUrlEnvironmentPromise = bridge.fileTransferGetDownloadUrlEnvironment()
    .then((environment) => {
      downloadUrlEnvironment = environment
      return environment
    })
    .finally(() => {
      downloadUrlEnvironmentPromise = null
    })
  return downloadUrlEnvironmentPromise
}

function createClaimId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createFileTransferDownloadUrlClaim(fileName: string): {
  claimId: string
  downloadUrl: string
  fileName: string
} | null {
  if (!downloadUrlEnvironment) {
    void warmFileTransferDownloadUrlEnvironment().catch(() => undefined)
    return null
  }
  const claimId = createClaimId()
  const safeFileName = normalizeDownloadFileName(fileName)
  const { origin, runtimeToken } = downloadUrlEnvironment
  return {
    claimId,
    downloadUrl: `${origin}/file-transfer-download/${runtimeToken}/${claimId}/${encodeURIComponent(safeFileName)}`,
    fileName: safeFileName,
  }
}

export function resolveFileTransferDownloadUrlClaim(input: {
  claimId: string
  fileName: string
  mimeType?: string
  sourceUrl: string
}): Promise<boolean> {
  return requireBridge().fileTransferResolveDownloadUrlClaim(input)
}

export function registerFileTransferInternalDropClaim(input: {
  claimId: string
  fileName: string
}): void {
  requireBridge().fileTransferRegisterInternalDropClaim(input)
}

export function rejectFileTransferDownloadUrlClaim(input: {
  claimId: string
  error: string
  fileName?: string
}): Promise<boolean> {
  return requireBridge().fileTransferRejectDownloadUrlClaim(input)
}

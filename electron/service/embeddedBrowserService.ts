import { app, session, type DownloadItem, type Session, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export type EmbeddedBrowserDownloadPayload = {
  downloadId: string
  error?: string
  fileName: string
  mimeType?: string
  pageUrl?: string
  receivedBytes: number
  state: 'started' | 'progress' | 'completed' | 'cancelled' | 'failed'
  tabId?: string
  tempPath?: string
  totalBytes: number
  url: string
}

export const EMBEDDED_BROWSER_PARTITION = 'persist:omniflow-embedded-browser'
const EMBEDDED_BROWSER_DOWNLOAD_DIRNAME = 'embedded-browser-downloads'

let embeddedBrowserSessionInstance: Session | null = null
let embeddedBrowserDownloadBridgeInitialized = false

function getEmbeddedBrowserDownloadRoot() {
  return path.join(app.getPath('userData'), EMBEDDED_BROWSER_DOWNLOAD_DIRNAME)
}

function ensureEmbeddedBrowserDownloadRoot() {
  const root = getEmbeddedBrowserDownloadRoot()
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }
  return root
}

function buildDownloadId() {
  return `embedded-browser-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildStagedDownloadName(fileName: string) {
  const safeName = String(fileName || 'download')
    .replace(/[/\\]/g, '_')
    .trim() || 'download'
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
}

function toDownloadPayload(
  item: DownloadItem,
  overrides: Partial<EmbeddedBrowserDownloadPayload> & Pick<EmbeddedBrowserDownloadPayload, 'downloadId' | 'fileName' | 'state' | 'url'>,
): EmbeddedBrowserDownloadPayload {
  return {
    downloadId: overrides.downloadId,
    fileName: overrides.fileName,
    mimeType: overrides.mimeType,
    pageUrl: overrides.pageUrl,
    receivedBytes: overrides.receivedBytes ?? Math.max(0, Number(item.getReceivedBytes?.() || 0)),
    state: overrides.state,
    tabId: overrides.tabId,
    tempPath: overrides.tempPath,
    totalBytes: overrides.totalBytes ?? Math.max(0, Number(item.getTotalBytes?.() || 0)),
    url: overrides.url,
    ...(overrides.error ? { error: overrides.error } : {}),
  }
}

export function getEmbeddedBrowserSession() {
  if (!embeddedBrowserSessionInstance) {
    embeddedBrowserSessionInstance = session.fromPartition(EMBEDDED_BROWSER_PARTITION)
  }
  return embeddedBrowserSessionInstance
}

export async function cleanupEmbeddedBrowserDownloadFile(tempPath?: string): Promise<boolean> {
  const normalizedPath = path.resolve(String(tempPath || '').trim())
  if (!normalizedPath) {
    return false
  }

  const downloadRoot = path.resolve(getEmbeddedBrowserDownloadRoot())
  if (normalizedPath !== downloadRoot && !normalizedPath.startsWith(`${downloadRoot}${path.sep}`)) {
    return false
  }

  await fs.rm(normalizedPath, { force: true })
  return true
}

export function initializeEmbeddedBrowserDownloadBridge(options: {
  emitDownload: (payload: EmbeddedBrowserDownloadPayload) => void
  resolveTabIdByWebContents: (webContents: WebContents) => string | null
}) {
  if (embeddedBrowserDownloadBridgeInitialized) {
    return
  }
  embeddedBrowserDownloadBridgeInitialized = true

  const handleWillDownload = (_event: Electron.Event, item: DownloadItem, webContents: WebContents) => {
    const tabId = options.resolveTabIdByWebContents(webContents) || undefined
    if (!tabId) {
      return
    }
    const downloadRoot = ensureEmbeddedBrowserDownloadRoot()
    const downloadId = buildDownloadId()
    const fileName = item.getFilename() || 'download'
    const url = item.getURL() || ''
    const pageUrl = webContents.getURL() || undefined
    const tempPath = path.join(downloadRoot, buildStagedDownloadName(fileName))

    item.setSavePath(tempPath)
    options.emitDownload(toDownloadPayload(item, {
      downloadId,
      fileName,
      mimeType: item.getMimeType() || undefined,
      pageUrl,
      state: 'started',
      tabId,
      tempPath,
      url,
    }))

    item.on('updated', (_updatedEvent, state) => {
      if (state !== 'progressing') {
        return
      }
      options.emitDownload(toDownloadPayload(item, {
        downloadId,
        fileName,
        mimeType: item.getMimeType() || undefined,
        pageUrl,
        state: 'progress',
        tabId,
        tempPath,
        url,
      }))
    })

    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        options.emitDownload(toDownloadPayload(item, {
          downloadId,
          fileName,
          mimeType: item.getMimeType() || undefined,
          pageUrl,
          state: 'completed',
          tabId,
          tempPath,
          url,
        }))
        return
      }

      void cleanupEmbeddedBrowserDownloadFile(tempPath).catch(() => undefined)
      options.emitDownload(toDownloadPayload(item, {
        downloadId,
        error: state === 'cancelled' ? '下载已取消' : `下载失败：${state}`,
        fileName,
        mimeType: item.getMimeType() || undefined,
        pageUrl,
        state: state === 'cancelled' ? 'cancelled' : 'failed',
        tabId,
        tempPath,
        url,
      }))
    })
  }

  const handledSessions = new Set<Session>()
  const candidateSessions = [session.defaultSession, getEmbeddedBrowserSession()].filter(Boolean)
  candidateSessions.forEach((candidate) => {
    if (handledSessions.has(candidate)) {
      return
    }
    handledSessions.add(candidate)
    candidate.on('will-download', handleWillDownload)
  })
}

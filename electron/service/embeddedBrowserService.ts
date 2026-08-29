import { app, session, type DownloadItem, type Session, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { runtimeLogger } from '../runtimeLogger'
import { defaultProcessingTaskRegistry } from './embedded-browser/processing/task-registry'
import {
  NativeDownloadSession,
  type NativeDownloadSessionPayload,
} from './embedded-browser/processing/native-download-session'

export type EmbeddedBrowserDownloadPayload = NativeDownloadSessionPayload

export const EMBEDDED_BROWSER_PARTITION = 'persist:omniflow-embedded-browser'
const EMBEDDED_BROWSER_DOWNLOAD_DIRNAME = 'embedded-browser-downloads'

let embeddedBrowserSessionInstance: Session | null = null
let embeddedBrowserDownloadBridgeInitialized = false

export function getEmbeddedBrowserDownloadStagingRoot() {
  return path.join(app.getPath('userData'), EMBEDDED_BROWSER_DOWNLOAD_DIRNAME)
}

function ensureEmbeddedBrowserDownloadRoot() {
  const root = getEmbeddedBrowserDownloadStagingRoot()
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

  const downloadRoot = path.resolve(getEmbeddedBrowserDownloadStagingRoot())
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
    let registration: ReturnType<typeof defaultProcessingTaskRegistry.register> | undefined
    const downloadSession = new NativeDownloadSession({
      cleanup: async (stagedPath) => {
        await cleanupEmbeddedBrowserDownloadFile(stagedPath)
      },
      downloadId,
      emit: options.emitDownload,
      fileName,
      item,
      onSettled: () => registration?.release(),
      pageUrl,
      tabId,
      tempPath,
      url,
    })
    try {
      registration = defaultProcessingTaskRegistry.register({
        cancel: () => downloadSession.cancel(),
        kind: 'native-download',
        settled: downloadSession.settled,
        tabId,
      })
      downloadSession.start()
    } catch (error) {
      registration?.release()
      void cleanupEmbeddedBrowserDownloadFile(tempPath).catch(() => undefined)
      runtimeLogger.warn('embedded browser native download session failed to start', {
        error: error instanceof Error ? error.message : String(error),
        tabId,
        url,
      })
    }
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

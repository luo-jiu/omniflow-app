import os from 'node:os'
import path from 'node:path'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, shell, WebContentsView, type WebFrameMain } from 'electron'
import { runtimeLogger } from '../runtimeLogger'
import type { EmbeddedBrowserStagePageDragRequest } from '@/features/file-transfer/model/browser-drag-transfer'
import type {
  LibraryFileBrowserDropPayload,
  LibraryFileBrowserDropResult,
} from '@/features/file-transfer/model/file-transfer'
import { getFileTransferDownloadUrlBroker } from './fileTransferRuntime'
import type { EmbeddedBrowserCatchToolkitStatePayload } from './embeddedBrowserCatchToolkitPageBridge'
import {
  getEmbeddedBrowserCatchToolkitState,
  runEmbeddedBrowserCatchToolkitAction,
  updateEmbeddedBrowserCatchToolkitState,
} from './embeddedBrowserCatchToolkitActionService'
import {
  registerEmbeddedBrowserMainIpcHandlers,
} from './embeddedBrowserMainIpc'
import {
  getEmbeddedBrowserCookies,
  removeAllEmbeddedBrowserCookies,
  removeEmbeddedBrowserCookie,
  removeEmbeddedBrowserCookiesByDomain,
} from './embeddedBrowserCookieService'
import type { EmbeddedBrowserCapturedCredentialEvent } from './embeddedBrowserPasswordTypes'
import {
  addEmbeddedBrowserBlacklistedDomain,
  cacheEmbeddedBrowserCredential,
  consumeEmbeddedBrowserCachedCredential,
  decryptEmbeddedBrowserPasswordForAutoFill,
  deleteAllEmbeddedBrowserPasswords,
  deleteEmbeddedBrowserPassword,
  getEmbeddedBrowserDecryptedPassword,
  getEmbeddedBrowserPasswordsForDomain,
  hasEmbeddedBrowserMatchingPassword,
  isEmbeddedBrowserBlacklistedDomain,
  listEmbeddedBrowserPasswords,
  saveEmbeddedBrowserPassword,
} from './embeddedBrowserPasswordService'
import {
  type EmbeddedBrowserBounds,
  type EmbeddedBrowserCapturedResourceMergePayload,
  type EmbeddedBrowserCapturedResourceMergeResponse,
  type EmbeddedBrowserCapturedResourceSavePayload,
  type EmbeddedBrowserCapturedResourceSaveResponse,
  type EmbeddedBrowserCapturedResourceTranscodePayload,
  type EmbeddedBrowserCapturedResourceTranscodeResponse,
  type EmbeddedBrowserHlsDownloadPayload,
  type EmbeddedBrowserHlsTrackMergePayload,
  type EmbeddedBrowserHlsTrackMergeResponse,
  type EmbeddedBrowserHlsTaskEventPayload,
  type EmbeddedBrowserHlsPlanDownloadPayload,
  type EmbeddedBrowserHlsPlanDownloadResponse,
  type EmbeddedBrowserHlsPlanRetryPayload,
  type EmbeddedBrowserHlsPlanRetryResponse,
  type EmbeddedBrowserHlsRecordingDiscardPayload,
  type EmbeddedBrowserHlsRecordingDiscardResponse,
  type EmbeddedBrowserHlsRecordingStartPayload,
  type EmbeddedBrowserHlsRecordingStartResponse,
  type EmbeddedBrowserHlsRecordingStopPayload,
  type EmbeddedBrowserHlsRecordingStopResponse,
  type EmbeddedBrowserHlsDownloadResponse,
  type EmbeddedBrowserDirectFileDownloadPayload,
  type EmbeddedBrowserDirectFileDownloadResponse,
  type EmbeddedBrowserCapturedResourceDownloadPayload,
  type EmbeddedBrowserMainControllerOptions,
  type EmbeddedBrowserMpdDownloadPayload,
  type EmbeddedBrowserMpdDownloadResponse,
  type EmbeddedBrowserMpdPlanDownloadPayload,
  type EmbeddedBrowserMpdPlanDownloadResponse,
  type EmbeddedBrowserStatePayload,
} from './embeddedBrowserMainTypes'
import {
  configureEmbeddedBrowserSession,
  initializeEmbeddedBrowserMainBridges,
  resolveEmbeddedBrowserBookmarkFavicon,
} from './embeddedBrowserMainSupport'
import {
  bumpEmbeddedBrowserOpenFileRequestVersion,
  cleanupEmbeddedBrowserOpenFileForTab,
  isEmbeddedBrowserOpenFileRequestCurrent,
  tryDispatchPendingEmbeddedBrowserOpenFile,
  type EmbeddedBrowserPendingOpenFile,
} from './embeddedBrowserOpenFileFlow'
import {
  drainEmbeddedBrowserMseResourceFromPage,
  extractEmbeddedBrowserResourceFromPage,
  runEmbeddedBrowserResourcePreview,
  runEmbeddedBrowserResourceProbeAction,
} from './embeddedBrowserResourceActionService'
import {
  type EmbeddedBrowserResourcePreviewPayload,
} from './embeddedBrowserResourcePageBridge'
import {
  cleanupEmbeddedBrowserDownloadFile,
  getEmbeddedBrowserSession,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import {
  clearEmbeddedBrowserPageDragSources,
  readEmbeddedBrowserPageBlob,
  recordEmbeddedBrowserPageDragSource,
  stageEmbeddedBrowserPageDrag,
} from './embeddedBrowserPageDragService'
import {
  listEmbeddedBrowserResourceCaptureRules,
  resetEmbeddedBrowserResourceCaptureRules,
  updateEmbeddedBrowserResourceCaptureRules,
} from './embeddedBrowserResourceCaptureRules'
import {
  dispatchEmbeddedBrowserExternalTool,
  listEmbeddedBrowserExternalToolSettings,
  listEnabledEmbeddedBrowserExternalToolOptions,
  resetEmbeddedBrowserExternalToolSettings,
  updateEmbeddedBrowserExternalToolSettings,
} from './embeddedBrowserExternalTools'
import { ExternalToolDispatcher } from './embedded-browser/integrations/external-tools'
import {
  createEmbeddedBrowserView as createEmbeddedBrowserManagedView,
  installEmbeddedBrowserResourceProbe,
} from './embeddedBrowserViewLifecycle'
import { EmbeddedBrowserCaptureRuntime } from './embedded-browser/orchestration/embedded-browser-capture-runtime'
import {
  compileOmniFlowCaptureSettings,
} from './embedded-browser/capture/policy/omniflow-capture-policy'
import type {
  ResourceStateChange,
  ResourceStateSnapshot,
} from './embedded-browser/contracts/captured-resource'
import type { ExternalToolKey } from './embedded-browser/integrations/external-tools'
import {
  EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY,
} from './embeddedBrowserResourceProbe'
import {
  deriveEmbeddedBrowserMergedFileName,
  mergeEmbeddedBrowserResourceTracks,
  normalizeEmbeddedBrowserResourceTranscodeFormat,
  transcodeEmbeddedBrowserResource,
  type EmbeddedBrowserExtractedResourceFile,
} from './embeddedBrowserResourceMergeService'
import {
  deriveEmbeddedBrowserExtractedResourceOutputFileName,
  saveEmbeddedBrowserExtractedResourceFile,
} from './embeddedBrowserResourceFileSaveService'
import {
  deriveEmbeddedBrowserManifestOutputFileName,
  downloadEmbeddedBrowserManifestResource,
  downloadEmbeddedBrowserManifestTracks,
  type EmbeddedBrowserManifestDownloadKind,
} from './embeddedBrowserResourceManifestDownloadService'
import {
  downloadEmbeddedBrowserHlsToLocalWorkDirectory,
} from './embeddedBrowserHlsLocalDownloaderService'
import type { EmbeddedBrowserFragmentFetch } from './embeddedBrowserFragmentDownloader'
import {
  downloadEmbeddedBrowserMpdToOutput,
} from './embeddedBrowserMpdLocalDownloaderService'
import {
  EmbeddedBrowserHlsLiveRecorder,
} from './embeddedBrowserHlsLiveRecorder'
import {
  EmbeddedBrowserHlsSessionOwner,
} from './embedded-browser/processing/hls-session-owner'
import {
  cleanupStaleEmbeddedBrowserOpenFiles,
  cleanupEmbeddedBrowserOpenFile,
  cleanupEmbeddedBrowserOpenFileSync,
  dispatchEmbeddedBrowserFileDrop,
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_MAX_BYTES,
  stageEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'
import { EmbeddedBrowserDroppedFileStore } from './embeddedBrowserDroppedFileStore'
import {
  handleEmbeddedBrowserInputShortcut,
  toggleEmbeddedBrowserDevTools,
} from './embeddedBrowserInputShortcuts'

export function createEmbeddedBrowserMainController(
  options: EmbeddedBrowserMainControllerOptions,
) {
  type EmbeddedBrowserHlsRetrySession = {
    failedFragments: number[]
    ffmpegPath?: string
    manualKeyBase64?: string
    outputPath: string
    plan: EmbeddedBrowserHlsPlanDownloadPayload['plan']
    resourceId?: string
    requestId: string
    tabId: string
    workDirectoryPath: string
  }

  type EmbeddedBrowserHlsLiveRecordingSession = {
    ffmpegPath?: string
    manifestUrl: string
    outputPath: string
    recorder: EmbeddedBrowserHlsLiveRecorder
    requestId: string
    tabId: string
    workDirectoryPath?: string
  }

  type EmbeddedBrowserMseSpoolFile = {
    bytesWritten: number
    directoryPath: string
    fileName: string
    filePath: string
    mimeType?: string
    resourceKey: string
    streamType?: 'audio' | 'video'
    tabId: string
  }

  const embeddedBrowserViews = new Map<string, WebContentsView>()
  const embeddedBrowserLastCommittedUrls = new Map<string, string>()
  const embeddedBrowserIconUrls = new Map<string, string>()
  const embeddedBrowserIconSourceUrls = new Map<string, string>()
  const embeddedBrowserPendingOpenFiles = new Map<string, EmbeddedBrowserPendingOpenFile>()
  const embeddedBrowserAttachedOpenFiles = new Map<string, string>()
  const embeddedBrowserOpenFileRequestVersions = new Map<string, number>()
  const embeddedBrowserLibraryFileDropRequests = new Map<string, Set<AbortController>>()
  const embeddedBrowserDroppedFileStore = new EmbeddedBrowserDroppedFileStore({
    cleanupFile: cleanupEmbeddedBrowserOpenFile,
    cleanupFileSync: cleanupEmbeddedBrowserOpenFileSync,
  })
  const embeddedBrowserFileSystemOriginDecisions = new Map<string, boolean>()
  const embeddedBrowserHlsSessionOwner = new EmbeddedBrowserHlsSessionOwner<
    EmbeddedBrowserHlsRetrySession,
    EmbeddedBrowserHlsLiveRecordingSession
  >()
  const embeddedBrowserMseSpoolFiles = new Map<string, EmbeddedBrowserMseSpoolFile>()
  const embeddedBrowserMseSpoolWriteQueues = new Map<string, Promise<EmbeddedBrowserMseSpoolFile | null>>()
  let activeEmbeddedBrowserTabId: string | null = null
  let selectedEmbeddedBrowserTabId: string | null = null
  let embeddedBrowserPendingBounds: EmbeddedBrowserBounds | null = null
  let embeddedBrowserSessionConfigured = false
  let captureRuntime: EmbeddedBrowserCaptureRuntime | null = null

  async function dispatchCapturedResourceToExternalTool(
    toolKey: ExternalToolKey,
    request: { resourceId: string; tabId: string },
  ) {
    if (!captureRuntime) {
      throw new Error('资源捕捉尚未初始化')
    }
    const dispatcher = new ExternalToolDispatcher({
      access: captureRuntime.access,
      execute: (key, payload) => dispatchEmbeddedBrowserExternalTool(key, payload),
    })
    return dispatcher.dispatch({
      resourceId: request.resourceId,
      tabId: request.tabId,
      toolKey,
    })
  }

  function emitEmbeddedBrowserState(payload: EmbeddedBrowserStatePayload) {
    runtimeLogger.log('[embedded-browser:main]', payload)
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:state', payload)
  }

  function emitEmbeddedBrowserDownload(payload: EmbeddedBrowserDownloadPayload) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:download', payload)
  }

  function emitEmbeddedBrowserResourceChange(payload: ResourceStateChange) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:resource-state-change', payload)
  }

  function emitEmbeddedBrowserHlsTask(payload: EmbeddedBrowserHlsTaskEventPayload) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:hls-task', payload)
  }

  function emitEmbeddedBrowserLibraryFileDropResult(payload: LibraryFileBrowserDropResult) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:library-file-drop-result', payload)
  }

  function beginEmbeddedBrowserLibraryFileDropRequest(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    const request = new AbortController()
    const requests = embeddedBrowserLibraryFileDropRequests.get(normalizedTabId) || new Set<AbortController>()
    requests.add(request)
    embeddedBrowserLibraryFileDropRequests.set(normalizedTabId, requests)
    return request
  }

  function isEmbeddedBrowserLibraryFileDropRequestActive(tabId: string, request: AbortController) {
    return !request.signal.aborted
      && embeddedBrowserLibraryFileDropRequests.get(tabId)?.has(request) === true
  }

  function finishEmbeddedBrowserLibraryFileDropRequest(tabId: string, request: AbortController) {
    const requests = embeddedBrowserLibraryFileDropRequests.get(tabId)
    if (!requests) return
    requests.delete(request)
    if (requests.size === 0) {
      embeddedBrowserLibraryFileDropRequests.delete(tabId)
    }
  }

  function cancelEmbeddedBrowserLibraryFileDropRequests(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    const requests = embeddedBrowserLibraryFileDropRequests.get(normalizedTabId)
    embeddedBrowserLibraryFileDropRequests.delete(normalizedTabId)
    requests?.forEach((request) => request.abort())
  }

  function selectEmbeddedBrowserTab(tabId: string | null) {
    const normalizedTabId = String(tabId || '').trim() || null
    if (selectedEmbeddedBrowserTabId && selectedEmbeddedBrowserTabId !== normalizedTabId) {
      cancelEmbeddedBrowserLibraryFileDropRequests(selectedEmbeddedBrowserTabId)
    }
    selectedEmbeddedBrowserTabId = normalizedTabId
  }

  function cleanupEmbeddedBrowserDroppedFilesForTab(tabId: string) {
    void embeddedBrowserDroppedFileStore.releaseTab(String(tabId || '').trim())
  }

  function normalizeLibraryFileDropPayload(
    payload: Record<string, unknown>,
  ): LibraryFileBrowserDropPayload | null {
    const claimId = String(payload.claimId || '').trim()
    const fileName = String(payload.fileName || '').trim()
    const mimeType = String(payload.mimeType || '').trim()
    const pageUrl = String(payload.pageUrl || '').trim()
    const frameCoordinateSupported = payload.frameCoordinateSupported === true
    const clientX = Number(payload.clientX)
    const clientY = Number(payload.clientY)
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(claimId) || !fileName || fileName.length > 255) {
      return null
    }
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null
    }
    try {
      const parsedPageUrl = new URL(pageUrl)
      if (!['http:', 'https:'].includes(parsedPageUrl.protocol)) return null
    } catch {
      return null
    }
    return {
      claimId,
      clientX: Math.max(0, clientX),
      clientY: Math.max(0, clientY),
      fileName,
      frameCoordinateSupported,
      mimeType: mimeType || undefined,
      pageUrl,
    }
  }

  function hasEmbeddedBrowserDocument(view: WebContentsView, pageUrl: string) {
    const normalizeDocumentUrl = (value: string) => {
      try {
        const parsed = new URL(value)
        parsed.hash = ''
        return parsed.toString()
      } catch {
        return ''
      }
    }
    const normalizedPageUrl = normalizeDocumentUrl(pageUrl)
    if (!normalizedPageUrl) return false
    const mainFrame = view.webContents.mainFrame
    return [mainFrame, ...mainFrame.framesInSubtree]
      .some((frame) => normalizeDocumentUrl(frame.url) === normalizedPageUrl)
  }

  async function handleLibraryFileDropPayload(tabId: string, rawPayload: Record<string, unknown>) {
    const normalizedTabId = String(tabId || '').trim()
    const payload = normalizeLibraryFileDropPayload(rawPayload)
    if (!normalizedTabId || !payload) return
    if (activeEmbeddedBrowserTabId !== normalizedTabId) return
    if (!payload.frameCoordinateSupported) {
      emitEmbeddedBrowserLibraryFileDropResult({
        error: '暂不支持拖入跨域 iframe，请使用网页主页面的上传区域',
        fileName: payload.fileName,
        status: 'failed',
        tabId: normalizedTabId,
      })
      return
    }
    cancelEmbeddedBrowserLibraryFileDropRequests(normalizedTabId)
    const request = beginEmbeddedBrowserLibraryFileDropRequest(normalizedTabId)
    emitEmbeddedBrowserLibraryFileDropResult({
      fileName: payload.fileName,
      status: 'preparing',
      tabId: normalizedTabId,
    })

    let stagedPath = ''
    let retained = false
    try {
      const broker = getFileTransferDownloadUrlBroker()
      if (!broker) throw new Error('文件传输服务不可用')
      const claim = await broker.waitForResolvedClaim(
        payload.claimId,
        payload.fileName,
        request.signal,
      )
      if (!isEmbeddedBrowserLibraryFileDropRequestActive(normalizedTabId, request)) {
        throw new Error('网页已切换，文件未交付')
      }
      stagedPath = await stageEmbeddedBrowserOpenFile(
        claim.sourceUrl,
        claim.fileName,
        {},
        {
          maxBytes: EMBEDDED_BROWSER_LIBRARY_FILE_DROP_MAX_BYTES,
          signal: request.signal,
        },
      )
      const view = getEmbeddedBrowserView(normalizedTabId)
      if (
        !view
        || view.webContents.isDestroyed()
        || !hasEmbeddedBrowserDocument(view, payload.pageUrl)
        || !isEmbeddedBrowserLibraryFileDropRequestActive(normalizedTabId, request)
      ) {
        throw new Error('网页已切换，文件未交付')
      }
      const stagedFile = await stat(stagedPath)
      if (!isEmbeddedBrowserLibraryFileDropRequestActive(normalizedTabId, request)) {
        throw new Error('网页已切换，文件未交付')
      }
      embeddedBrowserDroppedFileStore.retain(normalizedTabId, stagedPath, stagedFile.size)
      retained = true
      const delivered = await dispatchEmbeddedBrowserFileDrop(view, stagedPath, {
        x: payload.clientX,
        y: payload.clientY,
      })
      if (!delivered) throw new Error('当前网页位置没有接收这个文件')
      stagedPath = ''
      emitEmbeddedBrowserLibraryFileDropResult({
        fileName: claim.fileName,
        status: 'delivered',
        tabId: normalizedTabId,
      })
    } catch (error) {
      if (stagedPath) {
        if (retained) {
          const released = await embeddedBrowserDroppedFileStore.release(normalizedTabId, stagedPath)
          if (!released) await cleanupEmbeddedBrowserOpenFile(stagedPath).catch(() => undefined)
        } else {
          await cleanupEmbeddedBrowserOpenFile(stagedPath).catch(() => undefined)
        }
      }
      if (isEmbeddedBrowserLibraryFileDropRequestActive(normalizedTabId, request)) {
        emitEmbeddedBrowserLibraryFileDropResult({
          error: error instanceof Error ? error.message : String(error),
          fileName: payload.fileName,
          status: 'failed',
          tabId: normalizedTabId,
        })
      }
    } finally {
      finishEmbeddedBrowserLibraryFileDropRequest(normalizedTabId, request)
    }
  }

  function buildEmbeddedBrowserMseSpoolKey(tabId: string, resourceKey: string) {
    return `${String(tabId || '').trim()}:${String(resourceKey || '').trim()}`
  }

  async function clearEmbeddedBrowserMseSpoolFiles(options: {
    resourceKey?: string
    tabId?: string
  }) {
    const normalizedTabId = String(options.tabId || '').trim()
    const normalizedResourceKey = String(options.resourceKey || '').trim()
    if (!normalizedTabId && !normalizedResourceKey) {
      return
    }
    const matchedEntries = Array.from(embeddedBrowserMseSpoolFiles.entries()).filter(([, file]) => {
      if (normalizedTabId && file.tabId !== normalizedTabId) {
        return false
      }
      if (normalizedResourceKey && file.resourceKey !== normalizedResourceKey) {
        return false
      }
      return true
    })
    await Promise.all(matchedEntries.map(async ([key, file]) => {
      embeddedBrowserMseSpoolFiles.delete(key)
      embeddedBrowserMseSpoolWriteQueues.delete(key)
      await rm(file.directoryPath, { force: true, recursive: true }).catch(() => undefined)
    }))
  }

  async function waitForEmbeddedBrowserMseSpoolWrites(tabId: string, resourceKey: string) {
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(tabId, resourceKey)
    const pendingWrite = embeddedBrowserMseSpoolWriteQueues.get(spoolKey)
    if (!pendingWrite) {
      return
    }
    await pendingWrite.catch(() => undefined)
  }

  async function appendEmbeddedBrowserMseSpoolChunk(tabId: string, payload: {
    base64: string
    fileName?: string
    mimeType?: string
    resourceKey: string
    streamType?: 'audio' | 'video'
  }) {
    const normalizedTabId = String(tabId || '').trim()
    const normalizedResourceKey = String(payload.resourceKey || '').trim()
    const normalizedBase64 = String(payload.base64 || '').trim()
    if (!normalizedTabId || !normalizedResourceKey || !normalizedBase64) {
      return null
    }
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(normalizedTabId, normalizedResourceKey)
    const chunk = Buffer.from(normalizedBase64, 'base64')
    const nextWrite = (embeddedBrowserMseSpoolWriteQueues.get(spoolKey) || Promise.resolve(null))
      .then(async (existingSpoolFile) => {
        let spoolFile = existingSpoolFile || embeddedBrowserMseSpoolFiles.get(spoolKey) || null
        if (!spoolFile) {
          const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-spool-'))
          const fileName = sanitizeEmbeddedBrowserOutputFileName(
            String(payload.fileName || normalizedResourceKey || 'media').trim(),
          )
          spoolFile = {
            bytesWritten: 0,
            directoryPath,
            fileName,
            filePath: path.join(directoryPath, fileName),
            mimeType: payload.mimeType,
            resourceKey: normalizedResourceKey,
            streamType: payload.streamType,
            tabId: normalizedTabId,
          }
          embeddedBrowserMseSpoolFiles.set(spoolKey, spoolFile)
        }
        if (chunk.byteLength) {
          await appendFile(spoolFile.filePath, chunk)
          spoolFile.bytesWritten += chunk.byteLength
        }
        if (payload.mimeType) {
          spoolFile.mimeType = payload.mimeType
        }
        if (payload.streamType === 'audio' || payload.streamType === 'video') {
          spoolFile.streamType = payload.streamType
        }
        return spoolFile
      })
    embeddedBrowserMseSpoolWriteQueues.set(spoolKey, nextWrite)
    const spoolFile = await nextWrite
    return spoolFile
  }

  async function clearEmbeddedBrowserHlsRetrySessions(options: {
    all?: boolean
    requestId?: string
    tabId?: string
  }) {
    await embeddedBrowserHlsSessionOwner.clearRetry(options)
  }

  async function clearEmbeddedBrowserHlsLiveRecordingSessions(options: {
    all?: boolean
    requestId?: string
    tabId?: string
  }) {
    await embeddedBrowserHlsSessionOwner.clearLive(options)
  }

  async function clearEmbeddedBrowserHlsSessions(options: {
    all?: boolean
    requestId?: string
    tabId?: string
  }) {
    await embeddedBrowserHlsSessionOwner.clearActive(options)
    await Promise.all([
      embeddedBrowserHlsSessionOwner.clearRetry(options),
      embeddedBrowserHlsSessionOwner.clearLive(options),
    ])
  }

  function emitCredentialCaptured(payload: EmbeddedBrowserCapturedCredentialEvent) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:credential-captured', payload)
  }

  function emitCredentialAutoFilled(payload: {
    tabId: string
    domain: string
    filledUsername: string
    alternatives: Array<{ id: string; username: string }>
  }) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:credential-autofilled', payload)
  }

  function resolveEmbeddedBrowserTabIdByWebContents(targetContents: Electron.WebContents) {
    for (const [tabId, view] of embeddedBrowserViews.entries()) {
      if (view.webContents === targetContents) {
        return tabId
      }
    }
    return null
  }

  function configureSession() {
    if (embeddedBrowserSessionConfigured) {
      return
    }
    embeddedBrowserSessionConfigured = true
    void cleanupStaleEmbeddedBrowserOpenFiles().catch(() => undefined)
    configureEmbeddedBrowserSession({
      decisionCache: embeddedBrowserFileSystemOriginDecisions,
      options,
    })
  }

  function initializeBridges() {
    const browserSession = getEmbeddedBrowserSession()
    initializeEmbeddedBrowserMainBridges({
      emitDownload: emitEmbeddedBrowserDownload,
      resolveTabIdByWebContents: resolveEmbeddedBrowserTabIdByWebContents,
    })
    if (captureRuntime) {
      return
    }
    captureRuntime = new EmbeddedBrowserCaptureRuntime({
      captureSettings: compileOmniFlowCaptureSettings(
        listEmbeddedBrowserResourceCaptureRules(),
      ),
      emitChange: emitEmbeddedBrowserResourceChange,
      fetch: (url, init) => browserSession.fetch(url, init),
      onProbeControlPayload: (tabId, payload) => {
        const event = typeof payload.event === 'string' ? payload.event : ''
        const resourceKey = typeof payload.resourceKey === 'string' ? payload.resourceKey : ''
        if (event === 'mse-flush') {
          void appendEmbeddedBrowserMseSpoolChunk(tabId, {
            base64: typeof payload.base64 === 'string' ? payload.base64 : '',
            fileName: typeof payload.fileName === 'string' ? payload.fileName : undefined,
            mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
            resourceKey,
            streamType: payload.streamType === 'audio' || payload.streamType === 'video'
              ? payload.streamType
              : undefined,
          })
          return
        }
        if (event === 'mse-reset') {
          void clearEmbeddedBrowserMseSpoolFiles({ resourceKey, tabId })
        }
      },
      onProbeError: (tabId, error) => {
        runtimeLogger.warn('embedded browser resource probe payload rejected', {
          error: error instanceof Error ? error.message : String(error),
          tabId,
        })
      },
      pageUrlPolicy: { damn: true },
      webRequest: browserSession.webRequest,
    })
  }

  function createEmbeddedBrowserCapturedResourceFetch(tabId: string, seedResourceId?: string): EmbeddedBrowserFragmentFetch {
    const browserSession = getEmbeddedBrowserSession()
    const normalizedSeedResourceId = String(seedResourceId || '').trim()
    return async (input, init) => {
      const resourceUrl = String(input || '').trim()
      let resourceId = captureRuntime?.resolveResourceIdByUrl(tabId, resourceUrl)
      if (!resourceId && normalizedSeedResourceId && captureRuntime) {
        const seedGrant = captureRuntime.access.redeem({
          purpose: 'resource-download',
          resourceId: normalizedSeedResourceId,
          tabId,
        })
        if (seedGrant?.resource.url === resourceUrl) {
          resourceId = normalizedSeedResourceId
        }
      }
      if (resourceId && captureRuntime) {
        const range = new Headers(init?.headers).get('range') || undefined
        const accessResult = await captureRuntime.access.fetch({
          purpose: 'resource-download',
          range,
          resourceId,
          signal: init?.signal || undefined,
          tabId,
        })
        return accessResult.response
      }
      const fallbackHeaders = new Headers()
      const rendererHeaders = new Headers(init?.headers)
      for (const headerName of ['accept', 'range']) {
        const headerValue = rendererHeaders.get(headerName)
        if (headerValue) {
          fallbackHeaders.set(headerName, headerValue)
        }
      }
      return browserSession.fetch(input, {
        ...init,
        headers: fallbackHeaders,
      })
    }
  }

  function getEmbeddedBrowserTitle(view: WebContentsView) {
    const runtimeTitle = view.webContents.getTitle().trim()
    if (runtimeTitle) {
      return runtimeTitle
    }
    return undefined
  }

  function emitEmbeddedBrowserTabState(
    tabId: string,
    view: WebContentsView,
    payload: Omit<EmbeddedBrowserStatePayload, 'tabId' | 'title' | 'url'> & {
      iconSourceUrl?: string
      iconUrl?: string
      title?: string
      url?: string
    },
  ) {
    emitEmbeddedBrowserState({
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      iconSourceUrl: payload.iconSourceUrl ?? embeddedBrowserIconSourceUrls.get(tabId),
      iconUrl: payload.iconUrl ?? embeddedBrowserIconUrls.get(tabId),
      tabId,
      title: payload.title ?? getEmbeddedBrowserTitle(view),
      ...payload,
    })
  }

  function emitEmbeddedBrowserTabSnapshot(
    tabId: string,
    view: WebContentsView,
    payload?: Omit<EmbeddedBrowserStatePayload, 'tabId' | 'title' | 'url'> & {
      iconSourceUrl?: string
      iconUrl?: string
      title?: string
      url?: string
    },
  ) {
    emitEmbeddedBrowserTabState(tabId, view, {
      state: 'ready',
      url: payload?.url ?? (embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined),
      ...payload,
    })
  }

  function getEmbeddedBrowserView(tabId: string) {
    const view = embeddedBrowserViews.get(tabId)
    if (!view || view.webContents.isDestroyed()) {
      embeddedBrowserViews.delete(tabId)
      embeddedBrowserLastCommittedUrls.delete(tabId)
      embeddedBrowserIconUrls.delete(tabId)
      embeddedBrowserIconSourceUrls.delete(tabId)
      if (view) captureRuntime?.disposeWebContents(view.webContents.id)
      return null
    }
    return view
  }

  function handleActiveViewInputShortcut(input: Electron.Input) {
    if (!activeEmbeddedBrowserTabId) {
      return false
    }
    const view = getEmbeddedBrowserView(activeEmbeddedBrowserTabId)
    if (!view) {
      activeEmbeddedBrowserTabId = null
      return false
    }
    return handleEmbeddedBrowserInputShortcut(view.webContents, input)
  }

  function toggleActiveViewDevTools() {
    if (!activeEmbeddedBrowserTabId) {
      return false
    }
    const view = getEmbeddedBrowserView(activeEmbeddedBrowserTabId)
    if (!view) {
      activeEmbeddedBrowserTabId = null
      return false
    }
    toggleEmbeddedBrowserDevTools(view.webContents)
    return true
  }

  async function tryInstallEmbeddedBrowserResourceProbe(tabId: string, view: WebContentsView) {
    const current = captureRuntime?.bindProbeDocument(tabId) || null
    const next = captureRuntime?.prepareNextProbeDocument(tabId) || null
    return installEmbeddedBrowserResourceProbe(
      tabId,
      view,
      current && next ? { current, next } : null,
    )
  }

  function getEmbeddedBrowserCaptureSnapshot(tabId: string): ResourceStateSnapshot | null {
    return captureRuntime?.getSnapshot(String(tabId || '').trim()) || null
  }

  function setEmbeddedBrowserCaptureMode(
    tabId: string,
    mode: 'deep' | 'network' | 'off',
  ): ResourceStateSnapshot | null {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId || !captureRuntime?.setCaptureMode(normalizedTabId, mode)) {
      return getEmbeddedBrowserCaptureSnapshot(normalizedTabId)
    }
    return getEmbeddedBrowserCaptureSnapshot(normalizedTabId)
  }

  function clearEmbeddedBrowserCaptureResources(tabId: string): ResourceStateSnapshot | null {
    const normalizedTabId = String(tabId || '').trim()
    captureRuntime?.clearResources(normalizedTabId)
    return getEmbeddedBrowserCaptureSnapshot(normalizedTabId)
  }

  async function inspectEmbeddedBrowserCapturedResource(
    tabId: string,
    resourceId: string,
    encoding: 'base64' | 'utf8',
  ) {
    if (!captureRuntime) {
      throw new Error('资源捕捉尚未初始化')
    }
    return captureRuntime.inspection.inspect({
      encoding,
      resourceId,
      tabId,
    })
  }

  async function withEmbeddedBrowserResourceScriptExecutor<Result>(
    tabId: string,
    runner: (executeScript: (script: string) => Promise<unknown>, view: WebContentsView) => Promise<Result>,
  ) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return null
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return null
    }
    const executeScript = (script: string) => view.webContents.executeJavaScript(script, true)
    return runner(executeScript, view)
  }

  async function withEmbeddedBrowserView<Result>(
    tabId: string,
    runner: (view: WebContentsView) => Promise<Result>,
  ) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return null
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return null
    }
    return runner(view)
  }

  function getEmbeddedBrowserFrameList(view: WebContentsView): WebFrameMain[] {
    const mainFrame = view.webContents.mainFrame
    if (!mainFrame) {
      return []
    }
    return [mainFrame, ...mainFrame.framesInSubtree.filter((frame) => frame !== mainFrame)]
  }

  function mergeCatchToolkitStatePayloads(
    states: EmbeddedBrowserCatchToolkitStatePayload[],
  ): EmbeddedBrowserCatchToolkitStatePayload | null {
    const firstState = states[0]
    if (!firstState) {
      return null
    }
    const chooseLargestTrack = (
      key: 'audioResourceKey' | 'primaryResourceKey' | 'videoResourceKey',
      sizeKey: 'audioSizeBytes' | 'capturedMediaSizeBytes' | 'videoSizeBytes',
    ) => states
      .filter((state) => state[key])
      .sort((left, right) => Math.max(0, Number(right[sizeKey] || 0)) - Math.max(0, Number(left[sizeKey] || 0)))[0]

    const audioState = chooseLargestTrack('audioResourceKey', 'audioSizeBytes')
    const primaryState = chooseLargestTrack('primaryResourceKey', 'capturedMediaSizeBytes')
    const videoState = chooseLargestTrack('videoResourceKey', 'videoSizeBytes')
    const diagnosticStates = states.map((state) => state.diagnostics)
    const installedAtValues = diagnosticStates
      .map((diagnostics) => diagnostics.installedAt)
      .filter((value) => value > 0)
    return {
      audioResourceKey: audioState?.audioResourceKey || '',
      audioSizeBytes: states.reduce((totalBytes, state) => totalBytes + Math.max(0, Number(state.audioSizeBytes || 0)), 0),
      autoSeekToBufferedEnd: firstState.autoSeekToBufferedEnd,
      autoDownloadOnComplete: firstState.autoDownloadOnComplete,
      capturedMediaSizeBytes: states.reduce((totalBytes, state) => {
        return totalBytes + Math.max(0, Number(state.capturedMediaSizeBytes || 0))
      }, 0),
      clearCacheOnComplete: firstState.clearCacheOnComplete,
      currentFileName: states.map((state) => state.currentFileName).find(Boolean) || '',
      diagnostics: {
        appendBufferCount: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.appendBufferCount || 0)), 0),
        frameCount: states.length,
        frameUrl: diagnosticStates.map((diagnostics) => diagnostics.frameUrl).find(Boolean) || '',
        hookErrors: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.hookErrors || 0)), 0),
        installedAt: installedAtValues.length ? Math.min(...installedAtValues) : 0,
        lastAppendAt: Math.max(...diagnosticStates.map((diagnostics) => diagnostics.lastAppendAt || 0)),
        lastError: diagnosticStates.map((diagnostics) => diagnostics.lastError).find(Boolean) || '',
        mediaSourceAvailable: diagnosticStates.some((diagnostics) => diagnostics.mediaSourceAvailable),
        mediaSourceHooked: diagnosticStates.some((diagnostics) => diagnostics.mediaSourceHooked),
        sourceBufferCount: diagnosticStates.reduce((totalCount, diagnostics) => totalCount + Math.max(0, Number(diagnostics.sourceBufferCount || 0)), 0),
      },
      isCaptureComplete: states.some((state) => state.isCaptureComplete),
      manualFileName: firstState.manualFileName,
      primaryResourceKey: primaryState?.primaryResourceKey || '',
      regexWarning: states.map((state) => state.regexWarning).find(Boolean) || '',
      regexRule: firstState.regexRule,
      restartAlwaysFromBeginning: firstState.restartAlwaysFromBeginning,
      selectorWarning: states.map((state) => state.selectorWarning).find(Boolean) || '',
      selectorRule: firstState.selectorRule,
      streamCount: states.reduce((totalCount, state) => totalCount + Math.max(0, Number(state.streamCount || 0)), 0),
      trimExtraMediaHeaders: firstState.trimExtraMediaHeaders,
      videoResourceKey: videoState?.videoResourceKey || '',
      videoSizeBytes: states.reduce((totalBytes, state) => totalBytes + Math.max(0, Number(state.videoSizeBytes || 0)), 0),
    }
  }

  async function createMissingCatchToolkitProbeState(
    view: WebContentsView,
  ): Promise<EmbeddedBrowserCatchToolkitStatePayload> {
    const frames = getEmbeddedBrowserFrameList(view)
    const diagnostics = await Promise.all(frames.map(async (frame) => {
      try {
        return await frame.executeJavaScript(`
          (() => ({
            frameUrl: String(location.href || ''),
            installError: globalThis[${JSON.stringify(EMBEDDED_BROWSER_RESOURCE_INSTALL_ERROR_KEY)}] || null,
            mediaSourceAvailable: typeof MediaSource !== 'undefined',
          }))()
        `, true) as { frameUrl?: string; installError?: unknown; mediaSourceAvailable?: boolean }
      } catch {
        return null
      }
    }))
    const validDiagnostics = diagnostics.filter((item): item is { frameUrl?: string; installError?: unknown; mediaSourceAvailable?: boolean } => Boolean(item))
    const installError = validDiagnostics
      .map((item) => item.installError)
      .find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined
    const installErrorMessage = installError
      ? [
          installError.name ? String(installError.name) : '',
          installError.message ? String(installError.message) : '',
        ].filter(Boolean).join(': ') || 'probe 安装失败'
      : 'probe 未安装或读取不到'
    return {
      audioResourceKey: '',
      audioSizeBytes: 0,
      autoSeekToBufferedEnd: false,
      autoDownloadOnComplete: false,
      capturedMediaSizeBytes: 0,
      clearCacheOnComplete: false,
      currentFileName: '',
      diagnostics: {
        appendBufferCount: 0,
        frameCount: frames.length,
        frameUrl: validDiagnostics.map((item) => item.frameUrl).find(Boolean) || '',
        hookErrors: 0,
        installedAt: 0,
        lastAppendAt: 0,
        lastError: installErrorMessage,
        mediaSourceAvailable: validDiagnostics.some((item) => item.mediaSourceAvailable),
        mediaSourceHooked: false,
        sourceBufferCount: 0,
      },
      isCaptureComplete: false,
      manualFileName: '',
      primaryResourceKey: '',
      regexWarning: '',
      regexRule: '',
      restartAlwaysFromBeginning: false,
      selectorWarning: '',
      selectorRule: '',
      streamCount: 0,
      trimExtraMediaHeaders: true,
      videoResourceKey: '',
      videoSizeBytes: 0,
    }
  }

  async function extractEmbeddedBrowserMseResourceFromFrames(
    tabId: string,
    view: WebContentsView,
    resourceKey: string,
  ): Promise<EmbeddedBrowserExtractedResourceFile | null> {
    const spoolKey = buildEmbeddedBrowserMseSpoolKey(tabId, resourceKey)
    const currentSpoolFile = embeddedBrowserMseSpoolFiles.get(spoolKey)
    if (currentSpoolFile) {
      await waitForEmbeddedBrowserMseSpoolWrites(tabId, resourceKey)
    }
    const frames = getEmbeddedBrowserFrameList(view)
    const drainFromExecutor = async (
      executeScript: (script: string) => Promise<unknown>,
    ) => drainEmbeddedBrowserMseResourceFromPage(executeScript, resourceKey)

    const drained = !frames.length
      ? await drainFromExecutor((script) => view.webContents.executeJavaScript(script, true))
      : await (async () => {
          for (const frame of frames) {
            try {
              const resource = await drainFromExecutor((script) => frame.executeJavaScript(script, true))
              if (resource) {
                return resource
              }
            } catch {
              // Ignore frames that navigated or do not contain the probe.
            }
          }
          return null
        })()

    if (!currentSpoolFile) {
      if (!drained?.base64) {
        return null
      }
      return {
        base64: drained.base64,
        fileName: drained.fileName,
        mimeType: drained.mimeType,
        resourceKey,
        streamType: drained.streamType,
      }
    }

    if (drained?.base64) {
      await appendEmbeddedBrowserMseSpoolChunk(tabId, {
        base64: drained.base64,
        fileName: drained.fileName,
        mimeType: drained.mimeType,
        resourceKey,
        streamType: drained.streamType,
      })
    }

    await waitForEmbeddedBrowserMseSpoolWrites(tabId, resourceKey)
    const nextSpoolFile = embeddedBrowserMseSpoolFiles.get(spoolKey) || currentSpoolFile
    return {
      fileName: drained?.fileName || nextSpoolFile.fileName,
      filePath: nextSpoolFile.filePath,
      mimeType: drained?.mimeType || nextSpoolFile.mimeType,
      resourceKey,
      streamType: drained?.streamType || nextSpoolFile.streamType,
    }
  }

  async function extractEmbeddedBrowserResourceFromFrames(
    tabId: string,
    view: WebContentsView,
    resourceKey: string,
  ) {
    if (String(resourceKey || '').startsWith('mse-stream:')) {
      const mseResource = await extractEmbeddedBrowserMseResourceFromFrames(tabId, view, resourceKey)
      if (mseResource) {
        return mseResource
      }
    }
    const frames = getEmbeddedBrowserFrameList(view)
    if (!frames.length) {
      return extractEmbeddedBrowserResourceFromPage(
        (script) => view.webContents.executeJavaScript(script, true),
        resourceKey,
      )
    }
    for (const frame of frames) {
      try {
        const resource = await extractEmbeddedBrowserResourceFromPage(
          (script) => frame.executeJavaScript(script, true),
          resourceKey,
        )
        if (resource) {
          return resource
        }
      } catch {
        // Ignore frames that navigated or do not contain the probe.
      }
    }
    return null
  }

  function sanitizeEmbeddedBrowserOutputFileName(input: string) {
    return String(input || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      || 'download'
  }

  async function deriveEmbeddedBrowserPreferredOutputPath(
    directoryPath: string,
    fileName: string,
  ) {
    const normalizedDirectory = path.resolve(String(directoryPath || '').trim())
    if (!normalizedDirectory) {
      throw new Error('无效的输出目录')
    }
    await mkdir(normalizedDirectory, { recursive: true })
    const parsedName = path.parse(sanitizeEmbeddedBrowserOutputFileName(fileName))
    const extension = parsedName.ext || ''
    const baseName = parsedName.name || parsedName.base || 'download'

    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const suffix = attempt === 0 ? '' : ` (${attempt})`
      const candidatePath = path.join(normalizedDirectory, `${baseName}${suffix}${extension}`)
      const exists = await access(candidatePath)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        return candidatePath
      }
    }
    return path.join(normalizedDirectory, `${baseName}-${Date.now()}${extension}`)
  }

  async function resolveEmbeddedBrowserOutputPath(payload: {
    defaultFileName: string
    filters?: Array<{ extensions: string[]; name: string }>
    outputDirectoryPath?: string
    useSystemSaveDialog?: boolean
  }): Promise<string | null> {
    const defaultFileName = sanitizeEmbeddedBrowserOutputFileName(payload.defaultFileName)
    const preferredDirectory = String(payload.outputDirectoryPath || '').trim()
    const shouldUseSystemSaveDialog = payload.useSystemSaveDialog !== false && !preferredDirectory

    if (!shouldUseSystemSaveDialog) {
      const targetDirectory = preferredDirectory || app.getPath('downloads')
      return deriveEmbeddedBrowserPreferredOutputPath(targetDirectory, defaultFileName)
    }

    const mainWindow = options.getMainWindow()
    const targetWindow = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : undefined
    const saveDialogOptions = {
      defaultPath: path.join(app.getPath('downloads'), defaultFileName),
      filters: payload.filters,
      showsTagField: false,
    }
    const saveResult = targetWindow
      ? await dialog.showSaveDialog(targetWindow, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions)
    if (saveResult.canceled || !saveResult.filePath) {
      return null
    }
    return saveResult.filePath
  }

  function deriveEmbeddedBrowserDirectFileName(url: string, fallbackName: string) {
    try {
      const fileName = decodeURIComponent(path.basename(new URL(url).pathname)).trim()
      if (fileName) {
        return sanitizeEmbeddedBrowserOutputFileName(fileName)
      }
    } catch {
      // Fall through to fallback.
    }
    return sanitizeEmbeddedBrowserOutputFileName(fallbackName)
  }

  async function downloadEmbeddedBrowserDirectFile(
    _tabId: string,
    payload: EmbeddedBrowserDirectFileDownloadPayload,
  ): Promise<EmbeddedBrowserDirectFileDownloadResponse> {
    const resourceUrl = String(payload.url || '').trim()
    if (!/^https?:\/\//i.test(resourceUrl)) {
      return {
        error: '缺少可下载的字幕或文件链接',
        ok: false,
      }
    }

    try {
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: deriveEmbeddedBrowserDirectFileName(resourceUrl, String(payload.suggestedFileName || '').trim() || 'resource.txt'),
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      const response = await fetch(resourceUrl, {
        headers: payload.headers,
      })
      if (!response.ok) {
        throw new Error(`下载失败：HTTP ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      await writeFile(outputPath, buffer)
      return {
        ok: true,
        outputPath,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function downloadEmbeddedBrowserCapturedResource(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceDownloadPayload,
  ): Promise<EmbeddedBrowserDirectFileDownloadResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim()
    if (!normalizedTabId || !resourceId || !captureRuntime) {
      return { error: '缺少可下载的捕捉资源', ok: false }
    }
    try {
      const accessResult = await captureRuntime.access.fetch({
        purpose: 'resource-download',
        resourceId,
        tabId: normalizedTabId,
      })
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: deriveEmbeddedBrowserDirectFileName(
          accessResult.resource.url,
          String(payload.suggestedFileName || '').trim() || 'resource',
        ),
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        await accessResult.response.body?.cancel().catch(() => undefined)
        return { cancelled: true, ok: false }
      }
      if (!accessResult.response.ok) {
        await accessResult.response.body?.cancel().catch(() => undefined)
        throw new Error(`下载失败：HTTP ${accessResult.response.status}`)
      }
      await writeFile(outputPath, Buffer.from(await accessResult.response.arrayBuffer()))
      return { ok: true, outputPath }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function mergeEmbeddedBrowserCapturedMseResources(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceMergePayload,
  ): Promise<EmbeddedBrowserCapturedResourceMergeResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const audioResourceId = String(payload.audioResourceId || '').trim()
    const videoResourceId = String(payload.videoResourceId || '').trim()
    const audioResourceKey = captureRuntime?.resolvePageResourceKey(normalizedTabId, audioResourceId) || ''
    const videoResourceKey = captureRuntime?.resolvePageResourceKey(normalizedTabId, videoResourceId) || ''
    if (
      !normalizedTabId
      || !audioResourceKey
      || !videoResourceKey
    ) {
      return {
        error: '缺少要合并的音频或视频资源',
        ok: false,
      }
    }

    try {
      const extractedResources = await withEmbeddedBrowserView(
        normalizedTabId,
        async (view) => Promise.all([
          extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, audioResourceKey),
          extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, videoResourceKey),
        ]),
      )
      const audioResource = extractedResources?.[0] || null
      const videoResource = extractedResources?.[1] || null
      if (!audioResource || !videoResource) {
        return {
          error: '当前音频或视频资源还没有整理完成，先继续播放几秒再试试',
          ok: false,
        }
      }

      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserMergedFileName(videoResource.fileName, audioResource.fileName)
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      const mergeResult = await mergeEmbeddedBrowserResourceTracks({
        audio: audioResource,
        ffmpegPath: payload.ffmpegPath,
        outputPath,
        video: videoResource,
      })
      return {
        ffmpegPath: mergeResult.ffmpegPath,
        ok: true,
        outputPath: mergeResult.outputPath,
      }
    } catch (error) {
      runtimeLogger.warn('embedded browser resource merge failed', {
        audioResourceId,
        error: error instanceof Error ? error.message : String(error),
        tabId: normalizedTabId,
        videoResourceId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function saveEmbeddedBrowserCapturedResourceForRenderer(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceSavePayload,
  ): Promise<EmbeddedBrowserCapturedResourceSaveResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim()
    const resourceKey = captureRuntime?.resolvePageResourceKey(normalizedTabId, resourceId) || ''
    if (!normalizedTabId || !resourceKey) {
      return {
        error: '缺少要保存的捕捉资源',
        ok: false,
      }
    }

    try {
      const resource = await withEmbeddedBrowserView(
        normalizedTabId,
        async (view) => extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, resourceKey),
      )
      if (!resource) {
        return {
          error: '当前捕捉资源还没有整理完成，先继续播放几秒再试试',
          ok: false,
        }
      }

      const defaultFileName = deriveEmbeddedBrowserExtractedResourceOutputFileName(
        resource.fileName,
        payload.suggestedFileName,
      )
      const mainWindow = options.getMainWindow()
      const targetWindow = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined
      const saveDialogOptions = {
        defaultPath: path.join(app.getPath('downloads'), defaultFileName),
        showsTagField: false,
      }
      const saveResult = targetWindow
        ? await dialog.showSaveDialog(targetWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions)
      if (saveResult.canceled || !saveResult.filePath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      const outputPath = await saveEmbeddedBrowserExtractedResourceFile(resource, saveResult.filePath)
      return {
        ok: true,
        outputPath,
      }
    } catch (error) {
      runtimeLogger.warn('embedded browser resource save failed', {
        error: error instanceof Error ? error.message : String(error),
        resourceId,
        tabId: normalizedTabId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  function deriveTranscodedFileName(fileName: string, outputFormat: string) {
    const parsedName = path.parse(String(fileName || '').trim() || 'media')
    const baseName = parsedName.name || parsedName.base || 'media'
    return `${baseName}.${outputFormat}`
  }

  async function transcodeEmbeddedBrowserCapturedResourceForRenderer(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceTranscodePayload,
  ): Promise<EmbeddedBrowserCapturedResourceTranscodeResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim()
    const resourceKey = captureRuntime?.resolvePageResourceKey(normalizedTabId, resourceId) || ''
    const outputFormat = normalizeEmbeddedBrowserResourceTranscodeFormat(payload.outputFormat || 'mp4')
    if (!normalizedTabId || !resourceKey) {
      return {
        error: '缺少要转格式的媒体资源',
        ok: false,
      }
    }
    if (!outputFormat) {
      return {
        error: '请输入 1-12 位字母或数字格式，例如 mp3、m4a、mp4',
        ok: false,
      }
    }

    try {
      const resource = await withEmbeddedBrowserView(
        normalizedTabId,
        async (view) => extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, resourceKey),
      )
      if (!resource) {
        return {
          error: '当前媒体资源还没有整理完成，先继续播放几秒再试试',
          ok: false,
        }
      }

      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveTranscodedFileName(resource.fileName, outputFormat)
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: [outputFormat], name: `${outputFormat.toUpperCase()} Media` },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      const result = await transcodeEmbeddedBrowserResource({
        ffmpegPath: payload.ffmpegPath,
        outputFormat,
        outputPath,
        resource,
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      runtimeLogger.warn('embedded browser resource transcode failed', {
        error: error instanceof Error ? error.message : String(error),
        resourceId,
        tabId: normalizedTabId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function downloadEmbeddedBrowserManifestResourceForRenderer(
    tabId: string,
    payload: EmbeddedBrowserHlsDownloadPayload | EmbeddedBrowserMpdDownloadPayload,
    kind: EmbeddedBrowserManifestDownloadKind,
  ): Promise<EmbeddedBrowserHlsDownloadResponse | EmbeddedBrowserMpdDownloadResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim()
    const grant = resourceId && captureRuntime
      ? captureRuntime.access.redeem({ purpose: 'resource-download', resourceId, tabId: normalizedTabId })
      : null
    const manifestUrl = String(grant?.resource.url || payload.manifestUrl || '').trim()
    const requestHeaders = grant ? Object.fromEntries(grant.headers) : payload.headers
    if (resourceId && !grant) {
      return { error: '捕捉资源已过期或不属于当前页面', ok: false }
    }
    if (!normalizedTabId || !manifestUrl) {
      return {
        error: kind === 'hls' ? '缺少要下载的 m3u8 地址' : '缺少要下载的 mpd 地址',
        ok: false,
      }
    }

    try {
      const requestId = String(payload.requestId || '').trim() || undefined
      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, kind)
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      if (kind === 'hls') {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: '开始准备网络 manifest 下载',
          mode: 'direct-manifest',
          requestId,
          stage: 'preparing',
          status: 'running',
          tabId: normalizedTabId,
        })
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: '已交给 ffmpeg 直拉处理',
          mode: 'direct-manifest',
          requestId,
          stage: 'ffmpeg',
          status: 'running',
          tabId: normalizedTabId,
        })
      }

      const executeManifestDownload = (signal?: AbortSignal) => downloadEmbeddedBrowserManifestResource({
        durationSeconds: payload.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        headers: requestHeaders,
        kind,
        manifestUrl,
        onProgress: kind === 'hls'
          ? (progress) => {
              emitEmbeddedBrowserHlsTask({
                durationSeconds: payload.durationSeconds,
                ffmpegSpeedText: progress.speedText,
                manifestUrl,
                mode: 'direct-manifest',
                processedSeconds: progress.processedSeconds,
                requestId,
                stage: 'ffmpeg',
                status: 'running',
                tabId: normalizedTabId,
              })
            }
          : undefined,
        outputPath,
        signal,
      })
      const result = kind === 'hls'
        ? await embeddedBrowserHlsSessionOwner.runActiveTask({
            requestId,
            tabId: normalizedTabId,
          }, executeManifestDownload)
        : await executeManifestDownload()
      if (kind === 'hls') {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          manifestUrl,
          message: 'HLS 下载完成',
          mode: 'direct-manifest',
          outputPath: result.outputPath,
          requestId,
          stage: 'completed',
          status: 'success',
          tabId: normalizedTabId,
        })
      }
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      if (kind === 'hls') {
        emitEmbeddedBrowserHlsTask({
          durationSeconds: payload.durationSeconds,
          error: error instanceof Error ? error.message : String(error),
          manifestUrl,
          message: error instanceof Error ? error.message : String(error),
          mode: 'direct-manifest',
          requestId: String(payload.requestId || '').trim() || undefined,
          stage: 'error',
          status: 'error',
          tabId: normalizedTabId,
        })
      }
      runtimeLogger.warn('embedded browser manifest download failed', {
        error: error instanceof Error ? error.message : String(error),
        kind,
        manifestUrl,
        tabId: normalizedTabId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function downloadEmbeddedBrowserHlsResource(
    tabId: string,
    payload: EmbeddedBrowserHlsDownloadPayload,
  ): Promise<EmbeddedBrowserHlsDownloadResponse> {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, 'hls')
  }

  async function downloadEmbeddedBrowserHlsTracksResource(
    tabId: string,
    payload: EmbeddedBrowserHlsTrackMergePayload,
  ): Promise<EmbeddedBrowserHlsTrackMergeResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const videoManifestUrl = String(payload.videoManifestUrl || '').trim()
    const audioManifestUrl = String(payload.audioManifestUrl || '').trim()
    const requestId = String(payload.requestId || '').trim() || undefined
    if (!normalizedTabId || !/^https?:\/\//i.test(videoManifestUrl) || !/^https?:\/\//i.test(audioManifestUrl)) {
      return {
        error: '缺少可合并的视频或音轨 manifest',
        ok: false,
      }
    }

    let outputPath: string | null = null
    try {
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: String(payload.suggestedFileName || '').trim() || deriveEmbeddedBrowserManifestOutputFileName(videoManifestUrl, 'hls'),
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      const resolvedOutputPath = outputPath

      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        manifestUrl: videoManifestUrl,
        message: '开始下载并合并视频/音轨',
        mode: 'direct-manifest',
        requestId,
        stage: 'preparing',
        status: 'running',
        tabId: normalizedTabId,
      })

      const result = await embeddedBrowserHlsSessionOwner.runActiveTask({
        requestId,
        tabId: normalizedTabId,
      }, (signal) => downloadEmbeddedBrowserManifestTracks({
        audioManifestUrl,
        durationSeconds: payload.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        headers: payload.headers,
        onProgress: payload.durationSeconds
          ? (progress) => {
            emitEmbeddedBrowserHlsTask({
              durationSeconds: payload.durationSeconds,
              ffmpegSpeedText: progress.speedText,
              manifestUrl: videoManifestUrl,
              message: '正在通过 ffmpeg 合并视频和音轨',
              mode: 'direct-manifest',
              processedSeconds: progress.processedSeconds,
              requestId,
              stage: 'ffmpeg',
              status: 'running',
              tabId: normalizedTabId,
            })
          }
          : undefined,
        outputPath: resolvedOutputPath,
        signal,
        videoManifestUrl,
      }))

      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        manifestUrl: videoManifestUrl,
        message: 'HLS 视频/音轨合并完成',
        mode: 'direct-manifest',
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.durationSeconds,
        error: message,
        manifestUrl: videoManifestUrl,
        message,
        mode: 'direct-manifest',
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
      })
      return {
        error: message,
        ok: false,
      }
    }
  }

  async function downloadEmbeddedBrowserHlsPlanResource(
    tabId: string,
    payload: EmbeddedBrowserHlsPlanDownloadPayload,
  ): Promise<EmbeddedBrowserHlsPlanDownloadResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim() || undefined
    await clearEmbeddedBrowserHlsRetrySessions({ tabId: normalizedTabId })
    if (!normalizedTabId || !payload.plan || !Array.isArray(payload.plan.fragments) || payload.plan.fragments.length === 0) {
      return {
        error: '缺少可下载的 HLS 计划',
        ok: false,
      }
    }
    if (
      resourceId
      && /^https?:\/\//i.test(String(payload.plan.manifestUrl || ''))
      && (!captureRuntime || !captureRuntime.access.redeem({
        purpose: 'resource-download',
        resourceId,
        tabId: normalizedTabId,
      }))
    ) {
      return {
        error: 'HLS 捕捉资源已过期或不属于当前页面',
        ok: false,
      }
    }

    let latestFailedFragments: number[] | undefined
    let outputPath: string | null = null
    let retainRetrySession = false
    let workDirectoryPath = ''
    let activeTask: {
      complete: () => void
      signal: AbortSignal
    } | undefined
    const requestId = String(payload.requestId || '').trim() || undefined
    try {
      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(payload.plan.manifestUrl, 'hls')
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      activeTask = embeddedBrowserHlsSessionOwner.beginActiveTask({
        requestId,
        tabId: normalizedTabId,
      })

      emitEmbeddedBrowserHlsTask({
        manifestUrl: payload.plan.manifestUrl,
        message: '开始准备本地 HLS 下载任务',
        mode: 'local-plan',
        requestId,
        stage: 'preparing',
        status: 'running',
        tabId: normalizedTabId,
        durationSeconds: payload.plan.durationSeconds,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })

      workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-download-'))
      const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, resourceId),
        preprocessFragments: true,
        onEvent: (event) => {
          if (event.failedFragments?.length) {
            latestFailedFragments = event.failedFragments
          }
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: payload.plan.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl: payload.plan.manifestUrl,
            message: event.message,
            mode: 'local-plan',
            processedSeconds: undefined,
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments || payload.plan.fragmentCount,
            usingManualKey: Boolean(payload.manualKeyBase64),
          })
        },
        manualKeyBase64: payload.manualKeyBase64,
        plan: {
          fragments: payload.plan.fragments,
          headers: payload.plan.headers,
          manifestUrl: payload.plan.manifestUrl,
          suggestedThreadCount: payload.plan.suggestedThreadCount,
        },
        signal: activeTask.signal,
        workDirectoryPath,
      })
      workDirectoryPath = localDownloadResult.workDirectoryPath
      latestFailedFragments = undefined

      emitEmbeddedBrowserHlsTask({
        completedFragments: payload.plan.fragmentCount,
        durationSeconds: payload.plan.durationSeconds,
        manifestUrl: payload.plan.manifestUrl,
        message: '本地 playlist 已生成，开始交给 ffmpeg',
        mode: 'local-plan',
        requestId,
        stage: 'ffmpeg',
        status: 'running',
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })

      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: payload.plan.durationSeconds,
        ffmpegPath: payload.ffmpegPath,
        kind: 'hls',
        manifestUrl: localDownloadResult.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: payload.plan.fragmentCount,
            durationSeconds: payload.plan.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: payload.plan.manifestUrl,
            mode: 'local-plan',
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: 'ffmpeg',
            status: 'running',
            tabId: normalizedTabId,
            totalFragments: payload.plan.fragmentCount,
            usingManualKey: Boolean(payload.manualKeyBase64),
          })
        },
        outputPath,
        signal: activeTask.signal,
      })
      emitEmbeddedBrowserHlsTask({
        completedFragments: payload.plan.fragmentCount,
        durationSeconds: payload.plan.durationSeconds,
        manifestUrl: payload.plan.manifestUrl,
        message: 'HLS 下载完成',
        mode: 'local-plan',
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      const wasAborted = activeTask?.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      if (!wasAborted && requestId && workDirectoryPath && outputPath && latestFailedFragments?.length) {
        embeddedBrowserHlsSessionOwner.upsertRetry({
          failedFragments: latestFailedFragments,
          ffmpegPath: payload.ffmpegPath,
          manualKeyBase64: payload.manualKeyBase64,
          outputPath,
          plan: payload.plan,
          resourceId,
          requestId,
          tabId: normalizedTabId,
          workDirectoryPath,
        })
        retainRetrySession = true
      } else if (requestId) {
        embeddedBrowserHlsSessionOwner.takeRetry(requestId, normalizedTabId)
      }
      emitEmbeddedBrowserHlsTask({
        durationSeconds: payload.plan.durationSeconds,
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: payload.plan.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: 'local-plan',
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
        totalFragments: payload.plan.fragmentCount,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })
      runtimeLogger.warn('embedded browser hls plan download failed', {
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: payload.plan.manifestUrl,
        tabId: normalizedTabId,
      })
      if (wasAborted) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    } finally {
      if (workDirectoryPath && !retainRetrySession) {
        await rm(workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      }
      activeTask?.complete()
    }
  }

  async function startEmbeddedBrowserHlsRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserHlsRecordingStartPayload,
  ): Promise<EmbeddedBrowserHlsRecordingStartResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestedManifestUrl = String(payload.manifestUrl || '').trim()
    const requestedResourceId = String(payload.resourceId || '').trim() || undefined
    const requestId = String(payload.requestId || '').trim() || undefined
    if (!normalizedTabId || !requestId || !/^https?:\/\//i.test(requestedManifestUrl)) {
      return {
        error: '缺少可录制的直播 manifest',
        ok: false,
      }
    }

    const exactResourceId = captureRuntime?.resolveResourceIdByUrl(normalizedTabId, requestedManifestUrl)
    const authorityResourceId = exactResourceId || requestedResourceId
    const authorityGrant = authorityResourceId && captureRuntime
      ? captureRuntime.access.redeem({
          purpose: 'resource-download',
          resourceId: authorityResourceId,
          tabId: normalizedTabId,
        })
      : null
    if (requestedResourceId && !authorityGrant && !exactResourceId) {
      return {
        error: 'HLS 直播捕捉资源已过期或不属于当前页面',
        ok: false,
      }
    }
    const manifestUrl = authorityGrant?.resource.url === requestedManifestUrl
      ? authorityGrant.resource.url
      : requestedManifestUrl
    const manifestHeaders = authorityGrant?.resource.url === manifestUrl
      ? Object.fromEntries(authorityGrant.headers)
      : {}

    const existingSession = embeddedBrowserHlsSessionOwner.findLiveByTab(normalizedTabId)
    if (existingSession) {
      return {
        error: '当前 tab 仍有未完成的直播录制，请先停止录制或重试导出',
        ok: false,
      }
    }

    let outputPath: string | null = null
    try {
      const suggestedFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, 'hls')
      outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: suggestedFileName,
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      emitEmbeddedBrowserHlsTask({
        manifestUrl,
        message: '开始准备直播录制任务',
        mode: 'local-plan',
        requestId,
        stage: 'preparing',
        status: 'running',
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })

      const recorder = new EmbeddedBrowserHlsLiveRecorder({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, authorityResourceId),
        headers: manifestHeaders,
        manifestUrl,
        manualKeyBase64: payload.manualKeyBase64,
        onEvent: (event) => {
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: event.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl,
            message: event.message,
            mode: 'local-plan',
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments,
            usingManualKey: Boolean(payload.manualKeyBase64),
          })
        },
        pageUrl: payload.pageUrl,
        suggestedThreadCount: payload.suggestedThreadCount,
      })

      embeddedBrowserHlsSessionOwner.upsertLive({
        ffmpegPath: payload.ffmpegPath,
        manifestUrl,
        outputPath,
        recorder,
        requestId,
        tabId: normalizedTabId,
      })
      await recorder.start()
      embeddedBrowserHlsSessionOwner.upsertLive({
        ffmpegPath: payload.ffmpegPath,
        manifestUrl,
        outputPath,
        recorder,
        requestId,
        tabId: normalizedTabId,
        workDirectoryPath: recorder.getCurrentWorkDirectoryPath(),
      })
      emitEmbeddedBrowserHlsTask({
        manifestUrl,
        message: '直播录制已开始，继续等待你手动停止',
        mode: 'local-plan',
        requestId,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })
      return {
        ok: true,
        requestId,
      }
    } catch (error) {
      await clearEmbeddedBrowserHlsLiveRecordingSessions({ requestId, tabId: normalizedTabId })
      emitEmbeddedBrowserHlsTask({
        error: error instanceof Error ? error.message : String(error),
        manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: 'local-plan',
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
        usingManualKey: Boolean(payload.manualKeyBase64),
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  async function stopEmbeddedBrowserHlsRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserHlsRecordingStopPayload,
  ): Promise<EmbeddedBrowserHlsRecordingStopResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    if (!normalizedTabId || !requestId) {
      return {
        error: '缺少可停止的直播录制任务',
        ok: false,
      }
    }
    const session = embeddedBrowserHlsSessionOwner.getLive(requestId, normalizedTabId)
    if (!session) {
      return {
        error: '直播录制任务不存在或已结束',
        ok: false,
      }
    }

    let stopResult: Awaited<ReturnType<EmbeddedBrowserHlsLiveRecorder['stop']>> | null = null
    let activeTask: {
      complete: () => void
      signal: AbortSignal
    } | undefined
    try {
      activeTask = embeddedBrowserHlsSessionOwner.beginActiveTask({
        requestId,
        tabId: normalizedTabId,
      })
      emitEmbeddedBrowserHlsTask({
        manifestUrl: session.manifestUrl,
        message: '正在停止直播录制并整理本地 playlist',
        mode: 'local-plan',
        requestId,
        stage: 'rewriting-playlist',
        status: 'running',
        tabId: normalizedTabId,
      })
      stopResult = await session.recorder.stop()
      const completedRecording = stopResult
      session.workDirectoryPath = completedRecording.workDirectoryPath
      emitEmbeddedBrowserHlsTask({
        completedFragments: completedRecording.totalFragments,
        durationSeconds: completedRecording.durationSeconds,
        manifestUrl: session.manifestUrl,
        message: '直播录制已停止，开始交给 ffmpeg',
        mode: 'local-plan',
        requestId,
        stage: 'ffmpeg',
        status: 'running',
        tabId: normalizedTabId,
        totalFragments: completedRecording.totalFragments,
      })

      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: completedRecording.durationSeconds,
        ffmpegPath: session.ffmpegPath,
        kind: 'hls',
        manifestUrl: completedRecording.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: completedRecording.totalFragments,
            durationSeconds: completedRecording.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: session.manifestUrl,
            mode: 'local-plan',
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: 'ffmpeg',
            status: 'running',
            tabId: normalizedTabId,
            totalFragments: completedRecording.totalFragments,
          })
        },
        outputPath: session.outputPath,
        signal: activeTask.signal,
      })
      emitEmbeddedBrowserHlsTask({
        completedFragments: completedRecording.totalFragments,
        durationSeconds: completedRecording.durationSeconds,
        manifestUrl: session.manifestUrl,
        message: '直播录制文件已完成',
        mode: 'local-plan',
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
        totalFragments: completedRecording.totalFragments,
      })
      embeddedBrowserHlsSessionOwner.takeLive(requestId, normalizedTabId)
      await rm(completedRecording.workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      const wasAborted = activeTask?.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      emitEmbeddedBrowserHlsTask({
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: session.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: 'local-plan',
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
      })
      if (!stopResult) {
        await clearEmbeddedBrowserHlsLiveRecordingSessions({ requestId, tabId: normalizedTabId })
      }
      if (wasAborted) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    } finally {
      activeTask?.complete()
    }
  }

  async function discardEmbeddedBrowserHlsRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserHlsRecordingDiscardPayload,
  ): Promise<EmbeddedBrowserHlsRecordingDiscardResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    if (!normalizedTabId || !requestId) {
      return {
        error: '缺少可清理的直播录制任务',
        ok: false,
      }
    }

    const session = embeddedBrowserHlsSessionOwner.getLive(requestId, normalizedTabId)
    if (!session) {
      return {
        ok: true,
      }
    }

    await clearEmbeddedBrowserHlsSessions({ requestId, tabId: normalizedTabId })
    return {
      ok: true,
    }
  }

  async function retryEmbeddedBrowserHlsPlanFailedFragments(
    tabId: string,
    payload: EmbeddedBrowserHlsPlanRetryPayload,
  ): Promise<EmbeddedBrowserHlsPlanRetryResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    if (!normalizedTabId || !requestId) {
      return {
        error: '缺少可重试的 HLS 任务',
        ok: false,
      }
    }

    const session = embeddedBrowserHlsSessionOwner.getRetry(requestId, normalizedTabId)
    if (!session) {
      return {
        error: '这条 HLS 失败任务已经过期，请重新执行一次完整下载',
        ok: false,
      }
    }

    let latestFailedFragments: number[] | undefined = session.failedFragments
    let retainRetrySession = false
    let activeTask: {
      complete: () => void
      signal: AbortSignal
    } | undefined
    try {
      activeTask = embeddedBrowserHlsSessionOwner.beginActiveTask({
        requestId,
        tabId: normalizedTabId,
      })
      emitEmbeddedBrowserHlsTask({
        completedFragments: Math.max(0, session.plan.fragmentCount - session.failedFragments.length),
        durationSeconds: session.plan.durationSeconds,
        failedFragments: session.failedFragments,
        manifestUrl: session.plan.manifestUrl,
        message: `开始重试 ${session.failedFragments.length} 个失败分片`,
        mode: 'local-plan',
        requestId,
        stage: 'downloading-fragments',
        status: 'running',
        tabId: normalizedTabId,
        totalFragments: session.plan.fragmentCount,
        usingManualKey: Boolean(session.manualKeyBase64),
      })

      const localDownloadResult = await downloadEmbeddedBrowserHlsToLocalWorkDirectory({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, session.resourceId),
        fragmentIndexes: session.failedFragments.map((value) => value - 1).filter((value) => value >= 0),
        manualKeyBase64: session.manualKeyBase64,
        preprocessFragments: true,
        onEvent: (event) => {
          if (event.failedFragments?.length) {
            latestFailedFragments = event.failedFragments
          }
          emitEmbeddedBrowserHlsTask({
            bytesReceived: event.bytesReceived,
            bytesTotal: event.bytesTotal,
            completedFragments: event.completedFragments,
            durationSeconds: session.plan.durationSeconds,
            error: event.error,
            etaSeconds: event.etaSeconds,
            failedFragments: event.failedFragments,
            manifestUrl: session.plan.manifestUrl,
            message: event.message,
            mode: 'local-plan',
            processedSeconds: undefined,
            requestId,
            speedBps: event.speedBps,
            stage: event.stage,
            status: event.status,
            tabId: normalizedTabId,
            totalFragments: event.totalFragments || session.plan.fragmentCount,
            usingManualKey: Boolean(session.manualKeyBase64),
          })
        },
        plan: {
          fragments: session.plan.fragments,
          headers: session.plan.headers,
          manifestUrl: session.plan.manifestUrl,
          suggestedThreadCount: session.plan.suggestedThreadCount,
        },
        signal: activeTask.signal,
        workDirectoryPath: session.workDirectoryPath,
      })
      latestFailedFragments = undefined

      emitEmbeddedBrowserHlsTask({
        completedFragments: session.plan.fragmentCount,
        durationSeconds: session.plan.durationSeconds,
        manifestUrl: session.plan.manifestUrl,
        message: '失败分片已补齐，开始交给 ffmpeg',
        mode: 'local-plan',
        requestId,
        stage: 'ffmpeg',
        status: 'running',
        tabId: normalizedTabId,
        totalFragments: session.plan.fragmentCount,
        usingManualKey: Boolean(session.manualKeyBase64),
      })

      const result = await downloadEmbeddedBrowserManifestResource({
        durationSeconds: session.plan.durationSeconds,
        ffmpegPath: session.ffmpegPath,
        kind: 'hls',
        manifestUrl: localDownloadResult.playlistPath,
        onProgress: (progress) => {
          emitEmbeddedBrowserHlsTask({
            completedFragments: session.plan.fragmentCount,
            durationSeconds: session.plan.durationSeconds,
            ffmpegSpeedText: progress.speedText,
            manifestUrl: session.plan.manifestUrl,
            mode: 'local-plan',
            processedSeconds: progress.processedSeconds,
            requestId,
            stage: 'ffmpeg',
            status: 'running',
            tabId: normalizedTabId,
            totalFragments: session.plan.fragmentCount,
            usingManualKey: Boolean(session.manualKeyBase64),
          })
        },
        outputPath: session.outputPath,
        signal: activeTask.signal,
      })

      embeddedBrowserHlsSessionOwner.takeRetry(requestId, normalizedTabId)
      emitEmbeddedBrowserHlsTask({
        completedFragments: session.plan.fragmentCount,
        durationSeconds: session.plan.durationSeconds,
        manifestUrl: session.plan.manifestUrl,
        message: 'HLS 下载完成',
        mode: 'local-plan',
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
        totalFragments: session.plan.fragmentCount,
        usingManualKey: Boolean(session.manualKeyBase64),
      })

      await rm(session.workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      const wasAborted = activeTask?.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      if (!wasAborted && latestFailedFragments?.length) {
        embeddedBrowserHlsSessionOwner.upsertRetry({
          ...session,
          failedFragments: latestFailedFragments,
        })
        retainRetrySession = true
      } else {
        embeddedBrowserHlsSessionOwner.takeRetry(requestId, normalizedTabId)
      }
      emitEmbeddedBrowserHlsTask({
        durationSeconds: session.plan.durationSeconds,
        error: error instanceof Error ? error.message : String(error),
        failedFragments: latestFailedFragments,
        manifestUrl: session.plan.manifestUrl,
        message: error instanceof Error ? error.message : String(error),
        mode: 'local-plan',
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
        totalFragments: session.plan.fragmentCount,
        usingManualKey: Boolean(session.manualKeyBase64),
      })
      if (!retainRetrySession) {
        await rm(session.workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      }
      if (wasAborted) {
        return {
          cancelled: true,
          ok: false,
        }
      }
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    } finally {
      activeTask?.complete()
    }
  }

  async function downloadEmbeddedBrowserMpdResource(
    tabId: string,
    payload: EmbeddedBrowserMpdDownloadPayload,
  ): Promise<EmbeddedBrowserMpdDownloadResponse> {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, 'mpd')
  }

  async function downloadEmbeddedBrowserMpdPlanResource(
    tabId: string,
    payload: EmbeddedBrowserMpdPlanDownloadPayload,
  ): Promise<EmbeddedBrowserMpdPlanDownloadResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const resourceId = String(payload.resourceId || '').trim() || undefined
    const requestId = String(payload.requestId || '').trim() || undefined
    const plan = payload.plan
    if (!normalizedTabId || !plan || !Array.isArray(plan.representations) || plan.representations.length === 0) {
      return {
        error: '缺少可下载的 MPD 计划',
        ok: false,
      }
    }
    if (
      resourceId
      && /^https?:\/\//i.test(String(plan.manifestUrl || ''))
      && (!captureRuntime || !captureRuntime.access.redeem({
        purpose: 'resource-download',
        resourceId,
        tabId: normalizedTabId,
      }))
    ) {
      return {
        error: 'MPD 捕捉资源已过期或不属于当前页面',
        ok: false,
      }
    }
    if (plan.hasDrm) {
      return {
        error: '当前 MPD 检测到 DRM，第一版下载器暂不支持',
        ok: false,
      }
    }

    const selectedVideoRepresentation = String(payload.selectedVideoRepresentationId || '').trim()
      ? plan.representations.find((item) => item.id === String(payload.selectedVideoRepresentationId || '').trim())
      : undefined
    const selectedAudioRepresentation = String(payload.selectedAudioRepresentationId || '').trim()
      ? plan.representations.find((item) => item.id === String(payload.selectedAudioRepresentationId || '').trim())
      : undefined

    if (!selectedVideoRepresentation && !selectedAudioRepresentation) {
      return {
        error: '至少需要选择一条 MPD 轨道',
        ok: false,
      }
    }

    try {
      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(plan.manifestUrl, 'mpd')
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName,
        filters: [
          { extensions: ['mp4', 'm4a', 'webm'], name: '媒体文件' },
        ],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) {
        return {
          cancelled: true,
          ok: false,
        }
      }

      const result = await downloadEmbeddedBrowserMpdToOutput({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, resourceId),
        ffmpegPath: payload.ffmpegPath,
        headers: plan.headers,
        outputPath,
        selectedAudioRepresentation,
        selectedVideoRepresentation,
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      runtimeLogger.warn('embedded browser mpd plan download failed', {
        error: error instanceof Error ? error.message : String(error),
        manifestUrl: plan.manifestUrl,
        requestId,
        tabId: normalizedTabId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  function syncEmbeddedBrowserViewBounds(view: WebContentsView) {
    view.setBounds(embeddedBrowserPendingBounds ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
  }

  function detachActiveEmbeddedBrowserView(targetWindow: BrowserWindow) {
    if (!activeEmbeddedBrowserTabId) {
      return
    }
    const activeView = getEmbeddedBrowserView(activeEmbeddedBrowserTabId)
    if (!activeView) {
      activeEmbeddedBrowserTabId = null
      return
    }
    if (targetWindow.contentView.children.includes(activeView)) {
      targetWindow.contentView.removeChildView(activeView)
    }
    activeEmbeddedBrowserTabId = null
  }

  function createEmbeddedBrowserView(tabId: string) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null
    }
    const view = createEmbeddedBrowserManagedView({
      createIfMissingProbe: tryInstallEmbeddedBrowserResourceProbe,
      currentUrls: embeddedBrowserLastCommittedUrls,
      debugEnabled: options.debugEnabled,
      emitTabState: emitEmbeddedBrowserTabState,
      iconSourceUrls: embeddedBrowserIconSourceUrls,
      iconUrls: embeddedBrowserIconUrls,
      onAutoFillReady: (autoFillTabId, domain) => {
        const entries = getEmbeddedBrowserPasswordsForDomain(domain)
        if (!entries.length) {
          return
        }
        const target = entries[0]
        const password = decryptEmbeddedBrowserPasswordForAutoFill(target.id)
        if (!password) {
          return
        }
        const view = getEmbeddedBrowserView(autoFillTabId)
        if (!view || view.webContents.isDestroyed()) {
          return
        }
        const fillScript = `window.__OMNIFLOW_FILL_CREDENTIAL__(${JSON.stringify(target.username)}, ${JSON.stringify(password)})`
        view.webContents.executeJavaScript(fillScript, true).catch(() => {})
        if (entries.length > 1) {
          emitCredentialAutoFilled({
            tabId: autoFillTabId,
            domain,
            filledUsername: target.username,
            alternatives: entries.map((e) => ({ id: e.id, username: e.username })),
          })
        }
      },
      onCredentialPayload: (credentialTabId, payload) => {
        const username = typeof payload.username === 'string' ? payload.username.trim() : ''
        const password = typeof payload.password === 'string' ? payload.password : ''
        const domain = typeof payload.domain === 'string' ? payload.domain.trim().toLowerCase() : ''
        const pageUrl = typeof payload.pageUrl === 'string' ? payload.pageUrl : ''
        if (!username || !password || !domain) {
          return
        }
        if (isEmbeddedBrowserBlacklistedDomain(domain)) {
          return
        }
        if (hasEmbeddedBrowserMatchingPassword(domain, username)) {
          return
        }
        const credentialRequestId = cacheEmbeddedBrowserCredential({
          domain,
          username,
          password,
          pageUrl,
          tabId: credentialTabId,
        })
        emitCredentialCaptured({
          credentialRequestId,
          domain,
          username,
          pageUrl,
          tabId: credentialTabId,
        })
      },
      onDocumentNavigated: (navigatedTabId) => {
        cancelEmbeddedBrowserLibraryFileDropRequests(navigatedTabId)
        cleanupEmbeddedBrowserDroppedFilesForTab(navigatedTabId)
        void clearEmbeddedBrowserHlsSessions({ tabId: navigatedTabId })
      },
      onLibraryFileDropPayload: (dropTabId, payload) => {
        void handleLibraryFileDropPayload(dropTabId, payload)
      },
      onPageDragPayload: (pageDragTabId, payload) => {
        const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl : ''
        const resourceId = captureRuntime?.resolveResourceIdByUrl(pageDragTabId, sourceUrl)
        recordEmbeddedBrowserPageDragSource(
          pageDragTabId,
          resourceId ? { ...payload, resourceId } : payload,
        )
      },
      onViewDestroyed: (destroyedTabId) => {
        cancelEmbeddedBrowserLibraryFileDropRequests(destroyedTabId)
        cleanupEmbeddedBrowserDroppedFilesForTab(destroyedTabId)
        void clearEmbeddedBrowserHlsSessions({ tabId: destroyedTabId })
      },
      onViewRenderProcessGone: (crashedTabId) => {
        void clearEmbeddedBrowserHlsSessions({ tabId: crashedTabId })
      },
      syncBounds: syncEmbeddedBrowserViewBounds,
      tabId,
      tryDispatchPendingOpenFile: async (targetTabId, view) => tryDispatchPendingEmbeddedBrowserOpenFile({
        attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
        currentUrls: embeddedBrowserLastCommittedUrls,
        pendingOpenFiles: embeddedBrowserPendingOpenFiles,
        tabId: targetTabId,
        view,
      }),
      views: embeddedBrowserViews,
    })
    const binding = captureRuntime?.registerView({
      pageUrl: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL(),
      tabId,
      webContents: view.webContents,
    })
    if (!binding) {
      embeddedBrowserViews.delete(tabId)
      if (!view.webContents.isDestroyed()) {
        view.webContents.close({ waitForBeforeUnload: false })
      }
      runtimeLogger.error('embedded browser capture owner registration failed', { tabId })
      return null
    }
    return view
  }

  function activateEmbeddedBrowserTab(
    targetWindow: BrowserWindow | null,
    tabId: string | null,
    activateOptions: { createIfMissing?: boolean } = {},
  ) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null
    }
    if (!tabId) {
      detachActiveEmbeddedBrowserView(targetWindow)
      return null
    }
    const createIfMissing = activateOptions.createIfMissing ?? false
    const nextView = createIfMissing ? createEmbeddedBrowserView(tabId) : getEmbeddedBrowserView(tabId)
    if (!nextView) {
      detachActiveEmbeddedBrowserView(targetWindow)
      return null
    }
    if (activeEmbeddedBrowserTabId && activeEmbeddedBrowserTabId !== tabId) {
      detachActiveEmbeddedBrowserView(targetWindow)
    }
    syncEmbeddedBrowserViewBounds(nextView)
    if (!targetWindow.contentView.children.includes(nextView)) {
      targetWindow.contentView.addChildView(nextView)
    }
    activeEmbeddedBrowserTabId = tabId
    return nextView
  }

  async function loadEmbeddedBrowserUrl(
    targetWindow: BrowserWindow | null,
    tabId: string,
    url: string,
    errorDetails: 'open-exception' | 'navigate-exception',
    activateOnly = false,
  ) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    selectEmbeddedBrowserTab(normalizedTabId)
    const view = activateEmbeddedBrowserTab(targetWindow, normalizedTabId, { createIfMissing: true })
    if (!view || view.webContents.isDestroyed()) {
      return
    }
    const normalizedUrl = String(url || '').trim()
    if (!normalizedUrl) {
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        state: 'ready',
        title: getEmbeddedBrowserTitle(view) || '新标签页',
        url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || undefined,
      })
      return
    }
    const currentUrl = embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL()
    if (activateOnly && currentUrl === normalizedUrl) {
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        state: 'ready',
        url: currentUrl || undefined,
      })
      return
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: 'load-url',
      state: 'loading',
      url: normalizedUrl,
    })
    try {
      await view.webContents.loadURL(normalizedUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_ABORTED')) {
        return
      }
      emitEmbeddedBrowserTabState(normalizedTabId, view, {
        details: errorDetails,
        state: 'error',
        message: `页面加载失败：${message}`,
        url: normalizedUrl,
      })
      throw error
    }
  }

  function closeEmbeddedBrowserTab(targetWindow: BrowserWindow | null, tabId: string) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    cancelEmbeddedBrowserLibraryFileDropRequests(normalizedTabId)
    cleanupEmbeddedBrowserDroppedFilesForTab(normalizedTabId)
    if (activeEmbeddedBrowserTabId === normalizedTabId) {
      activeEmbeddedBrowserTabId = null
    }
    if (selectedEmbeddedBrowserTabId === normalizedTabId) {
      selectEmbeddedBrowserTab(null)
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    embeddedBrowserViews.delete(normalizedTabId)
    embeddedBrowserLastCommittedUrls.delete(normalizedTabId)
    embeddedBrowserIconUrls.delete(normalizedTabId)
    embeddedBrowserIconSourceUrls.delete(normalizedTabId)
    clearEmbeddedBrowserPageDragSources(normalizedTabId)
    captureRuntime?.closeTab(normalizedTabId)
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
    })
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId,
    })
    void clearEmbeddedBrowserHlsSessions({ tabId: normalizedTabId })
    void clearEmbeddedBrowserMseSpoolFiles({ tabId: normalizedTabId })
    if (!view) {
      return
    }
    if (targetWindow.contentView.children.includes(view)) {
      targetWindow.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async function handleOpenTab(sender: Electron.WebContents, tabId: string, url?: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
    selectEmbeddedBrowserTab(normalizedTabId)
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
    })
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId,
    })
    const normalizedUrl = String(url || '').trim()
    if (!normalizedUrl) {
      activateEmbeddedBrowserTab(targetWindow, normalizedTabId, { createIfMissing: false })
      emitEmbeddedBrowserState({
        canGoBack: false,
        canGoForward: false,
        state: 'ready',
        tabId: normalizedTabId,
        title: '新标签页',
      })
      return
    }
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, normalizedUrl, 'open-exception', true)
  }

  function handleActivateTab(sender: Electron.WebContents, tabId: string | null) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    selectEmbeddedBrowserTab(tabId)
    activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false })
  }

  async function handleNavigate(sender: Electron.WebContents, tabId: string, url: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
    cancelEmbeddedBrowserLibraryFileDropRequests(normalizedTabId)
    cleanupEmbeddedBrowserDroppedFilesForTab(normalizedTabId)
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
    })
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId,
    })
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, url, 'navigate-exception')
  }

  async function handleOpenMappedFile(
    sender: Electron.WebContents,
    tabId: string,
    pageUrl: string,
    sourceUrl: string,
    fileName: string,
  ) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
    const normalizedPageUrl = String(pageUrl || '').trim()
    const normalizedSourceUrl = String(sourceUrl || '').trim()
    const normalizedFileName = String(fileName || '').trim() || 'file'
    if (!normalizedTabId || !normalizedPageUrl || !normalizedSourceUrl) {
      return
    }

    cancelEmbeddedBrowserLibraryFileDropRequests(normalizedTabId)
    cleanupEmbeddedBrowserDroppedFilesForTab(normalizedTabId)

    const requestVersion = bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
    })
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId,
    })
    const stagedPath = await stageEmbeddedBrowserOpenFile(normalizedSourceUrl, normalizedFileName)
    if (!isEmbeddedBrowserOpenFileRequestCurrent({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
      version: requestVersion,
    })) {
      void cleanupEmbeddedBrowserOpenFile(stagedPath).catch(() => undefined)
      return
    }
    embeddedBrowserPendingOpenFiles.set(normalizedTabId, {
      fileName: normalizedFileName,
      pageUrl: normalizedPageUrl,
      stagedPath,
    })

    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, normalizedPageUrl, 'navigate-exception')
    if (!isEmbeddedBrowserOpenFileRequestCurrent({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
      version: requestVersion,
    })) {
      return
    }

    const view = getEmbeddedBrowserView(normalizedTabId)
    if (view) {
      void tryDispatchPendingEmbeddedBrowserOpenFile({
        attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
        currentUrls: embeddedBrowserLastCommittedUrls,
        pendingOpenFiles: embeddedBrowserPendingOpenFiles,
        tabId: normalizedTabId,
        view,
      })
    }
  }

  async function handleReload(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: 'reload',
      state: 'loading',
      url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL() || undefined,
    })
    view.webContents.reloadIgnoringCache()
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: 'reload-requested',
    })
  }

  async function handleClearCacheAndReload(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return false
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return false
    }
    const browserSession = view.webContents.session
    await browserSession.clearCache()
    await browserSession.clearStorageData({
      storages: ['cachestorage', 'serviceworkers'] as any,
    }).catch(() => undefined)
    const clearHostResolverCache = (browserSession as any).clearHostResolverCache
    if (typeof clearHostResolverCache === 'function') {
      await clearHostResolverCache.call(browserSession).catch(() => undefined)
    }
    emitEmbeddedBrowserTabState(normalizedTabId, view, {
      details: 'clear-cache-reload',
      state: 'loading',
      url: embeddedBrowserLastCommittedUrls.get(normalizedTabId) || view.webContents.getURL() || undefined,
    })
    view.webContents.reloadIgnoringCache()
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: 'clear-cache-reload-requested',
    })
    return true
  }

  async function handleResetPageStorageAndReload(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return false
    }
    const currentView = getEmbeddedBrowserView(normalizedTabId)
    if (!currentView || currentView.webContents.isDestroyed()) {
      return false
    }
    const targetWindow = options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false
    }
    const reloadUrl = embeddedBrowserLastCommittedUrls.get(normalizedTabId) || currentView.webContents.getURL() || ''
    if (!reloadUrl) {
      return false
    }
    let reloadOrigin = ''
    try {
      const parsedUrl = new URL(reloadUrl)
      reloadOrigin = parsedUrl.origin === 'null' ? '' : parsedUrl.origin
    } catch {
      reloadOrigin = ''
    }
    if (!reloadOrigin) {
      return false
    }
    const previousCaptureSnapshot = getEmbeddedBrowserCaptureSnapshot(normalizedTabId)
    const previousCaptureMode = previousCaptureSnapshot?.status === 'active'
      ? previousCaptureSnapshot.captureMode
      : 'off'
    const browserSession = currentView.webContents.session
    await browserSession.clearStorageData({
      origin: reloadOrigin,
      storages: ['cachestorage', 'serviceworkers', 'indexdb', 'websql'] as any,
    }).catch(() => undefined)
    emitEmbeddedBrowserTabState(normalizedTabId, currentView, {
      details: 'reset-page-storage',
      state: 'loading',
      url: reloadUrl,
    })
    closeEmbeddedBrowserTab(targetWindow, normalizedTabId)
    const nextView = activateEmbeddedBrowserTab(targetWindow, normalizedTabId, { createIfMissing: true })
    if (!nextView) {
      return false
    }
    setEmbeddedBrowserCaptureMode(normalizedTabId, previousCaptureMode)
    if (previousCaptureMode === 'deep') {
      await tryInstallEmbeddedBrowserResourceProbe(normalizedTabId, nextView)
    }
    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, reloadUrl, 'navigate-exception')
    return true
  }

  async function handleGoBack(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return
    }
    if (view.webContents.canGoBack()) {
      view.webContents.goBack()
    }
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: 'history-back',
    })
  }

  async function handleGoForward(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view || view.webContents.isDestroyed()) {
      return
    }
    if (view.webContents.canGoForward()) {
      view.webContents.goForward()
    }
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: 'history-forward',
    })
  }

  async function handleOpenResource(tabId: string, resourceId: string) {
    const resolvedResourceKey = captureRuntime?.resolvePageResourceKey(tabId, resourceId)
    if (!resolvedResourceKey) return false
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const normalizedTabId = String(tabId || '').trim()
        const normalizedResourceKey = resolvedResourceKey
        if (normalizedResourceKey.startsWith('mse-stream:')) {
          const resource = await extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, normalizedResourceKey)
          if (resource && 'filePath' in resource && resource.filePath) {
            const openError = await shell.openPath(resource.filePath)
            return !openError
          }
        }
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            'openResource',
            resolvedResourceKey,
          )
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              'openResource',
              resolvedResourceKey,
            )
          } catch {
            return false
          }
        }))
        return results.some(Boolean)
      } catch (error) {
        runtimeLogger.warn('embedded browser resource probe action failed', {
          action: 'openResource',
          error: error instanceof Error ? error.message : String(error),
          resourceId: String(resourceId || '').trim(),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleExportResource(tabId: string, resourceId: string) {
    const resolvedResourceKey = captureRuntime?.resolvePageResourceKey(tabId, resourceId)
    if (!resolvedResourceKey) return false
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const normalizedTabId = String(tabId || '').trim()
        const normalizedResourceKey = resolvedResourceKey
        if (normalizedResourceKey.startsWith('mse-stream:')) {
          const resource = await extractEmbeddedBrowserResourceFromFrames(normalizedTabId, view, normalizedResourceKey)
          if (resource) {
            const defaultFileName = deriveEmbeddedBrowserExtractedResourceOutputFileName(
              resource.fileName,
            )
            const mainWindow = options.getMainWindow()
            const targetWindow = mainWindow && !mainWindow.isDestroyed()
              ? mainWindow
              : undefined
            const saveDialogOptions = {
              defaultPath: path.join(app.getPath('downloads'), defaultFileName),
              showsTagField: false,
            }
            const saveResult = targetWindow
              ? await dialog.showSaveDialog(targetWindow, saveDialogOptions)
              : await dialog.showSaveDialog(saveDialogOptions)
            if (saveResult.canceled || !saveResult.filePath) {
              return false
            }
            await saveEmbeddedBrowserExtractedResourceFile(resource, saveResult.filePath)
            return true
          }
        }
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            'exportResource',
            resolvedResourceKey,
          )
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              'exportResource',
              resolvedResourceKey,
            )
          } catch {
            return false
          }
        }))
        return results.some(Boolean)
      } catch (error) {
        runtimeLogger.warn('embedded browser resource probe action failed', {
          action: 'exportResource',
          error: error instanceof Error ? error.message : String(error),
          resourceId: String(resourceId || '').trim(),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleReadResource(tabId: string, resourceId: string) {
    const resolvedResourceKey = captureRuntime?.resolvePageResourceKey(tabId, resourceId)
    if (!resolvedResourceKey) return null
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const resource = await extractEmbeddedBrowserResourceFromFrames(String(tabId || '').trim(), view, resolvedResourceKey)
        if (!resource) {
          return null
        }
        if (typeof resource.base64 === 'string') {
          return {
            base64: resource.base64,
            fileName: resource.fileName,
            mimeType: resource.mimeType,
            streamType: resource.streamType,
          }
        }
        if (!('filePath' in resource) || !resource.filePath) {
          return null
        }
        const fileBuffer = await readFile(resource.filePath)
        return {
          base64: fileBuffer.toString('base64'),
          fileName: resource.fileName,
          mimeType: resource.mimeType,
          streamType: resource.streamType,
        }
      } catch (error) {
        runtimeLogger.warn('embedded browser resource read failed', {
          error: error instanceof Error ? error.message : String(error),
          resourceId: String(resourceId || '').trim(),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return null
      }
    })
  }

  async function handlePreviewResource(tabId: string, payload: EmbeddedBrowserResourcePreviewPayload) {
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript) => {
      try {
        return await runEmbeddedBrowserResourcePreview(executeScript, payload)
      } catch (error) {
        runtimeLogger.warn('embedded browser network resource preview failed', {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || '').trim(),
          url: String(payload.url || '').trim(),
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleGetCatchToolkitState(tabId: string) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const readState = async () => {
          const frames = getEmbeddedBrowserFrameList(view)
          if (!frames.length) {
            return await getEmbeddedBrowserCatchToolkitState(
              (script) => view.webContents.executeJavaScript(script, true),
            )
          }
          const states = await Promise.all(frames.map(async (frame) => {
            try {
              return await getEmbeddedBrowserCatchToolkitState(
                (script) => frame.executeJavaScript(script, true),
              )
            } catch {
              return null
            }
          }))
          return mergeCatchToolkitStatePayloads(states.filter((state): state is EmbeddedBrowserCatchToolkitStatePayload => Boolean(state)))
        }
        const currentState = await readState()
        if (currentState) {
          return currentState
        }
        await tryInstallEmbeddedBrowserResourceProbe(String(tabId || '').trim(), view)
        return await readState() || await createMissingCatchToolkitProbeState(view)
      } catch (error) {
        runtimeLogger.warn('embedded browser catch toolkit get state failed', {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return null
      }
    })
  }

  async function handleUpdateCatchToolkitState(
    tabId: string,
    payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>,
  ) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await updateEmbeddedBrowserCatchToolkitState(
            (script) => view.webContents.executeJavaScript(script, true),
            payload,
          )
        }
        const states = await Promise.all(frames.map(async (frame) => {
          try {
            return await updateEmbeddedBrowserCatchToolkitState(
              (script) => frame.executeJavaScript(script, true),
              payload,
            )
          } catch {
            return null
          }
        }))
        return mergeCatchToolkitStatePayloads(states.filter((state): state is EmbeddedBrowserCatchToolkitStatePayload => Boolean(state)))
      } catch (error) {
        runtimeLogger.warn('embedded browser catch toolkit update state failed', {
          error: error instanceof Error ? error.message : String(error),
          payload,
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return null
      }
    })
  }

  async function handleCatchToolkitAction(
    tabId: string,
    action: 'clearCatchMediaCache' | 'downloadCatchMedia' | 'restartCatchMediaCapture',
    logKey: string,
  ) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await runEmbeddedBrowserCatchToolkitAction(
            (script) => view.webContents.executeJavaScript(script, true),
            action,
          )
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserCatchToolkitAction(
              (script) => frame.executeJavaScript(script, true),
              action,
            )
          } catch {
            return false
          }
        }))
        return results.some(Boolean)
      } catch (error) {
        runtimeLogger.warn(`embedded browser catch toolkit ${logKey} failed`, {
          error: error instanceof Error ? error.message : String(error),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleStartDeepResourceCapture(tabId: string) {
    const normalizedTabId = String(tabId || '').trim()
    const snapshot = setEmbeddedBrowserCaptureMode(normalizedTabId, 'deep')
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (view && !view.webContents.isDestroyed()) {
      if (view.webContents.getURL()) {
        await tryInstallEmbeddedBrowserResourceProbe(normalizedTabId, view)
        view.webContents.reloadIgnoringCache()
      } else {
        await tryInstallEmbeddedBrowserResourceProbe(normalizedTabId, view)
      }
    }
    return snapshot
  }

  function handleSetBounds(sender: Electron.WebContents, bounds: EmbeddedBrowserBounds) {
    const nextBounds = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const zoomFactor = targetWindow && !targetWindow.isDestroyed()
      ? Math.max(targetWindow.webContents.getZoomFactor(), 0.01)
      : 1
    nextBounds.x = Math.max(0, Math.round(bounds.x * zoomFactor))
    nextBounds.y = Math.max(0, Math.round(bounds.y * zoomFactor))
    nextBounds.width = Math.max(0, Math.round(bounds.width * zoomFactor))
    nextBounds.height = Math.max(0, Math.round(bounds.height * zoomFactor))
    embeddedBrowserPendingBounds = nextBounds
    if (!activeEmbeddedBrowserTabId) {
      return
    }
    const activeView = getEmbeddedBrowserView(activeEmbeddedBrowserTabId)
    if (!activeView) {
      return
    }
    activeView.setBounds(nextBounds)
  }

  function handleCloseTab(sender: Electron.WebContents, tabId: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    closeEmbeddedBrowserTab(targetWindow, tabId)
  }

  async function handleCleanupDownloadFile(tempPath: string) {
    try {
      return await cleanupEmbeddedBrowserDownloadFile(tempPath)
    } catch {
      return false
    }
  }

  async function handleStagePageDrag(input: EmbeddedBrowserStagePageDragRequest) {
    const request = {
      ...input,
      tabId: String(input?.tabId || activeEmbeddedBrowserTabId || '').trim() || undefined,
    }
    return stageEmbeddedBrowserPageDrag(request, {
      browserSession: getEmbeddedBrowserSession(),
      fetchCapturedResource: async ({ resourceId, tabId: resourceTabId }) => {
        if (!captureRuntime) {
          throw new Error('捕捉资源 authority 不可用，请重新拖拽')
        }
        const result = await captureRuntime.access.fetch({
          purpose: 'page-drag-stage',
          resourceId,
          tabId: resourceTabId,
        })
        return {
          resource: {
            mimeType: result.resource.mimeType,
            name: result.resource.name,
            url: result.resource.url,
          },
          response: result.response,
        }
      },
      readPageBlob: async (tabId, sourceUrl, maxBytes) => {
        const view = getEmbeddedBrowserView(tabId)
        if (!view || view.webContents.isDestroyed()) {
          throw new Error('网页已关闭，请重新拖拽')
        }
        return readEmbeddedBrowserPageBlob(view, sourceUrl, maxBytes)
      },
    })
  }

  function handleDeactivate(sender: Electron.WebContents) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    selectEmbeddedBrowserTab(null)
    detachActiveEmbeddedBrowserView(targetWindow)
  }

  function handleCloseAll(sender: Electron.WebContents) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    for (const tabId of embeddedBrowserLibraryFileDropRequests.keys()) {
      cancelEmbeddedBrowserLibraryFileDropRequests(tabId)
    }
    Array.from(embeddedBrowserViews.keys()).forEach((tabId) => {
      closeEmbeddedBrowserTab(targetWindow, tabId)
    })
    activeEmbeddedBrowserTabId = null
    selectEmbeddedBrowserTab(null)
    clearEmbeddedBrowserPageDragSources()
    emitEmbeddedBrowserState({ state: 'idle' })
  }

  function registerIpcHandlers() {
    registerEmbeddedBrowserMainIpcHandlers({
      activateTab: handleActivateTab,
      cleanupDownloadFile: handleCleanupDownloadFile,
      clearBrowserCache: handleClearCacheAndReload,
      clearCapturedResources: clearEmbeddedBrowserCaptureResources,
      inspectResource: inspectEmbeddedBrowserCapturedResource,
      clearCatchMediaCache: (tabId) => handleCatchToolkitAction(tabId, 'clearCatchMediaCache', 'clear cache'),
      closeAll: handleCloseAll,
      closeTab: handleCloseTab,
      deactivate: handleDeactivate,
      downloadCatchMedia: (tabId) => handleCatchToolkitAction(tabId, 'downloadCatchMedia', 'download'),
      downloadHlsManifest: downloadEmbeddedBrowserHlsResource,
      startHlsRecording: startEmbeddedBrowserHlsRecordingResource,
      stopHlsRecording: stopEmbeddedBrowserHlsRecordingResource,
      discardHlsRecording: discardEmbeddedBrowserHlsRecordingResource,
      downloadHlsTracks: downloadEmbeddedBrowserHlsTracksResource,
      downloadHlsPlan: downloadEmbeddedBrowserHlsPlanResource,
      retryHlsPlanFailed: retryEmbeddedBrowserHlsPlanFailedFragments,
      downloadMpdManifest: downloadEmbeddedBrowserMpdResource,
      downloadMpdPlan: downloadEmbeddedBrowserMpdPlanResource,
      downloadDirectFile: downloadEmbeddedBrowserDirectFile,
      downloadCapturedResource: downloadEmbeddedBrowserCapturedResource,
      exportResource: handleExportResource,
      getCatchToolkitState: handleGetCatchToolkitState,
      goBack: handleGoBack,
      goForward: handleGoForward,
      listCapturedResources: getEmbeddedBrowserCaptureSnapshot,
      mergeMseResources: mergeEmbeddedBrowserCapturedMseResources,
      navigate: handleNavigate,
      openMappedFile: handleOpenMappedFile,
      openResource: handleOpenResource,
      openTab: handleOpenTab,
      previewResource: handlePreviewResource,
      readResource: handleReadResource,
      reload: handleReload,
      resetPageStorage: handleResetPageStorageAndReload,
      resolveFavicon: resolveEmbeddedBrowserBookmarkFavicon,
      restartCatchMediaCapture: (tabId) => handleCatchToolkitAction(tabId, 'restartCatchMediaCapture', 'restart'),
      saveResource: saveEmbeddedBrowserCapturedResourceForRenderer,
      setBounds: handleSetBounds,
      stagePageDrag: handleStagePageDrag,
      startCapturedResources: (tabId) => setEmbeddedBrowserCaptureMode(tabId, 'network'),
      startDeepResourceCapture: handleStartDeepResourceCapture,
      stopCapturedResources: (tabId) => setEmbeddedBrowserCaptureMode(tabId, 'off'),
      transcodeResource: transcodeEmbeddedBrowserCapturedResourceForRenderer,
      updateCatchToolkitState: handleUpdateCatchToolkitState,
      getCookies: getEmbeddedBrowserCookies,
      removeCookie: removeEmbeddedBrowserCookie,
      removeCookiesByDomain: removeEmbeddedBrowserCookiesByDomain,
      removeAllCookies: removeAllEmbeddedBrowserCookies,
      getResourceCaptureRules: async () => listEmbeddedBrowserResourceCaptureRules(),
      updateResourceCaptureRules: async (ruleSet) => {
        const next = updateEmbeddedBrowserResourceCaptureRules(ruleSet)
        captureRuntime?.updateCaptureSettings(compileOmniFlowCaptureSettings(next))
        return next
      },
      resetResourceCaptureRules: async () => {
        const next = resetEmbeddedBrowserResourceCaptureRules()
        captureRuntime?.updateCaptureSettings(compileOmniFlowCaptureSettings(next))
        return next
      },
      getExternalToolSettings: async () => listEmbeddedBrowserExternalToolSettings(),
      updateExternalToolSettings: async (settings) => updateEmbeddedBrowserExternalToolSettings(settings),
      resetExternalToolSettings: async () => resetEmbeddedBrowserExternalToolSettings(),
      listEnabledExternalTools: async () => listEnabledEmbeddedBrowserExternalToolOptions(),
      dispatchExternalTool: dispatchCapturedResourceToExternalTool,
      listPasswords: listEmbeddedBrowserPasswords,
      getDecryptedPassword: getEmbeddedBrowserDecryptedPassword,
      saveCapturedCredential: async (credentialRequestId) => {
        const credential = consumeEmbeddedBrowserCachedCredential(credentialRequestId)
        if (!credential) {
          throw new Error('凭据已过期或不存在，请重新登录后再保存')
        }
        return saveEmbeddedBrowserPassword(credential)
      },
      deletePassword: deleteEmbeddedBrowserPassword,
      deleteAllPasswords: deleteAllEmbeddedBrowserPasswords,
      blacklistDomain: addEmbeddedBrowserBlacklistedDomain,
      isBlacklistedDomain: isEmbeddedBrowserBlacklistedDomain,
      autoFillPassword: async (autoFillTabId, passwordId) => {
        const store = listEmbeddedBrowserPasswords()
        const entry = store.find((p) => p.id === passwordId)
        if (!entry) {
          return null
        }
        const password = decryptEmbeddedBrowserPasswordForAutoFill(passwordId)
        if (!password) {
          return null
        }
        const view = getEmbeddedBrowserView(autoFillTabId)
        if (!view || view.webContents.isDestroyed()) {
          return null
        }
        const fillScript = `window.__OMNIFLOW_FILL_CREDENTIAL__(${JSON.stringify(entry.username)}, ${JSON.stringify(password)})`
        await view.webContents.executeJavaScript(fillScript, true).catch(() => {})
        return { username: entry.username }
      },
    })
  }

  function dispose() {
    const hlsCleanupPromise = embeddedBrowserHlsSessionOwner.dispose()
    captureRuntime?.dispose()
    captureRuntime = null
    for (const tabId of embeddedBrowserLibraryFileDropRequests.keys()) {
      cancelEmbeddedBrowserLibraryFileDropRequests(tabId)
    }
    embeddedBrowserDroppedFileStore.disposeSync()
    const openFilePaths = new Set([
      ...[...embeddedBrowserPendingOpenFiles.values()].map(file => file.stagedPath),
      ...embeddedBrowserAttachedOpenFiles.values(),
    ])
    openFilePaths.forEach((stagedPath) => {
      try {
        cleanupEmbeddedBrowserOpenFileSync(stagedPath)
      } catch {
        // A later stale-file sweep retries failed shutdown cleanup.
      }
    })
    embeddedBrowserPendingOpenFiles.clear()
    embeddedBrowserAttachedOpenFiles.clear()
    void hlsCleanupPromise.catch(() => undefined)
  }

  return {
    configureSession,
    dispose,
    handleActiveViewInputShortcut,
    initializeBridges,
    registerIpcHandlers,
    toggleActiveViewDevTools,
  }
}

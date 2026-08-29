import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
  type EmbeddedBrowserHlsTaskEventInput,
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
  type EmbeddedBrowserDashRecordingDiscardPayload,
  type EmbeddedBrowserDashRecordingDiscardResponse,
  type EmbeddedBrowserDashRecordingStartPayload,
  type EmbeddedBrowserDashRecordingStartResponse,
  type EmbeddedBrowserDashRecordingStopPayload,
  type EmbeddedBrowserDashRecordingStopResponse,
  type EmbeddedBrowserDashTaskEventInput,
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
  getEmbeddedBrowserDownloadStagingRoot,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import {
  clearEmbeddedBrowserPageDragSources,
  readEmbeddedBrowserPageBlob,
  recordEmbeddedBrowserPageDragSource,
  stageEmbeddedBrowserPageDrag,
} from './embeddedBrowserPageDragService'
import {
  listEmbeddedBrowserCaptureSettings,
  resetEmbeddedBrowserCaptureSettings,
  updateEmbeddedBrowserCaptureSettings,
} from './embedded-browser/integrations/capture-settings-store'
import {
  dispatchEmbeddedBrowserExternalTool,
  listEmbeddedBrowserExternalToolSettings,
  listEnabledEmbeddedBrowserExternalToolOptions,
  resetEmbeddedBrowserExternalToolSettings,
  updateEmbeddedBrowserExternalToolSettings,
} from './embeddedBrowserExternalTools'
import { ExternalToolDispatcher } from './embedded-browser/integrations/external-tools'
import {
  resolveHlsCapturedMediaPlan,
  resolveHlsLiveParentVariableList,
  resolveHlsManifestAuthority,
  resolveHlsTrackParentVariableList,
  resolveHlsTrackAuthorities,
} from './embedded-browser/integrations/hls-manifest-authority'
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
} from './embeddedBrowserResourceProbeScriptTemplate'
import {
  createMseDownloadStagingPath,
  emitMseDownloadCompleted,
} from './embedded-browser/processing/mse-download-output'
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
  defaultHlsTaskExecutor,
  type HlsTaskExecutionEvent,
} from './embedded-browser/processing/hls-task'
import type { EmbeddedBrowserFragmentFetch } from './embeddedBrowserFragmentDownloader'
import {
  DashTaskExecutor,
  appendDashRepresentationSegments,
  type DashTaskPlan,
} from './embedded-browser/processing/dash-task'
import type { DashRepresentation } from './embedded-browser/cat-catch-port/dash/parser'
import { mergeDashTaskTracksToOutput } from './embedded-browser/processing/dash-output'
import {
  HlsLiveTask,
} from './embedded-browser/processing/hls-live-task'
import {
  createEmbeddedBrowserDashHostLifecycle,
  EmbeddedBrowserDashLiveSessionOwner,
} from './embedded-browser/processing/dash-live-session-owner'
import {
  createDashLiveSnapshotLoader,
} from './embedded-browser/processing/dash-live-adapter'
import { DashLiveTask } from './embedded-browser/processing/dash-live-task'
import { resolveDashManifestAuthority } from './embedded-browser/integrations/dash-manifest-authority'
import {
  createEmbeddedBrowserHlsHostLifecycle,
  EmbeddedBrowserHlsSessionOwner,
} from './embedded-browser/processing/hls-session-owner'
import { MseSpoolStore } from './embedded-browser/processing/mse-spool'
import { defaultProcessingTaskRegistry } from './embedded-browser/processing/task-registry'
import { StreamingTransfer } from './embedded-browser/processing/streaming-transfer'
import { StagedOutputLeaseStore } from './embedded-browser/processing/staged-output-lease'
import { publishStagedOutput } from './embedded-browser/processing/staged-output-publisher'
import {
  downloadEmbeddedBrowserHlsLocalTracks,
} from './embedded-browser/processing/hls-local-track-merge'
import {
  cleanupStaleEmbeddedBrowserOpenFiles,
  cleanupEmbeddedBrowserOpenFile,
  cleanupEmbeddedBrowserOpenFileSync,
  dispatchEmbeddedBrowserFileDrop,
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_MAX_BYTES,
  stageEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'
import { EmbeddedBrowserDroppedFileStore } from './embeddedBrowserDroppedFileStore'
import { authorizeMseControlPayload } from './embedded-browser/capture/adapters/mse-main-relay'
import {
  handleEmbeddedBrowserInputShortcut,
  toggleEmbeddedBrowserDevTools,
} from './embeddedBrowserInputShortcuts'

function toDashTaskPlan(
  plan: EmbeddedBrowserMpdPlanDownloadPayload['plan'],
): DashTaskPlan {
  return {
    durationSeconds: plan.durationSeconds,
    hasDrm: Boolean(plan.hasDrm),
    headers: plan.headers,
    isDynamic: Boolean(plan.isDynamic),
    manifestUrl: plan.manifestUrl,
    minimumUpdatePeriodSeconds: plan.minimumUpdatePeriodSeconds,
    representations: plan.representations.map((representation): DashRepresentation => ({
      bandwidth: representation.bandwidth,
      baseUrls: representation.baseUrls?.length
        ? representation.baseUrls
        : [plan.manifestUrl],
      codecs: representation.codecs,
      contentType: representation.contentType,
      frameRate: representation.frameRate,
      height: representation.height,
      id: representation.id,
      initializationRange: representation.initializationRange,
      initializationUrl: representation.initializationUrl,
      language: representation.language,
      mimeType: representation.mimeType,
      segmentBase: representation.segmentBase,
      segmentCount: representation.segmentCount,
      segments: representation.segments,
      unsupportedReasons: representation.unsupportedReasons || [],
      width: representation.width,
    })),
    unsupportedReasons: plan.unsupportedReasons || [],
  }
}

async function runRegisteredEmbeddedBrowserTransfer<Result>(
  tabId: string,
  operation: (signal: AbortSignal, taskId: string) => Promise<Result>,
) {
  const controller = new AbortController()
  let settleTask: (() => void) | undefined
  const settled = new Promise<void>((resolve) => {
    settleTask = resolve
  })
  const registration = defaultProcessingTaskRegistry.register({
    cancel: () => controller.abort(),
    kind: 'streaming-transfer',
    settled,
    tabId,
  })
  try {
    return await operation(controller.signal, registration.id)
  } finally {
    settleTask?.()
    registration.release()
  }
}

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
    recorder: HlsLiveTask
    requestId: string
    tabId: string
    workDirectoryPath?: string
  }

  type EmbeddedBrowserDashLiveRecordingSession = {
    audioRepresentationId?: string
    ffmpegPath?: string
    manifestUrl: string
    outputPath: string
    recorder: {
      discard: () => Promise<void>
      getCurrentWorkDirectoryPath: () => string
    }
    requestId: string
    task: DashLiveTask
    tabId: string
    videoRepresentationId?: string
    workDirectoryPath?: string
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
  const embeddedBrowserHlsHostLifecycle = createEmbeddedBrowserHlsHostLifecycle(
    embeddedBrowserHlsSessionOwner,
  )
  const embeddedBrowserDashSessionOwner = new EmbeddedBrowserDashLiveSessionOwner<EmbeddedBrowserDashLiveRecordingSession>()
  const embeddedBrowserDashHostLifecycle = createEmbeddedBrowserDashHostLifecycle(
    embeddedBrowserDashSessionOwner,
  )
  const embeddedBrowserMseSpoolStore = new MseSpoolStore()
  const embeddedBrowserStreamingTransfer = new StreamingTransfer()
  let embeddedBrowserStagedOutputLeaseStore: StagedOutputLeaseStore | null = null
  const embeddedBrowserMseControlQueues = new Map<string, Promise<void>>()
  let activeEmbeddedBrowserTabId: string | null = null
  let selectedEmbeddedBrowserTabId: string | null = null
  let embeddedBrowserPendingBounds: EmbeddedBrowserBounds | null = null
  let embeddedBrowserSessionConfigured = false
  let captureRuntime: EmbeddedBrowserCaptureRuntime | null = null

  function getEmbeddedBrowserStagedOutputLeaseStore() {
    if (!embeddedBrowserStagedOutputLeaseStore) {
      embeddedBrowserStagedOutputLeaseStore = new StagedOutputLeaseStore({
        rootPath: path.join(app.getPath('userData'), 'embedded-browser-output-leases'),
      })
      void embeddedBrowserStagedOutputLeaseStore.reapExpired().catch((error) => {
        runtimeLogger.warn('embedded browser staged output lease reap failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
    return embeddedBrowserStagedOutputLeaseStore
  }

  function enqueueEmbeddedBrowserMseControl(
    tabId: string,
    task: () => Promise<void>,
  ) {
    const previous = embeddedBrowserMseControlQueues.get(tabId) || Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(task)
    embeddedBrowserMseControlQueues.set(tabId, next)
    void next.finally(() => {
      if (embeddedBrowserMseControlQueues.get(tabId) === next) {
        embeddedBrowserMseControlQueues.delete(tabId)
      }
    }).catch(() => undefined)
    return next
  }

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

  function emitEmbeddedBrowserHlsTask(payload: EmbeddedBrowserHlsTaskEventInput) {
    const snapshot = embeddedBrowserHlsSessionOwner.recordTaskEvent(payload)
    if (!snapshot) {
      return
    }
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:hls-task', snapshot)
  }

  function emitEmbeddedBrowserDashTask(payload: EmbeddedBrowserDashTaskEventInput) {
    const snapshot = embeddedBrowserDashSessionOwner.recordTaskEvent(payload)
    if (!snapshot) return
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('embedded-browser:dash-task', snapshot)
  }

  function createEmbeddedBrowserHlsPlanTaskEventForwarder(input: {
    onFailedFragments: (failedFragments: number[] | undefined) => void
    plan: EmbeddedBrowserHlsPlanDownloadPayload['plan']
    requestId?: string
    tabId: string
    usingManualKey: boolean
  }) {
    return (event: HlsTaskExecutionEvent) => {
      if (event.stage === 'ffmpeg' || event.stage === 'completed') {
        input.onFailedFragments(undefined)
      } else if (event.failedFragments?.length) {
        input.onFailedFragments(event.failedFragments)
      }
      emitEmbeddedBrowserHlsTask({
        ...event,
        durationSeconds: input.plan.durationSeconds,
        manifestUrl: input.plan.manifestUrl,
        mode: 'local-plan',
        requestId: input.requestId,
        tabId: input.tabId,
        totalFragments: event.totalFragments || input.plan.fragmentCount,
        usingManualKey: input.usingManualKey,
      })
    }
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

  async function clearEmbeddedBrowserMseSpoolFiles(options: {
    all?: boolean
    resourceKey?: string
    tabId?: string
  }) {
    await embeddedBrowserMseSpoolStore.clear(options)
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
    if (
      normalizedBase64.length > 90 * 1024 * 1024
      || normalizedBase64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64)
    ) {
      return null
    }
    const chunk = Buffer.from(normalizedBase64, 'base64')
    return embeddedBrowserMseSpoolStore.append({
      chunk,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      resourceKey: normalizedResourceKey,
      streamType: payload.streamType,
      tabId: normalizedTabId,
    }).catch((error) => {
      runtimeLogger.warn('embedded browser MSE spool append failed', {
        error: error instanceof Error ? error.message : String(error),
        resourceKey: normalizedResourceKey,
        tabId: normalizedTabId,
      })
      return null
    })
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
    await embeddedBrowserHlsSessionOwner.clear(options)
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
    void embeddedBrowserMseSpoolStore.sweepStale().catch(() => undefined)
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
        listEmbeddedBrowserCaptureSettings(),
      ),
      emitChange: emitEmbeddedBrowserResourceChange,
      fetch: (url, init) => browserSession.fetch(url, init),
      onProbeControlPayload: (tabId, payload) => {
        const controlPayload = authorizeMseControlPayload({
          payload,
          resolveResourceKey: (currentTabId, resourceKey) => (
            captureRuntime?.resolvePageResourceKey(currentTabId, resourceKey) || null
          ),
          tabId,
        })
        if (!controlPayload) {
          runtimeLogger.warn('embedded browser MSE control payload rejected', {
            event: typeof payload.event === 'string' ? payload.event : '',
            resourceKey: typeof payload.resourceKey === 'string' ? payload.resourceKey : '',
            tabId,
          })
          return
        }
        if (controlPayload.event === 'mse-flush') {
          void enqueueEmbeddedBrowserMseControl(tabId, async () => {
            if (controlPayload.trimBeforeHeader) {
              await clearEmbeddedBrowserMseSpoolFiles({
                resourceKey: controlPayload.resourceKey,
                tabId,
              })
            }
            await appendEmbeddedBrowserMseSpoolChunk(tabId, {
              base64: controlPayload.base64 || '',
              fileName: controlPayload.fileName,
              mimeType: controlPayload.mimeType,
              resourceKey: controlPayload.resourceKey,
              streamType: controlPayload.streamType,
            })
          })
          return
        }
        if (controlPayload.event === 'mse-complete') {
          void enqueueEmbeddedBrowserMseControl(tabId, async () => {
            await withEmbeddedBrowserView(tabId, async (view) => {
              const downloaded = await downloadEmbeddedBrowserMseResourcesToDownloads(tabId, view)
              if (!downloaded) {
                runtimeLogger.warn('embedded browser MSE automatic download produced no output', {
                  tabId,
                  resourceKey: controlPayload.resourceKey,
                })
              }
            })
          }).catch((error) => {
            runtimeLogger.warn('embedded browser MSE automatic download failed', {
              error: error instanceof Error ? error.message : String(error),
              resourceKey: controlPayload.resourceKey,
              tabId,
            })
          })
          return
        }
        if (controlPayload.event === 'mse-save') {
          void enqueueEmbeddedBrowserMseControl(tabId, async () => {
            await withEmbeddedBrowserView(tabId, async (view) => {
              const downloaded = await downloadEmbeddedBrowserMseResourcesToDownloads(tabId, view, {
                clearAfterDownload: true,
              })
              if (!downloaded) {
                runtimeLogger.warn('embedded browser MSE periodic save produced no output', {
                  tabId,
                  resourceKey: controlPayload.resourceKey,
                })
              }
            })
          }).catch((error) => {
            runtimeLogger.warn('embedded browser MSE periodic save failed', {
              error: error instanceof Error ? error.message : String(error),
              resourceKey: controlPayload.resourceKey,
              tabId,
            })
          })
          return
        }
        if (controlPayload.event === 'mse-reset') {
          void enqueueEmbeddedBrowserMseControl(tabId, async () => {
            await clearEmbeddedBrowserMseSpoolFiles({
              resourceKey: controlPayload.resourceKey,
              tabId,
            })
          })
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
          cache: init?.cache,
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
    void enqueueEmbeddedBrowserMseControl(normalizedTabId, async () => {
      await clearEmbeddedBrowserMseSpoolFiles({ tabId: normalizedTabId })
    })
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
      saveEveryGigabyte: firstState.saveEveryGigabyte,
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
      saveEveryGigabyte: false,
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
    const currentSpoolFile = await embeddedBrowserMseSpoolStore.get(tabId, resourceKey)
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

    if (drained?.trimBeforeHeader) {
      await clearEmbeddedBrowserMseSpoolFiles({
        resourceKey,
        tabId,
      })
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

    const nextSpoolFile = await embeddedBrowserMseSpoolStore.get(tabId, resourceKey)
    if (nextSpoolFile) {
      return {
        fileName: drained?.fileName || nextSpoolFile.fileName,
        filePath: nextSpoolFile.filePath,
        mimeType: drained?.mimeType || nextSpoolFile.mimeType,
        resourceKey,
        streamType: drained?.streamType || nextSpoolFile.streamType,
      }
    }
    if (!drained?.base64) return null
    return {
      base64: drained.base64,
      fileName: drained.fileName,
      mimeType: drained.mimeType,
      resourceKey,
      streamType: drained.streamType,
    }
  }

  async function downloadEmbeddedBrowserMseResourcesToDownloads(
    tabId: string,
    view: WebContentsView,
    options: { clearAfterDownload?: boolean } = {},
  ) {
    const snapshot = captureRuntime?.getSnapshot(tabId)
    if (!snapshot || snapshot.status !== 'active') {
      return false
    }

    const resourceKeys = Array.from(new Set(snapshot.resources
      .filter(resource => resource.kind === 'media' && resource.resourceType === 'mse-stream')
      .map(resource => captureRuntime?.resolvePageResourceKey(tabId, resource.id) || '')
      .filter(Boolean)))
    if (!resourceKeys.length) {
      return false
    }

    const toolkitState = await handleGetCatchToolkitState(tabId).catch(() => null)
    const extractedResources: EmbeddedBrowserExtractedResourceFile[] = []
    for (const resourceKey of resourceKeys) {
      try {
        const resource = await extractEmbeddedBrowserMseResourceFromFrames(tabId, view, resourceKey)
        if (!resource) {
          continue
        }
        extractedResources.push(resource)
      } catch (error) {
        runtimeLogger.warn('embedded browser MSE resource download failed', {
          error: error instanceof Error ? error.message : String(error),
          resourceKey,
          tabId,
        })
      }
    }

    if (!extractedResources.length) {
      return false
    }

    const pageUrl = view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(tabId) || undefined
    const stagingRootPath = getEmbeddedBrowserDownloadStagingRoot()
    const stageResource = async (
      resource: EmbeddedBrowserExtractedResourceFile,
      outputFileName = resource.fileName,
      outputPath?: string,
    ) => {
      const targetPath = outputPath || await createMseDownloadStagingPath({
        fileName: outputFileName,
        stagingRootPath,
      })
      if (!outputPath) {
        await saveEmbeddedBrowserExtractedResourceFile(resource, targetPath)
      }
      await emitMseDownloadCompleted({
        emitDownload: emitEmbeddedBrowserDownload,
        fileName: outputFileName,
        filePath: targetPath,
        mimeType: resource.mimeType,
        pageUrl,
        resourceKey: resource.resourceKey || 'mse-stream:captured',
        streamType: resource.streamType,
        tabId,
        url: resource.url,
      })
    }

    const videoResource = extractedResources.find(resource => resource.streamType === 'video')
    const audioResource = extractedResources.find(resource => resource.streamType === 'audio')
    let downloaded = false
    if (videoResource && audioResource) {
      const mergedFileName = deriveEmbeddedBrowserMergedFileName(
        videoResource.fileName,
        audioResource.fileName,
      )
      const mergedOutputPath = await createMseDownloadStagingPath({
        fileName: mergedFileName,
        stagingRootPath,
      })
      try {
        await mergeEmbeddedBrowserResourceTracks({
          audio: audioResource,
          outputPath: mergedOutputPath,
          video: videoResource,
        })
        await stageResource({
          fileName: mergedFileName,
          filePath: mergedOutputPath,
          mimeType: 'video/mp4',
          resourceKey: 'mse-stream:merged',
          streamType: 'video',
        }, mergedFileName, mergedOutputPath)
        downloaded = true
      } catch (error) {
        await rm(mergedOutputPath, { force: true }).catch(() => undefined)
        runtimeLogger.warn('embedded browser MSE track merge failed; falling back to per-track output', {
          error: error instanceof Error ? error.message : String(error),
          tabId,
        })
      }
    }

    if (!downloaded) {
      for (const resource of extractedResources) {
        try {
          await stageResource(resource, deriveEmbeddedBrowserExtractedResourceOutputFileName(resource.fileName))
          downloaded = true
        } catch (error) {
          runtimeLogger.warn('embedded browser MSE resource staging failed', {
            error: error instanceof Error ? error.message : String(error),
            resourceKey: resource.resourceKey,
            tabId,
          })
        }
      }
    }

    if (downloaded && (options.clearAfterDownload || toolkitState?.clearCacheOnComplete)) {
      await handleCatchToolkitAction(tabId, 'clearCatchMediaCache', 'clear after MSE download')
      await clearEmbeddedBrowserMseSpoolFiles({ tabId })
    }
    return downloaded
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
      return await runRegisteredEmbeddedBrowserTransfer(_tabId, async (signal, taskId) => {
        const result = await publishStagedOutput({
          fileName: path.basename(outputPath),
          ownerTaskId: taskId,
          purpose: 'direct-file-download',
          store: getEmbeddedBrowserStagedOutputLeaseStore(),
          targetPath: outputPath,
          write: async (stagedPath) => {
            const response = await fetch(resourceUrl, {
              headers: payload.headers,
              signal,
            })
            await embeddedBrowserStreamingTransfer.writeResponse(response, stagedPath, { signal })
          },
        })
        return {
          ok: true,
          outputPath: result.outputPath,
        }
      })
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
    const runtime = captureRuntime
    if (!normalizedTabId || !resourceId || !runtime) {
      return { error: '缺少可下载的捕捉资源', ok: false }
    }
    try {
      return await runRegisteredEmbeddedBrowserTransfer(normalizedTabId, async (signal, taskId) => {
        const accessResult = await runtime.access.fetch({
          purpose: 'resource-download',
          resourceId,
          signal,
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
        const result = await publishStagedOutput({
          fileName: path.basename(outputPath),
          mimeType: accessResult.resource.mimeType,
          ownerTaskId: taskId,
          purpose: 'captured-resource-download',
          store: getEmbeddedBrowserStagedOutputLeaseStore(),
          targetPath: outputPath,
          write: async (stagedPath) => {
            await embeddedBrowserStreamingTransfer.writeResponse(
              accessResult.response,
              stagedPath,
              { signal },
            )
          },
        })
        return { ok: true, outputPath: result.outputPath }
      })
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
    const hlsAuthority = kind === 'hls'
      ? resolveHlsManifestAuthority(captureRuntime?.access || null, {
          resourceId,
          tabId: normalizedTabId,
        })
      : null
    const mpdGrant = kind === 'mpd' && resourceId && captureRuntime
      ? captureRuntime.access.redeem({ purpose: 'resource-download', resourceId, tabId: normalizedTabId })
      : null
    const mpdPayload = payload as EmbeddedBrowserMpdDownloadPayload
    const manifestUrl = String(
      hlsAuthority?.manifestUrl
      || mpdGrant?.resource.url
      || (kind === 'mpd' ? mpdPayload.manifestUrl : '')
      || '',
    ).trim()
    const requestHeaders = hlsAuthority?.headers
      || (mpdGrant ? Object.fromEntries(mpdGrant.headers) : mpdPayload.headers)
    if ((kind === 'hls' && !hlsAuthority) || (kind === 'mpd' && resourceId && !mpdGrant)) {
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
    const useLocalTrackPlan = typeof payload.segmentQuery === 'string'
    const authorities = resolveHlsTrackAuthorities(captureRuntime?.access || null, {
      audioResourceId: payload.audioResourceId,
      tabId: normalizedTabId,
      videoResourceId: payload.videoResourceId,
    })
    const videoManifestUrl = authorities?.video.manifestUrl || ''
    const audioManifestUrl = authorities?.audio.manifestUrl || ''
    const requestId = String(payload.requestId || '').trim() || undefined
    if (!authorities) {
      return {
        error: '视频或音轨 manifest 未被当前页面捕捉，或捕捉记录已过期',
        ok: false,
      }
    }
    if (useLocalTrackPlan && !resolveHlsManifestAuthority(captureRuntime?.access || null, {
      resourceId: payload.sourceResourceId,
      tabId: normalizedTabId,
    })) {
      return {
        error: 'HLS master 捕捉资源已过期或不属于当前页面',
        ok: false,
      }
    }

    let outputPath: string | null = null
    let localWorkDirectoryPath = ''
    let taskDurationSeconds = payload.durationSeconds
    let totalFragments: number | undefined
    const taskMode = useLocalTrackPlan ? 'local-plan' : 'direct-manifest'
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
        durationSeconds: taskDurationSeconds,
        manifestUrl: videoManifestUrl,
        message: '开始下载并合并视频/音轨',
        mode: taskMode,
        requestId,
        stage: 'preparing',
        status: 'running',
        tabId: normalizedTabId,
      })

      const result = await embeddedBrowserHlsSessionOwner.runActiveTask({
        requestId,
        tabId: normalizedTabId,
      }, async (signal) => {
        if (!useLocalTrackPlan) {
          return downloadEmbeddedBrowserManifestTracks({
            audioHeaders: authorities.audio.headers,
            audioManifestUrl,
            durationSeconds: payload.durationSeconds,
            ffmpegPath: payload.ffmpegPath,
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
            videoHeaders: authorities.video.headers,
            videoManifestUrl,
          })
        }

        const parentVariableList = await resolveHlsTrackParentVariableList(
          captureRuntime?.access || null,
          {
            audioManifestUrl,
            signal,
            sourceResourceId: payload.sourceResourceId,
            tabId: normalizedTabId,
            videoManifestUrl,
          },
        )
        const [video, audio] = await Promise.all([
          resolveHlsCapturedMediaPlan(captureRuntime?.access || null, {
            parentVariableList,
            resourceId: authorities.video.resourceId,
            segmentQuery: payload.segmentQuery,
            signal,
            tabId: normalizedTabId,
          }),
          resolveHlsCapturedMediaPlan(captureRuntime?.access || null, {
            parentVariableList,
            resourceId: authorities.audio.resourceId,
            segmentQuery: payload.segmentQuery,
            signal,
            tabId: normalizedTabId,
          }),
        ])
        if (!video || !audio) {
          throw new Error('视频或音轨 manifest 捕捉资源已过期')
        }
        taskDurationSeconds = Math.max(video.plan.durationSeconds, audio.plan.durationSeconds)
        totalFragments = video.plan.fragmentCount + audio.plan.fragmentCount
        localWorkDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-track-'))
        return downloadEmbeddedBrowserHlsLocalTracks({
          audio: {
            fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, audio.authority.resourceId),
            plan: audio.plan,
          },
          ffmpegPath: payload.ffmpegPath,
          onEvent: (event) => {
            emitEmbeddedBrowserHlsTask({
              bytesReceived: event.bytesReceived,
              bytesTotal: event.bytesTotal,
              completedFragments: event.completedFragments,
              durationSeconds: taskDurationSeconds,
              error: event.error,
              etaSeconds: event.etaSeconds,
              manifestUrl: videoManifestUrl,
              message: event.message,
              mode: 'local-plan',
              requestId,
              speedBps: event.speedBps,
              stage: event.stage,
              status: event.status,
              tabId: normalizedTabId,
              totalFragments: event.totalFragments || totalFragments,
            })
          },
          onProgress: (progress) => {
            emitEmbeddedBrowserHlsTask({
              completedFragments: totalFragments,
              durationSeconds: taskDurationSeconds,
              ffmpegSpeedText: progress.speedText,
              manifestUrl: videoManifestUrl,
              message: '正在通过 ffmpeg 合并本地视频和音轨',
              mode: 'local-plan',
              processedSeconds: progress.processedSeconds,
              requestId,
              stage: 'ffmpeg',
              status: 'running',
              tabId: normalizedTabId,
              totalFragments,
            })
          },
          outputPath: resolvedOutputPath,
          signal,
          video: {
            fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, video.authority.resourceId),
            plan: video.plan,
          },
          workDirectoryPath: localWorkDirectoryPath,
        })
      })

      emitEmbeddedBrowserHlsTask({
        completedFragments: totalFragments,
        durationSeconds: taskDurationSeconds,
        manifestUrl: videoManifestUrl,
        message: 'HLS 视频/音轨合并完成',
        mode: taskMode,
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
        totalFragments,
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitEmbeddedBrowserHlsTask({
        durationSeconds: taskDurationSeconds,
        error: message,
        manifestUrl: videoManifestUrl,
        message,
        mode: taskMode,
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
        totalFragments,
      })
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          cancelled: true,
          ok: false,
        }
      }
      return {
        error: message,
        ok: false,
      }
    } finally {
      if (localWorkDirectoryPath) {
        await rm(localWorkDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  async function handleEmbeddedBrowserHlsPlanDownload(
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
      workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-hls-download-'))
      const result = await defaultHlsTaskExecutor.executePlanToOutput({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, resourceId),
        ffmpegPath: payload.ffmpegPath,
        manualKeyBase64: payload.manualKeyBase64,
        onEvent: createEmbeddedBrowserHlsPlanTaskEventForwarder({
          onFailedFragments: failedFragments => {
            latestFailedFragments = failedFragments
          },
          plan: payload.plan,
          requestId,
          tabId: normalizedTabId,
          usingManualKey: Boolean(payload.manualKeyBase64),
        }),
        outputPath,
        plan: payload.plan,
        runFfmpeg: input => downloadEmbeddedBrowserManifestResource({
          ...input,
          kind: 'hls',
        }),
        signal: activeTask.signal,
        workDirectoryPath,
      })
      latestFailedFragments = undefined
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
    if (!authorityGrant) {
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

      const parentVariableAccess = captureRuntime?.access || null
      const recorder = new HlsLiveTask({
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
        resolveParentVariableList: requestedResourceId && parentVariableAccess
          ? signal => resolveHlsLiveParentVariableList(parentVariableAccess, {
              selectedManifestUrl: manifestUrl,
              signal,
              sourceResourceId: requestedResourceId,
              tabId: normalizedTabId,
            })
          : undefined,
        segmentQuery: typeof payload.segmentQuery === 'string' ? payload.segmentQuery : undefined,
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

    let stopResult: Awaited<ReturnType<HlsLiveTask['stop']>> | null = null
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
      const result = await defaultHlsTaskExecutor.executePlanToOutput({
        beforeCompleted: () => {
          embeddedBrowserHlsSessionOwner.takeRetry(requestId, normalizedTabId)
        },
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, session.resourceId),
        ffmpegPath: session.ffmpegPath,
        fragmentIndexes: session.failedFragments.map((value) => value - 1).filter((value) => value >= 0),
        manualKeyBase64: session.manualKeyBase64,
        onEvent: createEmbeddedBrowserHlsPlanTaskEventForwarder({
          onFailedFragments: failedFragments => {
            latestFailedFragments = failedFragments
          },
          plan: session.plan,
          requestId,
          tabId: normalizedTabId,
          usingManualKey: Boolean(session.manualKeyBase64),
        }),
        outputPath: session.outputPath,
        plan: session.plan,
        runFfmpeg: input => downloadEmbeddedBrowserManifestResource({
          ...input,
          kind: 'hls',
        }),
        signal: activeTask.signal,
        workDirectoryPath: session.workDirectoryPath,
      })
      latestFailedFragments = undefined
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

  async function startEmbeddedBrowserDashRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserDashRecordingStartPayload,
  ): Promise<EmbeddedBrowserDashRecordingStartResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestedManifestUrl = String(payload.manifestUrl || '').trim()
    const requestedResourceId = String(payload.resourceId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    if (!normalizedTabId || !requestId || !requestedResourceId || !/^https?:\/\//i.test(requestedManifestUrl)) {
      return { error: '缺少可录制的 DASH 直播 manifest', ok: false }
    }

    const exactResourceId = captureRuntime?.resolveResourceIdByUrl(normalizedTabId, requestedManifestUrl)
    const authorityResourceId = exactResourceId || requestedResourceId
    const manifestAuthority = resolveDashManifestAuthority(captureRuntime?.access || null, {
      manifestUrl: requestedManifestUrl,
      resourceId: authorityResourceId,
      tabId: normalizedTabId,
    })
    if (!manifestAuthority) {
      return { error: 'DASH 直播捕捉资源已过期或不属于当前页面', ok: false }
    }
    const manifestUrl = manifestAuthority.manifestUrl
    const manifestHeaders = manifestAuthority.headers
    if (embeddedBrowserDashSessionOwner.findLiveByTab(normalizedTabId)) {
      return { error: '当前 tab 仍有未完成的 DASH 直播录制，请先停止或清理', ok: false }
    }

    let workDirectoryPath = ''
    try {
      const suggestedFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, 'mpd')
      const outputPath = await resolveEmbeddedBrowserOutputPath({
        defaultFileName: suggestedFileName,
        filters: [{ extensions: ['mp4', 'm4a', 'webm'], name: '媒体文件' }],
        outputDirectoryPath: payload.outputDirectoryPath,
        useSystemSaveDialog: payload.useSystemSaveDialog,
      })
      if (!outputPath) return { cancelled: true, ok: false }

      workDirectoryPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-dash-live-'))
      const initializedRepresentations = new Set<string>()
      let selectedVideoId = String(payload.selectedVideoRepresentationId || '').trim() || undefined
      let selectedAudioId = String(payload.selectedAudioRepresentationId || '').trim() || undefined
      let trackBytes = 0
      let trackPromise = Promise.resolve()
      const task = new DashLiveTask({
        loadSnapshot: createDashLiveSnapshotLoader({
          fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, authorityResourceId),
          headers: manifestHeaders,
          manifestUrl,
        }),
        onTerminalError: () => {
          void embeddedBrowserDashSessionOwner.clearLive({ requestId, tabId: normalizedTabId })
        },
        onEvent: (event) => emitEmbeddedBrowserDashTask({
          bytesReceived: trackBytes,
          completedSegments: event.completedSegments,
          durationSeconds: event.durationSeconds,
          error: event.error,
          manifestUrl,
          message: event.message,
          requestId,
          stage: event.stage,
          status: event.status,
          tabId: normalizedTabId,
          totalSegments: event.totalSegments,
        }),
        onNewSegments: async (delta, signal) => {
          const videoRepresentations = delta.plan.representations.filter(item => item.contentType === 'video')
          const audioRepresentations = delta.plan.representations.filter(item => item.contentType === 'audio')
          selectedVideoId = selectedVideoId || videoRepresentations[0]?.id
          selectedAudioId = selectedAudioId || audioRepresentations[0]?.id
          if (!selectedVideoId && !selectedAudioId) throw new Error('当前 DASH MPD 没有可录制的音视频轨道')
          if (selectedVideoId && !videoRepresentations.some(item => item.id === selectedVideoId)) {
            throw new Error(`请求的 DASH video Representation 不存在：${selectedVideoId}`)
          }
          if (selectedAudioId && !audioRepresentations.some(item => item.id === selectedAudioId)) {
            throw new Error(`请求的 DASH audio Representation 不存在：${selectedAudioId}`)
          }
          const selected = delta.representations.filter(item => item.id === selectedVideoId || item.id === selectedAudioId)
          trackPromise = trackPromise.then(async () => {
            for (const representation of selected) {
              const trackPath = path.join(workDirectoryPath, `${representation.contentType}-track.bin`)
              const result = await appendDashRepresentationSegments(representation, trackPath, {
                appendInitialization: !initializedRepresentations.has(representation.id),
                fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, authorityResourceId),
                headers: manifestHeaders,
                signal,
              })
              initializedRepresentations.add(representation.id)
              trackBytes += result.bytesReceived
            }
          })
          await trackPromise
        },
      })
      const recorder = {
        discard: () => task.discard(),
        getCurrentWorkDirectoryPath: () => workDirectoryPath,
      }
      embeddedBrowserDashSessionOwner.upsertLive({
        audioRepresentationId: selectedAudioId,
        ffmpegPath: payload.ffmpegPath,
        manifestUrl,
        outputPath,
        recorder,
        requestId,
        task,
        tabId: normalizedTabId,
        videoRepresentationId: selectedVideoId,
        workDirectoryPath,
      })
      emitEmbeddedBrowserDashTask({
        manifestUrl,
        message: '开始准备 DASH 直播录制任务',
        requestId,
        stage: 'preparing',
        status: 'running',
        tabId: normalizedTabId,
      })
      await task.start()
      const currentPlan = task.getCurrentPlan()
      if (!currentPlan || (!selectedVideoId && !selectedAudioId)) {
        throw new Error('当前 DASH MPD 没有可录制的音视频轨道')
      }
      if (selectedVideoId && !currentPlan.representations.some(item => item.id === selectedVideoId && item.contentType === 'video' && item.segments.length > 0)) {
        throw new Error(`请求的 DASH video Representation 不存在：${selectedVideoId}`)
      }
      if (selectedAudioId && !currentPlan.representations.some(item => item.id === selectedAudioId && item.contentType === 'audio' && item.segments.length > 0)) {
        throw new Error(`请求的 DASH audio Representation 不存在：${selectedAudioId}`)
      }
      const session = embeddedBrowserDashSessionOwner.getLive(requestId, normalizedTabId)
      if (session) {
        session.audioRepresentationId = selectedAudioId
        session.videoRepresentationId = selectedVideoId
      }
      emitEmbeddedBrowserDashTask({
        bytesReceived: trackBytes,
        manifestUrl,
        message: 'DASH 直播录制已开始，继续等待你手动停止',
        requestId,
        stage: 'downloading',
        status: 'running',
        tabId: normalizedTabId,
      })
      return { ok: true, requestId }
    } catch (error) {
      await embeddedBrowserDashSessionOwner.clear({ requestId, tabId: normalizedTabId })
      if (workDirectoryPath) await rm(workDirectoryPath, { force: true, recursive: true }).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      emitEmbeddedBrowserDashTask({
        error: message,
        manifestUrl: requestedManifestUrl,
        message,
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
      })
      return { error: message, ok: false }
    }
  }

  async function stopEmbeddedBrowserDashRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserDashRecordingStopPayload,
  ): Promise<EmbeddedBrowserDashRecordingStopResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    const session = requestId ? embeddedBrowserDashSessionOwner.getLive(requestId, normalizedTabId) : undefined
    if (!normalizedTabId || !requestId || !session) return { error: 'DASH 直播录制任务不存在或已结束', ok: false }

    let activeTask: { complete: () => void; signal: AbortSignal } | undefined
    let stopped: Awaited<ReturnType<DashLiveTask['stop']>> | undefined
    try {
      activeTask = embeddedBrowserDashSessionOwner.beginActiveTask({ requestId, tabId: normalizedTabId })
      emitEmbeddedBrowserDashTask({
        manifestUrl: session.manifestUrl,
        message: '正在停止 DASH 直播录制并整理轨道',
        requestId,
        stage: 'stopped',
        status: 'running',
        tabId: normalizedTabId,
      })
      stopped = await session.task.stop()
      const plan = stopped.plan
      const videoRepresentation = session.videoRepresentationId
        ? plan.representations.find(item => item.id === session.videoRepresentationId)
        : undefined
      const audioRepresentation = session.audioRepresentationId
        ? plan.representations.find(item => item.id === session.audioRepresentationId)
        : undefined
      if (!videoRepresentation && !audioRepresentation) throw new Error('DASH 录制没有生成可合并的轨道')
      emitEmbeddedBrowserDashTask({
        completedSegments: stopped.totalSegments,
        durationSeconds: plan.durationSeconds,
        manifestUrl: session.manifestUrl,
        message: 'DASH 轨道已完成，开始交给 ffmpeg',
        requestId,
        stage: 'merging',
        status: 'running',
        tabId: normalizedTabId,
        totalSegments: stopped.totalSegments,
      })
      const result = await mergeDashTaskTracksToOutput({
        audio: audioRepresentation ? { path: path.join(session.workDirectoryPath || '', 'audio-track.bin'), representation: audioRepresentation } : undefined,
        durationSeconds: plan.durationSeconds,
        ffmpegPath: session.ffmpegPath,
        outputPath: session.outputPath,
        signal: activeTask.signal,
        video: videoRepresentation ? { path: path.join(session.workDirectoryPath || '', 'video-track.bin'), representation: videoRepresentation } : undefined,
      })
      emitEmbeddedBrowserDashTask({
        completedSegments: stopped.totalSegments,
        durationSeconds: plan.durationSeconds,
        manifestUrl: session.manifestUrl,
        message: 'DASH 直播录制文件已完成',
        outputPath: result.outputPath,
        requestId,
        stage: 'completed',
        status: 'success',
        tabId: normalizedTabId,
        totalSegments: stopped.totalSegments,
      })
      embeddedBrowserDashSessionOwner.takeLive(requestId, normalizedTabId)
      await rm(session.workDirectoryPath || '', { force: true, recursive: true }).catch(() => undefined)
      return { ffmpegPath: result.ffmpegPath, ok: true, outputPath: result.outputPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitEmbeddedBrowserDashTask({
        error: message,
        manifestUrl: session.manifestUrl,
        message,
        requestId,
        stage: 'error',
        status: 'error',
        tabId: normalizedTabId,
      })
      if (!stopped) await embeddedBrowserDashSessionOwner.clear({ requestId, tabId: normalizedTabId })
      if (activeTask?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return { cancelled: true, ok: false }
      return { error: message, ok: false }
    } finally {
      activeTask?.complete()
    }
  }

  async function discardEmbeddedBrowserDashRecordingResource(
    tabId: string,
    payload: EmbeddedBrowserDashRecordingDiscardPayload,
  ): Promise<EmbeddedBrowserDashRecordingDiscardResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const requestId = String(payload.requestId || '').trim()
    if (!normalizedTabId || !requestId) return { error: '缺少可清理的 DASH 直播录制任务', ok: false }
    await embeddedBrowserDashSessionOwner.clear({ requestId, tabId: normalizedTabId })
    return { ok: true }
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
    const taskPlan = toDashTaskPlan(plan)
    if (taskPlan.hasDrm) {
      return {
        error: '当前 DASH 检测到 DRM，暂不支持下载',
        ok: false,
      }
    }
    if (taskPlan.unsupportedReasons?.length) {
      return {
        error: `当前 DASH 计划暂不可下载：${taskPlan.unsupportedReasons[0]}`,
        ok: false,
      }
    }
    const selectedVideoRepresentation = String(payload.selectedVideoRepresentationId || '').trim()
      ? taskPlan.representations.find((item) => item.id === String(payload.selectedVideoRepresentationId || '').trim())
      : undefined
    const selectedAudioRepresentation = String(payload.selectedAudioRepresentationId || '').trim()
      ? taskPlan.representations.find((item) => item.id === String(payload.selectedAudioRepresentationId || '').trim())
      : undefined

    if (!selectedVideoRepresentation && !selectedAudioRepresentation) {
      return {
        error: '至少需要选择一条 MPD 轨道',
        ok: false,
      }
    }

    let activeTask: {
      complete: () => void
      signal: AbortSignal
    } | undefined
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

      activeTask = embeddedBrowserHlsSessionOwner.beginActiveTask({
        requestId,
        tabId: normalizedTabId,
      })
      const executor = new DashTaskExecutor({
        fetch: createEmbeddedBrowserCapturedResourceFetch(normalizedTabId, resourceId),
        mergeTracks: input => mergeDashTaskTracksToOutput({
          ...input,
          durationSeconds: taskPlan.durationSeconds,
          ffmpegPath: payload.ffmpegPath,
        }),
        outputPath,
        plan: taskPlan,
        selectedAudioRepresentation,
        selectedVideoRepresentation,
        signal: activeTask.signal,
      })
      const result = await executor.run()
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
      if (activeTask?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
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
        void enqueueEmbeddedBrowserMseControl(navigatedTabId, async () => {
          await clearEmbeddedBrowserMseSpoolFiles({ tabId: navigatedTabId })
        })
        void embeddedBrowserHlsHostLifecycle.onDocumentNavigated(navigatedTabId)
        void embeddedBrowserDashHostLifecycle.onDocumentNavigated(navigatedTabId)
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
        void defaultProcessingTaskRegistry.cancel({ tabId: destroyedTabId })
        void enqueueEmbeddedBrowserMseControl(destroyedTabId, async () => {
          await clearEmbeddedBrowserMseSpoolFiles({ tabId: destroyedTabId })
        })
        void embeddedBrowserHlsHostLifecycle.onViewDestroyed(destroyedTabId)
        void embeddedBrowserDashHostLifecycle.onViewDestroyed(destroyedTabId)
      },
      onViewRenderProcessGone: (crashedTabId) => {
        void defaultProcessingTaskRegistry.cancel({ tabId: crashedTabId })
        void enqueueEmbeddedBrowserMseControl(crashedTabId, async () => {
          await clearEmbeddedBrowserMseSpoolFiles({ tabId: crashedTabId })
        })
        void embeddedBrowserHlsHostLifecycle.onViewRenderProcessGone(crashedTabId)
        void embeddedBrowserDashHostLifecycle.onViewRenderProcessGone(crashedTabId)
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

  async function closeEmbeddedBrowserTab(targetWindow: BrowserWindow | null, tabId: string) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedTabId) {
      return
    }
    const transferCleanupPromise = defaultProcessingTaskRegistry.cancel({ tabId: normalizedTabId })
    const hlsCleanupPromise = embeddedBrowserHlsHostLifecycle.onTabClosed(normalizedTabId)
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
    await enqueueEmbeddedBrowserMseControl(normalizedTabId, async () => {
      await clearEmbeddedBrowserMseSpoolFiles({ tabId: normalizedTabId })
    })
    if (view) {
      if (targetWindow.contentView.children.includes(view)) {
        targetWindow.contentView.removeChildView(view)
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close({ waitForBeforeUnload: false })
      }
    }
    await transferCleanupPromise
    await hlsCleanupPromise
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
    await closeEmbeddedBrowserTab(targetWindow, normalizedTabId)
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
        if (action === 'downloadCatchMedia') {
          const downloadedFromMain = await downloadEmbeddedBrowserMseResourcesToDownloads(tabId, view)
          if (downloadedFromMain) {
            return true
          }
        }
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

  async function handleCloseTab(sender: Electron.WebContents, tabId: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    await closeEmbeddedBrowserTab(targetWindow, tabId)
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

  async function handleCloseAll(sender: Electron.WebContents) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    for (const tabId of embeddedBrowserLibraryFileDropRequests.keys()) {
      cancelEmbeddedBrowserLibraryFileDropRequests(tabId)
    }
    await Promise.all(
      Array.from(embeddedBrowserViews.keys()).map((tabId) => (
        closeEmbeddedBrowserTab(targetWindow, tabId)
      )),
    )
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
      startDashRecording: startEmbeddedBrowserDashRecordingResource,
      stopDashRecording: stopEmbeddedBrowserDashRecordingResource,
      discardDashRecording: discardEmbeddedBrowserDashRecordingResource,
      downloadHlsTracks: downloadEmbeddedBrowserHlsTracksResource,
      downloadHlsPlan: handleEmbeddedBrowserHlsPlanDownload,
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
      listHlsTaskSnapshots: (tabId) => embeddedBrowserHlsSessionOwner.listTaskSnapshots({ tabId }),
      listDashTaskSnapshots: (tabId) => embeddedBrowserDashSessionOwner.listTaskSnapshots({ tabId }),
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
      getResourceCaptureRules: async () => listEmbeddedBrowserCaptureSettings(),
      updateResourceCaptureRules: async (ruleSet) => {
        const next = updateEmbeddedBrowserCaptureSettings(ruleSet)
        captureRuntime?.updateCaptureSettings(compileOmniFlowCaptureSettings(next))
        return next
      },
      resetResourceCaptureRules: async () => {
        const next = resetEmbeddedBrowserCaptureSettings()
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

  async function dispose() {
    const hlsCleanupPromise = embeddedBrowserHlsHostLifecycle.dispose()
    const dashCleanupPromise = embeddedBrowserDashHostLifecycle.dispose()
    captureRuntime?.dispose()
    captureRuntime = null
    await Promise.allSettled(Array.from(embeddedBrowserMseControlQueues.values()))
    embeddedBrowserMseControlQueues.clear()
    await embeddedBrowserMseSpoolStore.dispose()
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
    await hlsCleanupPromise
    await dashCleanupPromise
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

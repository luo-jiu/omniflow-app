import path from 'node:path'
import { access, mkdir } from 'node:fs/promises'
import { app, BrowserWindow, dialog, WebContentsView, type WebFrameMain } from 'electron'
import { runtimeLogger } from '../runtimeLogger'
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
import {
  type EmbeddedBrowserBounds,
  type EmbeddedBrowserCapturedResourceMergePayload,
  type EmbeddedBrowserCapturedResourceMergeResponse,
  type EmbeddedBrowserCapturedResourceSavePayload,
  type EmbeddedBrowserCapturedResourceSaveResponse,
  type EmbeddedBrowserCapturedResourceTranscodePayload,
  type EmbeddedBrowserCapturedResourceTranscodeResponse,
  type EmbeddedBrowserHlsDownloadPayload,
  type EmbeddedBrowserHlsDownloadResponse,
  type EmbeddedBrowserMainControllerOptions,
  type EmbeddedBrowserMpdDownloadPayload,
  type EmbeddedBrowserMpdDownloadResponse,
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
  extractEmbeddedBrowserResourceFromPage,
  runEmbeddedBrowserResourcePreview,
  runEmbeddedBrowserResourceProbeAction,
} from './embeddedBrowserResourceActionService'
import {
  type EmbeddedBrowserResourcePreviewPayload,
} from './embeddedBrowserResourcePageBridge'
import {
  cleanupEmbeddedBrowserDownloadFile,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import {
  clearEmbeddedBrowserCapturedResources,
  disposeEmbeddedBrowserCapturedResources,
  getEmbeddedBrowserResourceCaptureSnapshot,
  isEmbeddedBrowserDeepCaptureEnabled,
  startEmbeddedBrowserDeepResourceCapture,
  startEmbeddedBrowserResourceCapture,
  stopEmbeddedBrowserResourceCapture,
  type EmbeddedBrowserCapturedResource,
} from './embeddedBrowserResourceService'
import {
  buildEmbeddedBrowserProbeResourceRecorder,
  createEmbeddedBrowserView as createEmbeddedBrowserManagedView,
  installEmbeddedBrowserResourceProbe,
} from './embeddedBrowserViewLifecycle'
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
  type EmbeddedBrowserManifestDownloadKind,
} from './embeddedBrowserResourceManifestDownloadService'
import {
  cleanupEmbeddedBrowserOpenFile,
  stageEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'

export function createEmbeddedBrowserMainController(
  options: EmbeddedBrowserMainControllerOptions,
) {
  const embeddedBrowserViews = new Map<string, WebContentsView>()
  const embeddedBrowserLastCommittedUrls = new Map<string, string>()
  const embeddedBrowserIconUrls = new Map<string, string>()
  const embeddedBrowserIconSourceUrls = new Map<string, string>()
  const embeddedBrowserPendingOpenFiles = new Map<string, EmbeddedBrowserPendingOpenFile>()
  const embeddedBrowserAttachedOpenFiles = new Map<string, string>()
  const embeddedBrowserOpenFileRequestVersions = new Map<string, number>()
  const embeddedBrowserFileSystemOriginDecisions = new Map<string, boolean>()
  let activeEmbeddedBrowserTabId: string | null = null
  let embeddedBrowserPendingBounds: EmbeddedBrowserBounds | null = null
  let embeddedBrowserSessionConfigured = false

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

  function emitEmbeddedBrowserResource(payload: EmbeddedBrowserCapturedResource) {
    const mainWindow = options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('embedded-browser:resource', payload)
  }

  function resolveEmbeddedBrowserTabIdByWebContents(targetContents: Electron.WebContents) {
    for (const [tabId, view] of embeddedBrowserViews.entries()) {
      if (view.webContents === targetContents) {
        return tabId
      }
    }
    return null
  }

  function resolveEmbeddedBrowserTabIdByWebContentsId(targetWebContentsId: number) {
    for (const [tabId, view] of embeddedBrowserViews.entries()) {
      if (view.webContents.id === targetWebContentsId) {
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
    configureEmbeddedBrowserSession({
      decisionCache: embeddedBrowserFileSystemOriginDecisions,
      options,
    })
  }

  function initializeBridges() {
    initializeEmbeddedBrowserMainBridges({
      emitDownload: emitEmbeddedBrowserDownload,
      emitResource: emitEmbeddedBrowserResource,
      resolveTabIdByWebContents: resolveEmbeddedBrowserTabIdByWebContents,
      resolveTabIdByWebContentsId: resolveEmbeddedBrowserTabIdByWebContentsId,
    })
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
      disposeEmbeddedBrowserCapturedResources(tabId)
      return null
    }
    return view
  }

  async function tryInstallEmbeddedBrowserResourceProbe(tabId: string, view: WebContentsView) {
    return installEmbeddedBrowserResourceProbe(
      tabId,
      view,
      isEmbeddedBrowserDeepCaptureEnabled,
    )
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

  async function extractEmbeddedBrowserResourceFromFrames(
    view: WebContentsView,
    resourceKey: string,
  ) {
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

  async function mergeEmbeddedBrowserCapturedMseResources(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceMergePayload,
  ): Promise<EmbeddedBrowserCapturedResourceMergeResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const audioResourceKey = String(payload.audioResourceKey || payload.audioResource?.resourceKey || '').trim()
    const videoResourceKey = String(payload.videoResourceKey || payload.videoResource?.resourceKey || '').trim()
    const createPayloadMergeResource = (
      input: EmbeddedBrowserCapturedResourceMergePayload['audioResource'],
      fallbackStreamType: 'audio' | 'video',
    ): EmbeddedBrowserExtractedResourceFile | null => {
      const url = String(input?.url || '').trim()
      if (!url) {
        return null
      }
      let fileName = String(input?.fileName || '').trim()
      if (!fileName) {
        try {
          fileName = decodeURIComponent(path.basename(new URL(url).pathname))
        } catch {
          fileName = ''
        }
      }
      return {
        fileName: fileName || `${fallbackStreamType}.m4s`,
        mimeType: input?.mimeType,
        requestHeaders: input?.requestHeaders,
        resourceKey: input?.resourceKey,
        streamType: input?.streamType || fallbackStreamType,
        url,
      }
    }
    if (
      !normalizedTabId
      || (!audioResourceKey && !payload.audioResource?.url)
      || (!videoResourceKey && !payload.videoResource?.url)
    ) {
      return {
        error: '缺少要合并的音频或视频资源',
        ok: false,
      }
    }

    try {
      let audioResource = createPayloadMergeResource(payload.audioResource, 'audio')
      let videoResource = createPayloadMergeResource(payload.videoResource, 'video')
      if (audioResourceKey || videoResourceKey) {
        const extractedResources = await withEmbeddedBrowserView(
          normalizedTabId,
          async (view) => Promise.all([
            audioResourceKey ? extractEmbeddedBrowserResourceFromFrames(view, audioResourceKey) : null,
            videoResourceKey ? extractEmbeddedBrowserResourceFromFrames(view, videoResourceKey) : null,
          ]),
        )
        audioResource = extractedResources?.[0] || audioResource
        videoResource = extractedResources?.[1] || videoResource
      }
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
        audioResourceKey,
        error: error instanceof Error ? error.message : String(error),
        tabId: normalizedTabId,
        videoResourceKey,
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
    const resourceKey = String(payload.resourceKey || '').trim()
    if (!normalizedTabId || !resourceKey) {
      return {
        error: '缺少要保存的捕捉资源',
        ok: false,
      }
    }

    try {
      const resource = await withEmbeddedBrowserView(
        normalizedTabId,
        async (view) => extractEmbeddedBrowserResourceFromFrames(view, resourceKey),
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
        resourceKey,
        tabId: normalizedTabId,
      })
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  function createPayloadTranscodeResource(
    input: EmbeddedBrowserCapturedResourceTranscodePayload['resource'],
  ): EmbeddedBrowserExtractedResourceFile | null {
    const url = String(input?.url || '').trim()
    if (!url) {
      return null
    }
    let fileName = String(input?.fileName || '').trim()
    if (!fileName) {
      try {
        fileName = decodeURIComponent(path.basename(new URL(url).pathname))
      } catch {
        fileName = ''
      }
    }
    return {
      fileName: fileName || 'media',
      mimeType: input?.mimeType,
      requestHeaders: input?.requestHeaders,
      resourceKey: input?.resourceKey,
      streamType: input?.streamType,
      url,
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
    const resourceKey = String(payload.resourceKey || payload.resource?.resourceKey || '').trim()
    const outputFormat = normalizeEmbeddedBrowserResourceTranscodeFormat(payload.outputFormat || 'mp4')
    if (!normalizedTabId || (!resourceKey && !payload.resource?.url)) {
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
      let resource = createPayloadTranscodeResource(payload.resource)
      if (resourceKey) {
        const extractedResource = await withEmbeddedBrowserView(
          normalizedTabId,
          async (view) => extractEmbeddedBrowserResourceFromFrames(view, resourceKey),
        )
        resource = extractedResource || resource
      }
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
        resourceKey,
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
    const manifestUrl = String(payload.manifestUrl || '').trim()
    if (!normalizedTabId || !manifestUrl) {
      return {
        error: kind === 'hls' ? '缺少要下载的 m3u8 地址' : '缺少要下载的 mpd 地址',
        ok: false,
      }
    }

    try {
      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserManifestOutputFileName(manifestUrl, kind)
      const mainWindow = options.getMainWindow()
      const targetWindow = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined
      const saveDialogOptions = {
        defaultPath: path.join(app.getPath('downloads'), defaultFileName),
        filters: [
          { extensions: ['mp4'], name: 'MP4 Video' },
        ],
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

      const result = await downloadEmbeddedBrowserManifestResource({
        ffmpegPath: payload.ffmpegPath,
        headers: payload.headers,
        kind,
        manifestUrl,
        outputPath: saveResult.filePath,
      })
      return {
        ffmpegPath: result.ffmpegPath,
        ok: true,
        outputPath: result.outputPath,
      }
    } catch (error) {
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

  async function downloadEmbeddedBrowserMpdResource(
    tabId: string,
    payload: EmbeddedBrowserMpdDownloadPayload,
  ): Promise<EmbeddedBrowserMpdDownloadResponse> {
    return downloadEmbeddedBrowserManifestResourceForRenderer(tabId, payload, 'mpd')
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
    return createEmbeddedBrowserManagedView({
      createIfMissingProbe: tryInstallEmbeddedBrowserResourceProbe,
      currentUrls: embeddedBrowserLastCommittedUrls,
      debugEnabled: options.debugEnabled,
      emitTabState: emitEmbeddedBrowserTabState,
      iconSourceUrls: embeddedBrowserIconSourceUrls,
      iconUrls: embeddedBrowserIconUrls,
      onProbePayload: buildEmbeddedBrowserProbeResourceRecorder(tabId),
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
    const view = getEmbeddedBrowserView(normalizedTabId)
    if (!view) {
      return
    }
    if (targetWindow.contentView.children.includes(view)) {
      targetWindow.contentView.removeChildView(view)
    }
    if (activeEmbeddedBrowserTabId === normalizedTabId) {
      activeEmbeddedBrowserTabId = null
    }
    embeddedBrowserViews.delete(normalizedTabId)
    embeddedBrowserLastCommittedUrls.delete(normalizedTabId)
    embeddedBrowserIconUrls.delete(normalizedTabId)
    embeddedBrowserIconSourceUrls.delete(normalizedTabId)
    disposeEmbeddedBrowserCapturedResources(normalizedTabId)
    bumpEmbeddedBrowserOpenFileRequestVersion({
      requestVersions: embeddedBrowserOpenFileRequestVersions,
      tabId: normalizedTabId,
    })
    cleanupEmbeddedBrowserOpenFileForTab({
      attachedOpenFiles: embeddedBrowserAttachedOpenFiles,
      pendingOpenFiles: embeddedBrowserPendingOpenFiles,
      tabId: normalizedTabId,
    })
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async function handleOpenTab(sender: Electron.WebContents, tabId: string, url?: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
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
    activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false })
  }

  async function handleNavigate(sender: Electron.WebContents, tabId: string, url: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
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
    const previousCaptureState = getEmbeddedBrowserResourceCaptureSnapshot(normalizedTabId)
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
    if (previousCaptureState.deepCaptureEnabled) {
      startEmbeddedBrowserDeepResourceCapture(normalizedTabId)
    } else if (previousCaptureState.enabled) {
      startEmbeddedBrowserResourceCapture(normalizedTabId)
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

  async function handleOpenResource(tabId: string, resourceKey: string) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            'openResource',
            resourceKey,
          )
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              'openResource',
              resourceKey,
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
          resourceKey: String(resourceKey || '').trim(),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleExportResource(tabId: string, resourceKey: string) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        const frames = getEmbeddedBrowserFrameList(view)
        if (!frames.length) {
          return await runEmbeddedBrowserResourceProbeAction(
            (script) => view.webContents.executeJavaScript(script, true),
            'exportResource',
            resourceKey,
          )
        }
        const results = await Promise.all(frames.map(async (frame) => {
          try {
            return await runEmbeddedBrowserResourceProbeAction(
              (script) => frame.executeJavaScript(script, true),
              'exportResource',
              resourceKey,
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
          resourceKey: String(resourceKey || '').trim(),
          tabId: String(tabId || '').trim(),
          url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
        })
        return false
      }
    }).then((result) => Boolean(result))
  }

  async function handleReadResource(tabId: string, resourceKey: string) {
    return withEmbeddedBrowserView(tabId, async (view) => {
      try {
        return await extractEmbeddedBrowserResourceFromFrames(view, resourceKey)
      } catch (error) {
        runtimeLogger.warn('embedded browser resource read failed', {
          error: error instanceof Error ? error.message : String(error),
          resourceKey: String(resourceKey || '').trim(),
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
    const snapshot = startEmbeddedBrowserDeepResourceCapture(normalizedTabId)
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

  function handleDeactivate(sender: Electron.WebContents) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    detachActiveEmbeddedBrowserView(targetWindow)
  }

  function handleCloseAll(sender: Electron.WebContents) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    Array.from(embeddedBrowserViews.keys()).forEach((tabId) => {
      closeEmbeddedBrowserTab(targetWindow, tabId)
    })
    activeEmbeddedBrowserTabId = null
    emitEmbeddedBrowserState({ state: 'idle' })
  }

  function registerIpcHandlers() {
    registerEmbeddedBrowserMainIpcHandlers({
      activateTab: handleActivateTab,
      cleanupDownloadFile: handleCleanupDownloadFile,
      clearBrowserCache: handleClearCacheAndReload,
      clearCapturedResources: (tabId) => clearEmbeddedBrowserCapturedResources(String(tabId || '').trim()),
      clearCatchMediaCache: (tabId) => handleCatchToolkitAction(tabId, 'clearCatchMediaCache', 'clear cache'),
      closeAll: handleCloseAll,
      closeTab: handleCloseTab,
      deactivate: handleDeactivate,
      downloadCatchMedia: (tabId) => handleCatchToolkitAction(tabId, 'downloadCatchMedia', 'download'),
      downloadHlsManifest: downloadEmbeddedBrowserHlsResource,
      downloadMpdManifest: downloadEmbeddedBrowserMpdResource,
      exportResource: handleExportResource,
      getCatchToolkitState: handleGetCatchToolkitState,
      goBack: handleGoBack,
      goForward: handleGoForward,
      listCapturedResources: (tabId) => getEmbeddedBrowserResourceCaptureSnapshot(String(tabId || '').trim()),
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
      startCapturedResources: (tabId) => startEmbeddedBrowserResourceCapture(String(tabId || '').trim()),
      startDeepResourceCapture: handleStartDeepResourceCapture,
      stopCapturedResources: (tabId) => stopEmbeddedBrowserResourceCapture(String(tabId || '').trim()),
      transcodeResource: transcodeEmbeddedBrowserCapturedResourceForRenderer,
      updateCatchToolkitState: handleUpdateCatchToolkitState,
      getCookies: getEmbeddedBrowserCookies,
      removeCookie: removeEmbeddedBrowserCookie,
      removeCookiesByDomain: removeEmbeddedBrowserCookiesByDomain,
      removeAllCookies: removeAllEmbeddedBrowserCookies,
    })
  }

  return {
    configureSession,
    initializeBridges,
    registerIpcHandlers,
  }
}

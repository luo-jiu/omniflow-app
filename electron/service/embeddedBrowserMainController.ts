import path from 'node:path'
import { app, BrowserWindow, dialog, WebContentsView } from 'electron'
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
  type EmbeddedBrowserBounds,
  type EmbeddedBrowserCapturedResourceMergePayload,
  type EmbeddedBrowserCapturedResourceMergeResponse,
  type EmbeddedBrowserMainControllerOptions,
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
  deriveEmbeddedBrowserMergedFileName,
  mergeEmbeddedBrowserResourceTracks,
} from './embeddedBrowserResourceMergeService'
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

  async function mergeEmbeddedBrowserCapturedMseResources(
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceMergePayload,
  ): Promise<EmbeddedBrowserCapturedResourceMergeResponse> {
    const normalizedTabId = String(tabId || '').trim()
    const audioResourceKey = String(payload.audioResourceKey || '').trim()
    const videoResourceKey = String(payload.videoResourceKey || '').trim()
    if (!normalizedTabId || !audioResourceKey || !videoResourceKey) {
      return {
        error: '缺少要合并的音频或视频资源',
        ok: false,
      }
    }

    try {
      const extractedResources = await withEmbeddedBrowserResourceScriptExecutor(
        normalizedTabId,
        async (executeScript) => Promise.all([
          extractEmbeddedBrowserResourceFromPage(executeScript, audioResourceKey),
          extractEmbeddedBrowserResourceFromPage(executeScript, videoResourceKey),
        ]),
      )
      const [audioResource, videoResource] = extractedResources || []
      if (!audioResource || !videoResource) {
        return {
          error: '当前页面里的音频或视频轨还没有整理完成，先继续播放几秒再试试',
          ok: false,
        }
      }

      const defaultFileName = String(payload.suggestedFileName || '').trim()
        || deriveEmbeddedBrowserMergedFileName(videoResource.fileName, audioResource.fileName)
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

      const mergeResult = await mergeEmbeddedBrowserResourceTracks({
        audio: audioResource,
        ffmpegPath: payload.ffmpegPath,
        outputPath: saveResult.filePath,
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
    view.webContents.reload()
    emitEmbeddedBrowserTabSnapshot(normalizedTabId, view, {
      details: 'reload-requested',
    })
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
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
      try {
        return await runEmbeddedBrowserResourceProbeAction(executeScript, 'openResource', resourceKey)
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
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
      try {
        return await runEmbeddedBrowserResourceProbeAction(executeScript, 'exportResource', resourceKey)
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
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
      try {
        return await getEmbeddedBrowserCatchToolkitState(executeScript)
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
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
      try {
        return await updateEmbeddedBrowserCatchToolkitState(executeScript, payload)
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
    return withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
      try {
        return await runEmbeddedBrowserCatchToolkitAction(executeScript, action)
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
        view.webContents.reload()
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
      clearCapturedResources: (tabId) => clearEmbeddedBrowserCapturedResources(String(tabId || '').trim()),
      clearCatchMediaCache: (tabId) => handleCatchToolkitAction(tabId, 'clearCatchMediaCache', 'clear cache'),
      closeAll: handleCloseAll,
      closeTab: handleCloseTab,
      deactivate: handleDeactivate,
      downloadCatchMedia: (tabId) => handleCatchToolkitAction(tabId, 'downloadCatchMedia', 'download'),
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
      reload: handleReload,
      resolveFavicon: resolveEmbeddedBrowserBookmarkFavicon,
      restartCatchMediaCapture: (tabId) => handleCatchToolkitAction(tabId, 'restartCatchMediaCapture', 'restart'),
      setBounds: handleSetBounds,
      startCapturedResources: (tabId) => startEmbeddedBrowserResourceCapture(String(tabId || '').trim()),
      startDeepResourceCapture: handleStartDeepResourceCapture,
      stopCapturedResources: (tabId) => stopEmbeddedBrowserResourceCapture(String(tabId || '').trim()),
      updateCatchToolkitState: handleUpdateCatchToolkitState,
    })
  }

  return {
    configureSession,
    initializeBridges,
    registerIpcHandlers,
  }
}

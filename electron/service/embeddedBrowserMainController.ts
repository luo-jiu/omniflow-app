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
  collectEmbeddedBrowserDebugMeta,
  configureEmbeddedBrowserSession,
  initializeEmbeddedBrowserMainBridges,
  loadEmbeddedBrowserFaviconDataUrl,
  resolveEmbeddedBrowserBookmarkFavicon,
} from './embeddedBrowserMainSupport'
import {
  extractEmbeddedBrowserResourceFromPage,
  runEmbeddedBrowserResourcePreview,
  runEmbeddedBrowserResourceProbeAction,
} from './embeddedBrowserResourceActionService'
import {
  type EmbeddedBrowserResourcePreviewPayload,
} from './embeddedBrowserResourcePageBridge'
import {
  EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
  createEmbeddedBrowserResourceProbeScript,
} from './embeddedBrowserResourceProbe'
import {
  EMBEDDED_BROWSER_PARTITION,
  cleanupEmbeddedBrowserDownloadFile,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import {
  clearEmbeddedBrowserCapturedResources,
  disposeEmbeddedBrowserCapturedResources,
  getEmbeddedBrowserResourceCaptureSnapshot,
  isEmbeddedBrowserDeepCaptureEnabled,
  recordEmbeddedBrowserProbeResource,
  startEmbeddedBrowserDeepResourceCapture,
  startEmbeddedBrowserResourceCapture,
  stopEmbeddedBrowserResourceCapture,
  type EmbeddedBrowserCapturedResource,
} from './embeddedBrowserResourceService'
import {
  deriveEmbeddedBrowserMergedFileName,
  mergeEmbeddedBrowserResourceTracks,
} from './embeddedBrowserResourceMergeService'
import {
  cleanupEmbeddedBrowserOpenFile,
  injectEmbeddedBrowserOpenFile,
  stageEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'

export function createEmbeddedBrowserMainController(
  options: EmbeddedBrowserMainControllerOptions,
) {
  const embeddedBrowserViews = new Map<string, WebContentsView>()
  const embeddedBrowserLastCommittedUrls = new Map<string, string>()
  const embeddedBrowserIconUrls = new Map<string, string>()
  const embeddedBrowserIconSourceUrls = new Map<string, string>()
  const embeddedBrowserPendingOpenFiles = new Map<string, {
    fileName: string
    pageUrl: string
    stagedPath: string
  }>()
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
    if (!isEmbeddedBrowserDeepCaptureEnabled(tabId) || view.webContents.isDestroyed()) {
      return false
    }
    try {
      await view.webContents.executeJavaScript(createEmbeddedBrowserResourceProbeScript(), true)
      return true
    } catch (error) {
      runtimeLogger.warn('embedded browser resource probe install failed', {
        error: error instanceof Error ? error.message : String(error),
        tabId,
        url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(tabId) || '',
      })
      return false
    }
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

  function cleanupEmbeddedBrowserOpenFileForTab(tabId: string) {
    const pending = embeddedBrowserPendingOpenFiles.get(tabId)
    if (pending?.stagedPath) {
      void cleanupEmbeddedBrowserOpenFile(pending.stagedPath).catch(() => undefined)
    }
    embeddedBrowserPendingOpenFiles.delete(tabId)

    const attachedPath = embeddedBrowserAttachedOpenFiles.get(tabId)
    if (attachedPath) {
      void cleanupEmbeddedBrowserOpenFile(attachedPath).catch(() => undefined)
    }
    embeddedBrowserAttachedOpenFiles.delete(tabId)
  }

  function bumpEmbeddedBrowserOpenFileRequestVersion(tabId: string) {
    const nextVersion = (embeddedBrowserOpenFileRequestVersions.get(tabId) ?? 0) + 1
    embeddedBrowserOpenFileRequestVersions.set(tabId, nextVersion)
    return nextVersion
  }

  function isEmbeddedBrowserOpenFileRequestCurrent(tabId: string, version: number) {
    return embeddedBrowserOpenFileRequestVersions.get(tabId) === version
  }

  function matchesEmbeddedBrowserOpenFileTargetPage(currentUrl: string, targetUrl: string) {
    try {
      const current = new URL(currentUrl)
      const target = new URL(targetUrl)
      if (current.origin !== target.origin) {
        return false
      }
      const normalizedCurrentPath = current.pathname.replace(/\/+$/, '') || '/'
      const normalizedTargetPath = target.pathname.replace(/\/+$/, '') || '/'
      if (normalizedTargetPath === '/') {
        return true
      }
      return (
        normalizedCurrentPath === normalizedTargetPath
        || normalizedCurrentPath.startsWith(`${normalizedTargetPath}/`)
      )
    } catch {
      return false
    }
  }

  async function tryDispatchPendingEmbeddedBrowserOpenFile(tabId: string, view: WebContentsView) {
    const pending = embeddedBrowserPendingOpenFiles.get(tabId)
    if (!pending || view.webContents.isDestroyed()) {
      return false
    }
    const currentUrl = view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(tabId) || ''
    if (!currentUrl) {
      return false
    }
    if (!matchesEmbeddedBrowserOpenFileTargetPage(currentUrl, pending.pageUrl)) {
      return false
    }

    try {
      const injected = await injectEmbeddedBrowserOpenFile(view, pending.stagedPath)
      if (!injected) {
        return false
      }
      const previousAttachedPath = embeddedBrowserAttachedOpenFiles.get(tabId)
      if (previousAttachedPath && previousAttachedPath !== pending.stagedPath) {
        void cleanupEmbeddedBrowserOpenFile(previousAttachedPath).catch(() => undefined)
      }
      embeddedBrowserAttachedOpenFiles.set(tabId, pending.stagedPath)
      embeddedBrowserPendingOpenFiles.delete(tabId)
      return true
    } catch {
      return false
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
    const existingView = getEmbeddedBrowserView(tabId)
    if (existingView) {
      return existingView
    }

    const view = new WebContentsView({
        webPreferences: {
          devTools: true,
          partition: EMBEDDED_BROWSER_PARTITION,
        },
    })
    view.webContents.setZoomFactor(1)
    const currentUserAgent = view.webContents.getUserAgent()
    if (currentUserAgent.includes('Electron')) {
      view.webContents.setUserAgent(
        currentUserAgent.replace(/\sElectron\/[^\s]+/g, ''),
      )
    }
    syncEmbeddedBrowserViewBounds(view)
    embeddedBrowserViews.set(tabId, view)

    view.webContents.on('did-start-loading', () => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: 'did-start-loading',
        state: 'loading',
        url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(tabId) || undefined,
      })
    })
    view.webContents.on('dom-ready', () => {
      void tryInstallEmbeddedBrowserResourceProbe(tabId, view)
    })
    view.webContents.on('did-stop-loading', async () => {
      if (view.webContents.isDestroyed()) {
        return
      }
      const committedUrl = view.webContents.getURL() || ''
      embeddedBrowserLastCommittedUrls.set(tabId, committedUrl)
      await tryDispatchPendingEmbeddedBrowserOpenFile(tabId, view)
      const meta = await collectEmbeddedBrowserDebugMeta(view, options.debugEnabled)
      emitEmbeddedBrowserTabState(tabId, view, {
        details: 'did-stop-loading',
        ...(meta.length ? { meta } : {}),
        state: 'ready',
        url: committedUrl || undefined,
      })
    })
    view.webContents.on('did-navigate', (_event, url) => {
      embeddedBrowserLastCommittedUrls.set(tabId, url)
      emitEmbeddedBrowserTabState(tabId, view, { details: 'did-navigate', state: 'ready', url })
      void tryDispatchPendingEmbeddedBrowserOpenFile(tabId, view)
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      embeddedBrowserLastCommittedUrls.set(tabId, url)
      emitEmbeddedBrowserTabState(tabId, view, { details: 'did-navigate-in-page', state: 'ready', url })
      void tryDispatchPendingEmbeddedBrowserOpenFile(tabId, view)
    })
    view.webContents.on('page-title-updated', (_event, title) => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: 'page-title-updated',
        state: 'ready',
        title: title || undefined,
        url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined,
      })
    })
    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      const iconUrl = favicons
        .map((item) => String(item || '').trim())
        .find((item) => item) || ''
      if (!iconUrl) {
        return
      }
      void loadEmbeddedBrowserFaviconDataUrl(view, iconUrl).then((faviconDataUrl) => {
        if (!faviconDataUrl || view.webContents.isDestroyed()) {
          return
        }
        embeddedBrowserIconSourceUrls.set(tabId, iconUrl)
        embeddedBrowserIconUrls.set(tabId, faviconDataUrl)
        emitEmbeddedBrowserTabState(tabId, view, {
          details: 'page-favicon-updated',
          iconSourceUrl: iconUrl,
          iconUrl: faviconDataUrl,
          state: 'ready',
          url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined,
        })
      })
    })
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) {
        return
      }
      emitEmbeddedBrowserTabState(tabId, view, {
        details: `did-fail-load(${errorCode})`,
        state: 'error',
        message: `页面加载失败：${errorDescription || '未知错误'}`,
        url: validatedURL,
      })
    })
    view.webContents.on('render-process-gone', (_event, details) => {
      emitEmbeddedBrowserTabState(tabId, view, {
        details: `render-process-gone:${details.reason}`,
        state: 'error',
        message: `页面渲染进程异常退出：${details.reason}`,
        url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined,
      })
    })
    view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX)) {
        const rawPayload = message.slice(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX.length)
        try {
          const payload = JSON.parse(rawPayload) as Record<string, unknown>
          recordEmbeddedBrowserProbeResource(tabId, {
            capturedAt: Number(payload.capturedAt) || Date.now(),
            contentLength: typeof payload.contentLength === 'number' ? payload.contentLength : undefined,
            ext: typeof payload.ext === 'string' ? payload.ext : undefined,
            kind: typeof payload.kind === 'string'
              ? payload.kind as EmbeddedBrowserCapturedResource['kind']
              : undefined,
            mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
            pageUrl: typeof payload.pageUrl === 'string' ? payload.pageUrl : undefined,
            resourceKey: typeof payload.resourceKey === 'string' ? payload.resourceKey : undefined,
            resourceType: typeof payload.resourceType === 'string' ? payload.resourceType : undefined,
            source: 'probe',
            streamType: payload.streamType === 'audio' || payload.streamType === 'video'
              ? payload.streamType
              : undefined,
            url: typeof payload.url === 'string' ? payload.url : '',
          })
        } catch (error) {
          runtimeLogger.warn('embedded browser resource payload parse failed', {
            error: error instanceof Error ? error.message : String(error),
            tabId,
          })
        }
        return
      }
      if (options.debugEnabled && level >= 2) {
        emitEmbeddedBrowserTabState(tabId, view, {
          details: `console:${sourceId}:${line}`,
          state: 'ready',
          message,
          meta: [`console-level=${level}`],
          url: embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined,
        })
      }
    })
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url)
      return { action: 'deny' }
    })

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
    bumpEmbeddedBrowserOpenFileRequestVersion(normalizedTabId)
    cleanupEmbeddedBrowserOpenFileForTab(normalizedTabId)
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  async function handleOpenTab(sender: Electron.WebContents, tabId: string, url?: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    bumpEmbeddedBrowserOpenFileRequestVersion(String(tabId || '').trim())
    cleanupEmbeddedBrowserOpenFileForTab(String(tabId || '').trim())
    const normalizedUrl = String(url || '').trim()
    if (!normalizedUrl) {
      emitEmbeddedBrowserState({
        canGoBack: false,
        canGoForward: false,
        state: 'ready',
        tabId,
        title: '新标签页',
      })
      return
    }
    await loadEmbeddedBrowserUrl(targetWindow, tabId, normalizedUrl, 'open-exception', true)
  }

  function handleActivateTab(sender: Electron.WebContents, tabId: string | null) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false })
  }

  async function handleNavigate(sender: Electron.WebContents, tabId: string, url: string) {
    const targetWindow = BrowserWindow.fromWebContents(sender) ?? options.getMainWindow()
    const normalizedTabId = String(tabId || '').trim()
    bumpEmbeddedBrowserOpenFileRequestVersion(normalizedTabId)
    cleanupEmbeddedBrowserOpenFileForTab(normalizedTabId)
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

    const requestVersion = bumpEmbeddedBrowserOpenFileRequestVersion(normalizedTabId)
    cleanupEmbeddedBrowserOpenFileForTab(normalizedTabId)
    const stagedPath = await stageEmbeddedBrowserOpenFile(normalizedSourceUrl, normalizedFileName)
    if (!isEmbeddedBrowserOpenFileRequestCurrent(normalizedTabId, requestVersion)) {
      void cleanupEmbeddedBrowserOpenFile(stagedPath).catch(() => undefined)
      return
    }
    embeddedBrowserPendingOpenFiles.set(normalizedTabId, {
      fileName: normalizedFileName,
      pageUrl: normalizedPageUrl,
      stagedPath,
    })

    await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, normalizedPageUrl, 'navigate-exception')
    if (!isEmbeddedBrowserOpenFileRequestCurrent(normalizedTabId, requestVersion)) {
      return
    }

    const view = getEmbeddedBrowserView(normalizedTabId)
    if (view) {
      void tryDispatchPendingEmbeddedBrowserOpenFile(normalizedTabId, view)
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

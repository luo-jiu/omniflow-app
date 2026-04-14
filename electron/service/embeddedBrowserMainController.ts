import { Buffer } from 'node:buffer'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  type Session,
  WebContentsView,
} from 'electron'
import { runtimeLogger } from '../runtimeLogger'
import {
  EMBEDDED_BROWSER_PARTITION,
  cleanupEmbeddedBrowserDownloadFile,
  initializeEmbeddedBrowserDownloadBridge,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import type { EmbeddedBrowserCatchToolkitStatePayload } from './embeddedBrowserCatchToolkitPageBridge'
import {
  getEmbeddedBrowserCatchToolkitState,
  runEmbeddedBrowserCatchToolkitAction,
  updateEmbeddedBrowserCatchToolkitState,
} from './embeddedBrowserCatchToolkitActionService'
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
  clearEmbeddedBrowserCapturedResources,
  disposeEmbeddedBrowserCapturedResources,
  getEmbeddedBrowserResourceCaptureSnapshot,
  initializeEmbeddedBrowserResourceBridge,
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

type EmbeddedBrowserMainControllerOptions = {
  debugEnabled: boolean
  getMainWindow: () => BrowserWindow | null
}

type EmbeddedBrowserStatePayload = {
  canGoBack?: boolean
  canGoForward?: boolean
  details?: string
  iconSourceUrl?: string
  iconUrl?: string
  message?: string
  meta?: string[]
  state?: 'idle' | 'loading' | 'ready' | 'error'
  tabId?: string
  title?: string
  url?: string
}

type EmbeddedBrowserFaviconResolvePayload = {
  iconUrl?: string
  pageUrl?: string
}

type EmbeddedBrowserFaviconResolveResult = {
  dataUrl: string
  iconUrl: string
}

type EmbeddedBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

type EmbeddedBrowserCapturedResourceMergePayload = {
  audioResourceKey?: string
  ffmpegPath?: string
  suggestedFileName?: string
  videoResourceKey?: string
}

type EmbeddedBrowserCapturedResourceMergeResponse = {
  cancelled?: boolean
  error?: string
  ffmpegPath?: string
  ok: boolean
  outputPath?: string
}

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

  function resolveEmbeddedBrowserOrigin(rawValue: string) {
    const value = String(rawValue || '').trim()
    if (!value) {
      return ''
    }
    try {
      return new URL(value).origin
    } catch {
      return ''
    }
  }

  function isEmbeddedBrowserFileSystemPermission(permission: string) {
    return permission === 'fileSystem'
  }

  async function confirmEmbeddedBrowserFileSystemOrigin(origin: string) {
    const normalizedOrigin = resolveEmbeddedBrowserOrigin(origin)
    if (!normalizedOrigin) {
      return false
    }

    const cachedDecision = embeddedBrowserFileSystemOriginDecisions.get(normalizedOrigin)
    if (typeof cachedDecision === 'boolean') {
      return cachedDecision
    }

    const focusedWindow = BrowserWindow.getFocusedWindow()
      ?? options.getMainWindow()
      ?? BrowserWindow.getAllWindows()[0]
      ?? undefined
    const { response } = await dialog.showMessageBox(focusedWindow, {
      type: 'question',
      buttons: ['拒绝', '允许'],
      defaultId: 1,
      cancelId: 0,
      title: '允许网页访问本地目录',
      message: `${normalizedOrigin} 想要访问你选择的本地目录。`,
      detail: '仅在你信任这个网站时允许。之后本次运行期间会记住这个选择。',
      noLink: true,
    })
    const granted = response === 1
    embeddedBrowserFileSystemOriginDecisions.set(normalizedOrigin, granted)
    return granted
  }

  async function resolveRestrictedPathAccessAction(details: { origin: string; path: string }) {
    const normalizedOrigin = resolveEmbeddedBrowserOrigin(details.origin)
    if (!normalizedOrigin) {
      return 'deny' as const
    }

    const focusedWindow = BrowserWindow.getFocusedWindow()
      ?? options.getMainWindow()
      ?? BrowserWindow.getAllWindows()[0]
      ?? undefined
    const { response } = await dialog.showMessageBox(focusedWindow, {
      type: 'question',
      buttons: ['换个目录', '允许这次访问', '拒绝'],
      defaultId: 0,
      cancelId: 2,
      title: '网页请求访问受限路径',
      message: `${normalizedOrigin} 想要访问受限路径。`,
      detail: String(details.path || ''),
      noLink: true,
    })
    if (response === 0) {
      return 'tryAgain' as const
    }
    if (response === 1) {
      return 'allow' as const
    }
    return 'deny' as const
  }

  function configureSession() {
    if (embeddedBrowserSessionConfigured) {
      return
    }
    embeddedBrowserSessionConfigured = true

    const browserSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION)

    browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      if (!isEmbeddedBrowserFileSystemPermission(String(permission))) {
        callback(false)
        return
      }
      void confirmEmbeddedBrowserFileSystemOrigin(details.requestingUrl || '').then((granted) => {
        callback(granted)
      }).catch(() => {
        callback(false)
      })
    })

    browserSession.on('file-system-access-restricted', (event, details, callback) => {
      event.preventDefault()
      void resolveRestrictedPathAccessAction(details).then((action) => {
        callback(action)
      }).catch(() => {
        callback('deny')
      })
    })
  }

  function initializeBridges() {
    initializeEmbeddedBrowserDownloadBridge({
      emitDownload: emitEmbeddedBrowserDownload,
      resolveTabIdByWebContents: resolveEmbeddedBrowserTabIdByWebContents,
    })
    initializeEmbeddedBrowserResourceBridge({
      browserSession: session.fromPartition(EMBEDDED_BROWSER_PARTITION),
      emitResource: emitEmbeddedBrowserResource,
      resolveTabIdByWebContentsId: resolveEmbeddedBrowserTabIdByWebContentsId,
    })
  }

  async function collectEmbeddedBrowserDebugMeta(view: WebContentsView) {
    if (!options.debugEnabled || view.webContents.isDestroyed()) {
      return []
    }

    try {
      const snapshot = await view.webContents.executeJavaScript(`
        (() => {
          const bodyText = document.body?.innerText?.trim() || ''
          const bodyHtmlLength = document.body?.innerHTML?.length || 0
          return {
            title: document.title || '',
            readyState: document.readyState || '',
            bodyTextPreview: bodyText.slice(0, 120),
            bodyHtmlLength,
            innerWidth: window.innerWidth || 0,
            innerHeight: window.innerHeight || 0,
            clientWidth: document.documentElement?.clientWidth || 0,
            clientHeight: document.documentElement?.clientHeight || 0,
            devicePixelRatio: window.devicePixelRatio || 0,
            userAgent: navigator.userAgent || '',
          }
        })()
      `, true)

      const meta: string[] = []
      if (snapshot?.title) {
        meta.push(`title=${snapshot.title}`)
      }
      if (snapshot?.readyState) {
        meta.push(`readyState=${snapshot.readyState}`)
      }
      if (typeof snapshot?.bodyHtmlLength === 'number') {
        meta.push(`bodyHtml=${snapshot.bodyHtmlLength}`)
      }
      if (typeof snapshot?.innerWidth === 'number' && typeof snapshot?.innerHeight === 'number') {
        meta.push(`viewport=${snapshot.innerWidth}x${snapshot.innerHeight}`)
      }
      if (typeof snapshot?.clientWidth === 'number' && typeof snapshot?.clientHeight === 'number') {
        meta.push(`client=${snapshot.clientWidth}x${snapshot.clientHeight}`)
      }
      if (typeof snapshot?.devicePixelRatio === 'number') {
        meta.push(`dpr=${snapshot.devicePixelRatio}`)
      }
      if (snapshot?.bodyTextPreview) {
        meta.push(`preview=${snapshot.bodyTextPreview}`)
      }
      if (snapshot?.userAgent) {
        meta.push(`ua=${snapshot.userAgent}`)
      }
      return meta
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [`inspect=${message}`]
    }
  }

  function getEmbeddedBrowserTitle(view: WebContentsView) {
    const runtimeTitle = view.webContents.getTitle().trim()
    if (runtimeTitle) {
      return runtimeTitle
    }
    return undefined
  }

  function resolveEmbeddedBrowserFaviconUrl(rawIconUrl: string, pageUrl?: string) {
    const iconUrl = rawIconUrl.trim()
    if (!iconUrl) {
      return ''
    }
    if (iconUrl.startsWith('data:')) {
      return iconUrl
    }
    try {
      return new URL(iconUrl, pageUrl || undefined).toString()
    } catch {
      return iconUrl
    }
  }

  function getEmbeddedBrowserFaviconMimeType(iconUrl: string, contentType?: string | null) {
    const normalizedContentType = String(contentType || '').split(';')[0]?.trim()
    if (normalizedContentType?.startsWith('image/')) {
      return normalizedContentType
    }
    const pathname = (() => {
      try {
        return new URL(iconUrl).pathname.toLowerCase()
      } catch {
        return iconUrl.toLowerCase()
      }
    })()
    if (pathname.endsWith('.svg')) {
      return 'image/svg+xml'
    }
    if (pathname.endsWith('.ico')) {
      return 'image/x-icon'
    }
    if (pathname.endsWith('.webp')) {
      return 'image/webp'
    }
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
      return 'image/jpeg'
    }
    return 'image/png'
  }

  async function fetchEmbeddedBrowserFaviconDataUrl(browserSession: Session, iconUrl: string) {
    if (!iconUrl || iconUrl.startsWith('data:')) {
      return iconUrl
    }
    try {
      const response = await browserSession.fetch(iconUrl)
      if (!response.ok) {
        return ''
      }
      const content = Buffer.from(await response.arrayBuffer())
      if (content.length === 0) {
        return ''
      }
      const mimeType = getEmbeddedBrowserFaviconMimeType(iconUrl, response.headers.get('content-type'))
      return `data:${mimeType};base64,${content.toString('base64')}`
    } catch (error) {
      runtimeLogger.warn('embedded browser favicon load failed', {
        error: error instanceof Error ? error.message : String(error),
        iconUrl,
      })
      return ''
    }
  }

  function loadEmbeddedBrowserFaviconDataUrl(view: WebContentsView, iconUrl: string) {
    return fetchEmbeddedBrowserFaviconDataUrl(view.webContents.session, iconUrl)
  }

  function extractEmbeddedBrowserFaviconCandidates(html: string, pageUrl: string) {
    const candidates: string[] = []
    const linkRegex = /<link\b[^>]*>/gi
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    let linkMatch: RegExpExecArray | null
    while ((linkMatch = linkRegex.exec(html))) {
      const tag = linkMatch[0]
      const attrs = new Map<string, string>()
      let attrMatch: RegExpExecArray | null
      attrRegex.lastIndex = 0
      while ((attrMatch = attrRegex.exec(tag))) {
        attrs.set(attrMatch[1].toLowerCase(), attrMatch[2] || attrMatch[3] || attrMatch[4] || '')
      }
      const rel = attrs.get('rel') || ''
      const href = attrs.get('href') || ''
      if (!href || !/(^|\s)(shortcut\s+icon|icon|apple-touch-icon|mask-icon)(\s|$)/i.test(rel)) {
        continue
      }
      const iconUrl = resolveEmbeddedBrowserFaviconUrl(href, pageUrl)
      if (iconUrl) {
        candidates.push(iconUrl)
      }
    }
    return candidates
  }

  async function resolveEmbeddedBrowserBookmarkFavicon(
    payload: EmbeddedBrowserFaviconResolvePayload,
  ): Promise<EmbeddedBrowserFaviconResolveResult> {
    const pageUrl = String(payload?.pageUrl || '').trim()
    const browserSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION)
    const candidates: string[] = []
    const providedIconUrl = resolveEmbeddedBrowserFaviconUrl(String(payload?.iconUrl || ''), pageUrl || undefined)
    if (providedIconUrl && !providedIconUrl.startsWith('data:')) {
      candidates.push(providedIconUrl)
    }

    if (pageUrl) {
      try {
        const response = await browserSession.fetch(pageUrl)
        const contentType = response.headers.get('content-type') || ''
        if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
          candidates.push(...extractEmbeddedBrowserFaviconCandidates(await response.text(), pageUrl))
        }
      } catch (error) {
        runtimeLogger.warn('embedded browser favicon page inspect failed', {
          error: error instanceof Error ? error.message : String(error),
          pageUrl,
        })
      }
      try {
        const origin = new URL(pageUrl).origin
        candidates.push(`${origin}/favicon.ico`)
      } catch {
        // ignore
      }
    }

    const visited = new Set<string>()
    for (const candidate of candidates) {
      if (!candidate || visited.has(candidate)) {
        continue
      }
      visited.add(candidate)
      const faviconDataUrl = await fetchEmbeddedBrowserFaviconDataUrl(browserSession, candidate)
      if (faviconDataUrl) {
        return {
          dataUrl: faviconDataUrl,
          iconUrl: candidate,
        }
      }
    }
    return {
      dataUrl: providedIconUrl.startsWith('data:') ? providedIconUrl : '',
      iconUrl: '',
    }
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
      const meta = await collectEmbeddedBrowserDebugMeta(view)
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
      const pageUrl = embeddedBrowserLastCommittedUrls.get(tabId) || view.webContents.getURL() || undefined
      const iconUrl = favicons
        .map((item) => resolveEmbeddedBrowserFaviconUrl(String(item || ''), pageUrl))
        .find((item) => item.trim()) || ''
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
    options: { createIfMissing?: boolean } = {},
  ) {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return null
    }
    if (!tabId) {
      detachActiveEmbeddedBrowserView(targetWindow)
      return null
    }
    const createIfMissing = options.createIfMissing ?? false
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

  function registerIpcHandlers() {
    ipcMain.handle('embedded-browser:open-tab', async (event, tabId: string, url?: string) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
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
    })

    ipcMain.handle('embedded-browser:activate-tab', (event, tabId: string | null) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
      activateEmbeddedBrowserTab(targetWindow, tabId, { createIfMissing: false })
    })

    ipcMain.handle('embedded-browser:navigate', async (event, tabId: string, url: string) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
      const normalizedTabId = String(tabId || '').trim()
      bumpEmbeddedBrowserOpenFileRequestVersion(normalizedTabId)
      cleanupEmbeddedBrowserOpenFileForTab(normalizedTabId)
      await loadEmbeddedBrowserUrl(targetWindow, normalizedTabId, url, 'navigate-exception')
    })

    ipcMain.handle('embedded-browser:resolve-favicon', async (_event, payload: EmbeddedBrowserFaviconResolvePayload) => (
      resolveEmbeddedBrowserBookmarkFavicon(payload)
    ))

    ipcMain.handle('embedded-browser:open-mapped-file', async (
      event,
      tabId: string,
      pageUrl: string,
      sourceUrl: string,
      fileName: string,
    ) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
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
    })

    ipcMain.handle('embedded-browser:reload', async (_event, tabId: string) => {
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
    })

    ipcMain.handle('embedded-browser:go-back', async (_event, tabId: string) => {
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
    })

    ipcMain.handle('embedded-browser:go-forward', async (_event, tabId: string) => {
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
    })

    ipcMain.handle('embedded-browser:resource:list', (_event, tabId: string) => (
      getEmbeddedBrowserResourceCaptureSnapshot(String(tabId || '').trim())
    ))

    ipcMain.handle('embedded-browser:resource:start', (_event, tabId: string) => (
      startEmbeddedBrowserResourceCapture(String(tabId || '').trim())
    ))

    ipcMain.handle('embedded-browser:resource:stop', (_event, tabId: string) => (
      stopEmbeddedBrowserResourceCapture(String(tabId || '').trim())
    ))

    ipcMain.handle('embedded-browser:resource:clear', (_event, tabId: string) => (
      clearEmbeddedBrowserCapturedResources(String(tabId || '').trim())
    ))

    ipcMain.handle('embedded-browser:resource:open', async (_event, tabId: string, resourceKey: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
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
    ))

    ipcMain.handle('embedded-browser:resource:export', async (_event, tabId: string, resourceKey: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
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
    ))

    ipcMain.handle('embedded-browser:resource:preview', async (
      _event,
      tabId: string,
      payload: EmbeddedBrowserResourcePreviewPayload,
    ) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript) => {
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
    ))

    ipcMain.handle('embedded-browser:resource:catch-toolkit:get-state', async (_event, tabId: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
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
    ))

    ipcMain.handle(
      'embedded-browser:resource:catch-toolkit:update-state',
      async (_event, tabId: string, payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>) => (
        withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
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
      ),
    )

    ipcMain.handle('embedded-browser:resource:catch-toolkit:clear-cache', async (_event, tabId: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
        try {
          return await runEmbeddedBrowserCatchToolkitAction(executeScript, 'clearCatchMediaCache')
        } catch (error) {
          runtimeLogger.warn('embedded browser catch toolkit clear cache failed', {
            error: error instanceof Error ? error.message : String(error),
            tabId: String(tabId || '').trim(),
            url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
          })
          return false
        }
      }).then((result) => Boolean(result))
    ))

    ipcMain.handle('embedded-browser:resource:catch-toolkit:download', async (_event, tabId: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
        try {
          return await runEmbeddedBrowserCatchToolkitAction(executeScript, 'downloadCatchMedia')
        } catch (error) {
          runtimeLogger.warn('embedded browser catch toolkit download failed', {
            error: error instanceof Error ? error.message : String(error),
            tabId: String(tabId || '').trim(),
            url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
          })
          return false
        }
      }).then((result) => Boolean(result))
    ))

    ipcMain.handle('embedded-browser:resource:catch-toolkit:restart', async (_event, tabId: string) => (
      withEmbeddedBrowserResourceScriptExecutor(tabId, async (executeScript, view) => {
        try {
          return await runEmbeddedBrowserCatchToolkitAction(executeScript, 'restartCatchMediaCapture')
        } catch (error) {
          runtimeLogger.warn('embedded browser catch toolkit restart failed', {
            error: error instanceof Error ? error.message : String(error),
            tabId: String(tabId || '').trim(),
            url: view.webContents.getURL() || embeddedBrowserLastCommittedUrls.get(String(tabId || '').trim()) || '',
          })
          return false
        }
      }).then((result) => Boolean(result))
    ))

    ipcMain.handle(
      'embedded-browser:resource:merge-mse',
      async (_event, tabId: string, payload: EmbeddedBrowserCapturedResourceMergePayload) => (
        mergeEmbeddedBrowserCapturedMseResources(tabId, payload)
      ),
    )

    ipcMain.handle('embedded-browser:resource:start-deep-capture', async (_event, tabId: string) => {
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
    })

    ipcMain.handle('embedded-browser:set-bounds', (event, bounds: EmbeddedBrowserBounds) => {
      const nextBounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
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
    })

    ipcMain.handle('embedded-browser:close-tab', (event, tabId: string) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
      closeEmbeddedBrowserTab(targetWindow, tabId)
    })

    ipcMain.handle('embedded-browser:cleanup-download-file', async (_event, tempPath: string) => {
      try {
        return await cleanupEmbeddedBrowserDownloadFile(tempPath)
      } catch {
        return false
      }
    })

    ipcMain.handle('embedded-browser:deactivate', (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }
      detachActiveEmbeddedBrowserView(targetWindow)
    })

    ipcMain.handle('embedded-browser:close-all', (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow()
      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }
      Array.from(embeddedBrowserViews.keys()).forEach((tabId) => {
        closeEmbeddedBrowserTab(targetWindow, tabId)
      })
      activeEmbeddedBrowserTabId = null
      emitEmbeddedBrowserState({ state: 'idle' })
    })
  }

  return {
    configureSession,
    initializeBridges,
    registerIpcHandlers,
  }
}

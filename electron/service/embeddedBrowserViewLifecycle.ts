import crypto from 'node:crypto'
import { WebContentsView, type WebContents } from 'electron'
import { runtimeLogger } from '../runtimeLogger'
import {
  EMBEDDED_BROWSER_PARTITION,
} from './embeddedBrowserService'
import {
  collectEmbeddedBrowserDebugMeta,
  loadEmbeddedBrowserFaviconDataUrl,
} from './embeddedBrowserMainSupport'
import { type EmbeddedBrowserStatePayload } from './embeddedBrowserMainTypes'
import {
  EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX,
  createEmbeddedBrowserResourceProbeScript,
} from './embeddedBrowserResourceProbe'
import {
  EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX,
  EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX,
  createCredentialDetectionScript,
} from './embeddedBrowserCredentialDetectionScript'
import {
  EMBEDDED_BROWSER_PAGE_DRAG_CONSOLE_PREFIX,
  createEmbeddedBrowserPageDragSourceScript,
} from './embeddedBrowserPageDragSourceScript'
import {
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX,
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID,
  createEmbeddedBrowserLibraryFileDropScript,
} from './embeddedBrowserLibraryFileDropScript'
import { type EmbeddedBrowserCapturedResource, recordEmbeddedBrowserProbeResource } from './embeddedBrowserResourceService'
import {
  handleEmbeddedBrowserInputShortcut,
  isDevToolsToggleShortcut,
  showEmbeddedBrowserContextMenu,
} from './embeddedBrowserInputShortcuts'

const embeddedBrowserProbeNewDocumentScriptIds = new WeakMap<WebContents, string>()
const EMBEDDED_BROWSER_POPUP_PLACEHOLDER_URLS = new Set(['', 'about:blank'])

type CreateEmbeddedBrowserViewOptions = {
  createIfMissingProbe: (tabId: string, view: WebContentsView) => Promise<boolean>
  currentUrls: Map<string, string>
  debugEnabled: boolean
  emitTabState: (
    tabId: string,
    view: WebContentsView,
    payload: Omit<EmbeddedBrowserStatePayload, 'tabId' | 'title' | 'url'> & {
      iconSourceUrl?: string
      iconUrl?: string
      title?: string
      url?: string
    },
  ) => void
  iconSourceUrls: Map<string, string>
  iconUrls: Map<string, string>
  onAutoFillReady: (tabId: string, domain: string) => void
  onCredentialPayload: (tabId: string, payload: Record<string, unknown>) => void
  onDocumentNavigated: (tabId: string, url: string) => void
  onLibraryFileDropPayload: (tabId: string, payload: Record<string, unknown>) => void
  onPageDragPayload: (tabId: string, payload: Record<string, unknown>) => void
  onProbePayload: (payload: Record<string, unknown>) => void
  onViewDestroyed: (tabId: string) => void
  syncBounds: (view: WebContentsView) => void
  tabId: string
  tryDispatchPendingOpenFile: (tabId: string, view: WebContentsView) => Promise<boolean>
  views: Map<string, WebContentsView>
}

function isEmbeddedBrowserPopupPlaceholderUrl(url: string) {
  return EMBEDDED_BROWSER_POPUP_PLACEHOLDER_URLS.has(String(url || '').trim().toLowerCase())
}

function isEmbeddedBrowserPopupNavigableUrl(url: string) {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl || isEmbeddedBrowserPopupPlaceholderUrl(normalizedUrl)) {
    return false
  }
  return !normalizedUrl.toLowerCase().startsWith('javascript:')
}

export function createEmbeddedBrowserView(
  options: CreateEmbeddedBrowserViewOptions,
) {
  const existingView = options.views.get(options.tabId)
  if (existingView && !existingView.webContents.isDestroyed()) {
    return existingView
  }

  const view = new WebContentsView({
    webPreferences: {
      devTools: true,
      navigateOnDragDrop: false,
      partition: EMBEDDED_BROWSER_PARTITION,
    },
  })
  const libraryFileDropNonce = crypto.randomBytes(32).toString('hex')
  const installLibraryFileDropScript = () => view.webContents.executeJavaScriptInIsolatedWorld(
    EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID,
    [{ code: createEmbeddedBrowserLibraryFileDropScript(libraryFileDropNonce) }],
    true,
  )
  view.webContents.setZoomFactor(1)
  const currentUserAgent = view.webContents.getUserAgent()
  if (currentUserAgent.includes('Electron')) {
    view.webContents.setUserAgent(
      currentUserAgent.replace(/\sElectron\/[^\s]+/g, ''),
    )
  }
  options.syncBounds(view)
  options.views.set(options.tabId, view)

  view.webContents.on('before-input-event', (event, input) => {
    if (handleEmbeddedBrowserInputShortcut(view.webContents, input)) {
      event.preventDefault()
    }
  })
  view.webContents.on('context-menu', (_event, params) => {
    showEmbeddedBrowserContextMenu(view.webContents, params)
  })

  let removeDevToolsInputListener: (() => void) | null = null
  const cleanupDevToolsInputListener = () => {
    removeDevToolsInputListener?.()
    removeDevToolsInputListener = null
  }
  view.webContents.on('devtools-opened', () => {
    cleanupDevToolsInputListener()
    const devToolsWebContents = view.webContents.devToolsWebContents
    if (!devToolsWebContents || devToolsWebContents.isDestroyed()) {
      return
    }
    const handleDevToolsInput = (event: Electron.Event, input: Electron.Input) => {
      if (!isDevToolsToggleShortcut(input)) {
        return
      }
      event.preventDefault()
      if (!view.webContents.isDestroyed()) {
        view.webContents.closeDevTools()
      }
    }
    devToolsWebContents.on('before-input-event', handleDevToolsInput)
    removeDevToolsInputListener = () => {
      devToolsWebContents.removeListener('before-input-event', handleDevToolsInput)
    }
  })

  view.webContents.on('did-start-loading', () => {
    options.emitTabState(options.tabId, view, {
      details: 'did-start-loading',
      state: 'loading',
      url: view.webContents.getURL() || options.currentUrls.get(options.tabId) || undefined,
    })
  })
  view.webContents.on('dom-ready', () => {
    void options.createIfMissingProbe(options.tabId, view)
    view.webContents.executeJavaScript(createCredentialDetectionScript(), true).catch(() => {})
    view.webContents.executeJavaScript(
      createEmbeddedBrowserPageDragSourceScript(options.tabId),
      true,
    ).catch(() => {})
    installLibraryFileDropScript().catch(() => {})
  })
  view.webContents.on(
    'did-frame-finish-load',
    (_event, _isMainFrame, frameProcessId, frameRoutingId) => {
      if (view.webContents.isDestroyed()) return
      const frame = [view.webContents.mainFrame, ...view.webContents.mainFrame.framesInSubtree]
        .find((candidate) => (
          candidate.processId === frameProcessId
          && candidate.routingId === frameRoutingId
        ))
      frame?.executeJavaScript(
        createEmbeddedBrowserPageDragSourceScript(options.tabId),
        true,
      ).catch(() => {})
    },
  )
  view.webContents.on('did-stop-loading', async () => {
    if (view.webContents.isDestroyed()) {
      return
    }
    const committedUrl = view.webContents.getURL() || ''
    options.currentUrls.set(options.tabId, committedUrl)
    await options.tryDispatchPendingOpenFile(options.tabId, view)
    const meta = await collectEmbeddedBrowserDebugMeta(view, options.debugEnabled)
    options.emitTabState(options.tabId, view, {
      details: 'did-stop-loading',
      ...(meta.length ? { meta } : {}),
      state: 'ready',
      url: committedUrl || undefined,
    })
  })
  view.webContents.on('did-navigate', (_event, url) => {
    options.onDocumentNavigated(options.tabId, url)
    options.currentUrls.set(options.tabId, url)
    options.emitTabState(options.tabId, view, { details: 'did-navigate', state: 'ready', url })
    void options.tryDispatchPendingOpenFile(options.tabId, view)
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    options.currentUrls.set(options.tabId, url)
    options.emitTabState(options.tabId, view, { details: 'did-navigate-in-page', state: 'ready', url })
    void options.tryDispatchPendingOpenFile(options.tabId, view)
  })
  view.webContents.on('page-title-updated', (_event, title) => {
    options.emitTabState(options.tabId, view, {
      details: 'page-title-updated',
      state: 'ready',
      title: title || undefined,
      url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || undefined,
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
      options.iconSourceUrls.set(options.tabId, iconUrl)
      options.iconUrls.set(options.tabId, faviconDataUrl)
      options.emitTabState(options.tabId, view, {
        details: 'page-favicon-updated',
        iconSourceUrl: iconUrl,
        iconUrl: faviconDataUrl,
        state: 'ready',
        url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || undefined,
      })
    })
  })
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      return
    }
    options.emitTabState(options.tabId, view, {
      details: `did-fail-load(${errorCode})`,
      state: 'error',
      message: `页面加载失败：${errorDescription || '未知错误'}`,
      url: validatedURL,
    })
  })
  view.webContents.on('render-process-gone', (_event, details) => {
    options.emitTabState(options.tabId, view, {
      details: `render-process-gone:${details.reason}`,
      state: 'error',
      message: `页面渲染进程异常退出：${details.reason}`,
      url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || undefined,
    })
  })
  view.webContents.debugger.on('detach', () => {
    embeddedBrowserProbeNewDocumentScriptIds.delete(view.webContents)
  })
  view.webContents.on('devtools-closed', () => {
    cleanupDevToolsInputListener()
    if (!view.webContents.isDestroyed()) {
      void options.createIfMissingProbe(options.tabId, view)
    }
  })
  view.webContents.once('destroyed', () => {
    cleanupDevToolsInputListener()
    options.onViewDestroyed(options.tabId)
  })
  view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX)) {
      const rawPayload = message.slice(EMBEDDED_BROWSER_RESOURCE_CONSOLE_PREFIX.length)
      try {
        options.onProbePayload(JSON.parse(rawPayload) as Record<string, unknown>)
      } catch (error) {
        runtimeLogger.warn('embedded browser resource payload parse failed', {
          error: error instanceof Error ? error.message : String(error),
          tabId: options.tabId,
        })
      }
      return
    }
    if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX)) {
      try {
        options.onCredentialPayload(options.tabId, JSON.parse(message.slice(EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX.length)))
      } catch {
        // Malformed credential payload — ignore silently.
      }
      return
    }
    if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX)) {
      try {
        const payload = JSON.parse(message.slice(EMBEDDED_BROWSER_AUTOFILL_CONSOLE_PREFIX.length)) as Record<string, unknown>
        const domain = typeof payload.domain === 'string' ? payload.domain.trim() : ''
        if (domain) {
          options.onAutoFillReady(options.tabId, domain)
        }
      } catch {
        // Malformed autofill-ready payload.
      }
      return
    }
    if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_PAGE_DRAG_CONSOLE_PREFIX)) {
      try {
        options.onPageDragPayload(
          options.tabId,
          JSON.parse(message.slice(EMBEDDED_BROWSER_PAGE_DRAG_CONSOLE_PREFIX.length)),
        )
      } catch {
        // Malformed page drag payload — ignore silently.
      }
      return
    }
    if (typeof message === 'string' && message.startsWith(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX)) {
      try {
        const payload = JSON.parse(
          message.slice(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX.length),
        ) as Record<string, unknown>
        if (payload.nonce !== libraryFileDropNonce) return
        options.onLibraryFileDropPayload(
          options.tabId,
          payload,
        )
      } catch {
        // Malformed library file drop payload - ignore silently.
      }
      return
    }
    if (options.debugEnabled && level >= 2) {
      options.emitTabState(options.tabId, view, {
        details: `console:${sourceId}:${line}`,
        state: 'ready',
        message,
        meta: [`console-level=${level}`],
        url: options.currentUrls.get(options.tabId) || view.webContents.getURL() || undefined,
      })
    }
  })
  const loadPopupUrlInCurrentTab = (url: string, details: string) => {
    const normalizedUrl = String(url || '').trim()
    if (!isEmbeddedBrowserPopupNavigableUrl(normalizedUrl) || view.webContents.isDestroyed()) {
      return false
    }
    options.currentUrls.set(options.tabId, normalizedUrl)
    options.emitTabState(options.tabId, view, {
      details,
      state: 'loading',
      url: normalizedUrl,
    })
    void view.webContents.loadURL(normalizedUrl).catch((error) => {
      runtimeLogger.warn('embedded browser popup navigation failed', {
        error: error instanceof Error ? error.message : String(error),
        tabId: options.tabId,
        url: normalizedUrl,
      })
    })
    return true
  }

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isEmbeddedBrowserPopupPlaceholderUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: false,
          show: false,
          skipTaskbar: true,
        },
      }
    }
    loadPopupUrlInCurrentTab(url, 'window-open')
    return { action: 'deny' }
  })
  view.webContents.on('did-create-window', (popupWindow, details) => {
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const cleanupPopup = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
      if (!popupWindow.webContents.isDestroyed()) {
        popupWindow.webContents.removeListener('will-navigate', handlePopupNavigation)
        popupWindow.webContents.removeListener('did-start-navigation', handlePopupNavigation)
      }
      popupWindow.removeListener('closed', cleanupPopup)
    }
    const closePopup = () => {
      cleanupPopup()
      if (!popupWindow.isDestroyed()) {
        popupWindow.close()
      }
    }
    const handlePopupNavigation = (
      event: Electron.Event & { isMainFrame?: boolean; url?: string },
      url?: string,
      _isInPlace?: boolean,
      isMainFrame?: boolean,
    ) => {
      const targetIsMainFrame = typeof event.isMainFrame === 'boolean' ? event.isMainFrame : isMainFrame
      if (targetIsMainFrame === false) {
        return
      }
      const targetUrl = String(event.url || url || '').trim()
      if (!loadPopupUrlInCurrentTab(targetUrl, 'window-open-placeholder')) {
        return
      }
      event.preventDefault()
      closePopup()
    }

    popupWindow.on('closed', cleanupPopup)
    popupWindow.webContents.on('will-navigate', handlePopupNavigation)
    popupWindow.webContents.on('did-start-navigation', handlePopupNavigation)
    closeTimer = setTimeout(closePopup, 15000)

    if (loadPopupUrlInCurrentTab(details.url, 'window-open-created')) {
      closePopup()
    }
  })

  return view
}

export function buildEmbeddedBrowserProbeResourceRecorder(
  tabId: string,
) {
  return (payload: Record<string, unknown>) => {
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
  }
}

export async function installEmbeddedBrowserResourceProbe(
  tabId: string,
  view: WebContentsView,
  isDeepCaptureEnabled: (tabId: string) => boolean,
) {
  if (!isDeepCaptureEnabled(tabId) || view.webContents.isDestroyed()) {
    return false
  }
  const probeScript = createEmbeddedBrowserResourceProbeScript()
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
    }
    const existingScriptId = embeddedBrowserProbeNewDocumentScriptIds.get(view.webContents)
    if (existingScriptId) {
      try {
        await view.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: existingScriptId,
        })
      } catch {
        // The previous script may belong to a detached or already reset debugger session.
      }
      embeddedBrowserProbeNewDocumentScriptIds.delete(view.webContents)
    }
    await view.webContents.debugger.sendCommand('Page.enable')
    const result = await view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: probeScript,
    }) as { identifier?: string }
    if (result.identifier) {
      embeddedBrowserProbeNewDocumentScriptIds.set(view.webContents, result.identifier)
    }
  } catch (error) {
    runtimeLogger.warn('embedded browser resource probe document-start install failed', {
      error: error instanceof Error ? error.message : String(error),
      tabId,
      url: view.webContents.getURL() || '',
    })
  }
  try {
    const mainFrame = view.webContents.mainFrame
    const frames = mainFrame
      ? [mainFrame, ...mainFrame.framesInSubtree.filter((frame) => frame !== mainFrame)]
      : []
    if (frames.length) {
      await Promise.all(frames.map(async (frame) => {
        try {
          await frame.executeJavaScript(probeScript, true)
        } catch {
          // Cross-origin or transient frames can disappear during injection.
        }
      }))
    } else {
      await view.webContents.executeJavaScript(probeScript, true)
    }
    return true
  } catch (error) {
    runtimeLogger.warn('embedded browser resource probe install failed', {
      error: error instanceof Error ? error.message : String(error),
      tabId,
      url: view.webContents.getURL() || '',
    })
    return false
  }
}

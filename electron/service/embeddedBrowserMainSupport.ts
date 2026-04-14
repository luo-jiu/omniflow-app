import { Buffer } from 'node:buffer'
import {
  BrowserWindow,
  dialog,
  session,
  type Session,
  WebContentsView,
} from 'electron'
import { runtimeLogger } from '../runtimeLogger'
import {
  EMBEDDED_BROWSER_PARTITION,
  initializeEmbeddedBrowserDownloadBridge,
  type EmbeddedBrowserDownloadPayload,
} from './embeddedBrowserService'
import {
  initializeEmbeddedBrowserResourceBridge,
  type EmbeddedBrowserCapturedResource,
} from './embeddedBrowserResourceService'
import type {
  EmbeddedBrowserFaviconResolvePayload,
  EmbeddedBrowserFaviconResolveResult,
  EmbeddedBrowserMainControllerOptions,
} from './embeddedBrowserMainTypes'

type ConfigureEmbeddedBrowserSessionOptions = {
  decisionCache: Map<string, boolean>
  options: EmbeddedBrowserMainControllerOptions
}

type InitializeEmbeddedBrowserMainBridgesOptions = {
  emitDownload: (payload: EmbeddedBrowserDownloadPayload) => void
  emitResource: (payload: EmbeddedBrowserCapturedResource) => void
  resolveTabIdByWebContents: (targetContents: Electron.WebContents) => string | null
  resolveTabIdByWebContentsId: (targetWebContentsId: number) => string | null
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

async function confirmEmbeddedBrowserFileSystemOrigin(
  options: ConfigureEmbeddedBrowserSessionOptions,
  origin: string,
) {
  const normalizedOrigin = resolveEmbeddedBrowserOrigin(origin)
  if (!normalizedOrigin) {
    return false
  }

  const cachedDecision = options.decisionCache.get(normalizedOrigin)
  if (typeof cachedDecision === 'boolean') {
    return cachedDecision
  }

  const focusedWindow = BrowserWindow.getFocusedWindow()
    ?? options.options.getMainWindow()
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
  options.decisionCache.set(normalizedOrigin, granted)
  return granted
}

async function resolveRestrictedPathAccessAction(
  options: EmbeddedBrowserMainControllerOptions,
  details: { origin: string; path: string },
) {
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

export function configureEmbeddedBrowserSession(
  options: ConfigureEmbeddedBrowserSessionOptions,
) {
  const browserSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION)

  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (!isEmbeddedBrowserFileSystemPermission(String(permission))) {
      callback(false)
      return
    }
    void confirmEmbeddedBrowserFileSystemOrigin(options, details.requestingUrl || '').then((granted) => {
      callback(granted)
    }).catch(() => {
      callback(false)
    })
  })

  browserSession.on('file-system-access-restricted', (event, details, callback) => {
    event.preventDefault()
    void resolveRestrictedPathAccessAction(options.options, details).then((action) => {
      callback(action)
    }).catch(() => {
      callback('deny')
    })
  })
}

export function initializeEmbeddedBrowserMainBridges(
  options: InitializeEmbeddedBrowserMainBridgesOptions,
) {
  initializeEmbeddedBrowserDownloadBridge({
    emitDownload: options.emitDownload,
    resolveTabIdByWebContents: options.resolveTabIdByWebContents,
  })
  initializeEmbeddedBrowserResourceBridge({
    browserSession: session.fromPartition(EMBEDDED_BROWSER_PARTITION),
    emitResource: options.emitResource,
    resolveTabIdByWebContentsId: options.resolveTabIdByWebContentsId,
  })
}

export async function collectEmbeddedBrowserDebugMeta(
  view: WebContentsView,
  enabled: boolean,
) {
  if (!enabled || view.webContents.isDestroyed()) {
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

export function loadEmbeddedBrowserFaviconDataUrl(view: WebContentsView, iconUrl: string) {
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

export async function resolveEmbeddedBrowserBookmarkFavicon(
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

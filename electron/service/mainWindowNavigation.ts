import type { WebContents } from 'electron'
import { normalizeWebUrl } from '../../src/shared/web-url'

function documentIdentity(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

/** Keep the trusted app document in the main window; web pages belong to browser tabs. */
export function installMainWindowNavigationGuard(contents: WebContents, appDocumentUrl: string): () => void {
  const trustedDocument = documentIdentity(appDocumentUrl)
  let disposed = false

  const requestWebUrl = (rawUrl: string) => {
    if (disposed || contents.isDestroyed()) return
    const url = normalizeWebUrl(rawUrl)
    if (url) contents.send('app:open-web-url', { url })
  }

  const guardNavigation = (event: { preventDefault(): void }, url: string) => {
    if (trustedDocument && documentIdentity(url) === trustedDocument) return
    event.preventDefault()
    requestWebUrl(url)
  }

  const guardRedirect = (event: { preventDefault(): void }, url: string, _isInPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame) guardNavigation(event, url)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    contents.removeListener('will-navigate', guardNavigation)
    contents.removeListener('will-redirect', guardRedirect)
    contents.removeListener('destroyed', dispose)
    if (!contents.isDestroyed()) contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', guardRedirect)
  contents.once('destroyed', dispose)
  contents.setWindowOpenHandler(({ url }) => {
    requestWebUrl(url)
    return { action: 'deny' }
  })
  return dispose
}

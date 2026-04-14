import { type WebContentsView } from 'electron'
import {
  cleanupEmbeddedBrowserOpenFile,
  injectEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'

export type EmbeddedBrowserPendingOpenFile = {
  fileName: string
  pageUrl: string
  stagedPath: string
}

type CleanupEmbeddedBrowserOpenFileForTabOptions = {
  attachedOpenFiles: Map<string, string>
  pendingOpenFiles: Map<string, EmbeddedBrowserPendingOpenFile>
  tabId: string
}

type BumpEmbeddedBrowserOpenFileRequestVersionOptions = {
  requestVersions: Map<string, number>
  tabId: string
}

type IsEmbeddedBrowserOpenFileRequestCurrentOptions = {
  requestVersions: Map<string, number>
  tabId: string
  version: number
}

type TryDispatchPendingEmbeddedBrowserOpenFileOptions = {
  attachedOpenFiles: Map<string, string>
  currentUrls: Map<string, string>
  pendingOpenFiles: Map<string, EmbeddedBrowserPendingOpenFile>
  tabId: string
  view: WebContentsView
}

export function cleanupEmbeddedBrowserOpenFileForTab(
  options: CleanupEmbeddedBrowserOpenFileForTabOptions,
) {
  const pending = options.pendingOpenFiles.get(options.tabId)
  if (pending?.stagedPath) {
    void cleanupEmbeddedBrowserOpenFile(pending.stagedPath).catch(() => undefined)
  }
  options.pendingOpenFiles.delete(options.tabId)

  const attachedPath = options.attachedOpenFiles.get(options.tabId)
  if (attachedPath) {
    void cleanupEmbeddedBrowserOpenFile(attachedPath).catch(() => undefined)
  }
  options.attachedOpenFiles.delete(options.tabId)
}

export function bumpEmbeddedBrowserOpenFileRequestVersion(
  options: BumpEmbeddedBrowserOpenFileRequestVersionOptions,
) {
  const nextVersion = (options.requestVersions.get(options.tabId) ?? 0) + 1
  options.requestVersions.set(options.tabId, nextVersion)
  return nextVersion
}

export function isEmbeddedBrowserOpenFileRequestCurrent(
  options: IsEmbeddedBrowserOpenFileRequestCurrentOptions,
) {
  return options.requestVersions.get(options.tabId) === options.version
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

export async function tryDispatchPendingEmbeddedBrowserOpenFile(
  options: TryDispatchPendingEmbeddedBrowserOpenFileOptions,
) {
  const pending = options.pendingOpenFiles.get(options.tabId)
  if (!pending || options.view.webContents.isDestroyed()) {
    return false
  }
  const currentUrl = options.view.webContents.getURL() || options.currentUrls.get(options.tabId) || ''
  if (!currentUrl) {
    return false
  }
  if (!matchesEmbeddedBrowserOpenFileTargetPage(currentUrl, pending.pageUrl)) {
    return false
  }

  try {
    const injected = await injectEmbeddedBrowserOpenFile(options.view, pending.stagedPath)
    if (!injected) {
      return false
    }
    const previousAttachedPath = options.attachedOpenFiles.get(options.tabId)
    if (previousAttachedPath && previousAttachedPath !== pending.stagedPath) {
      void cleanupEmbeddedBrowserOpenFile(previousAttachedPath).catch(() => undefined)
    }
    options.attachedOpenFiles.set(options.tabId, pending.stagedPath)
    options.pendingOpenFiles.delete(options.tabId)
    return true
  } catch {
    return false
  }
}

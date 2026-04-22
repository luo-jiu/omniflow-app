import { ipcMain } from 'electron'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserCapturedResourceMergePayload,
  EmbeddedBrowserCapturedResourceSavePayload,
  EmbeddedBrowserCapturedResourceTranscodePayload,
  EmbeddedBrowserFaviconResolvePayload,
  EmbeddedBrowserHlsDownloadPayload,
  EmbeddedBrowserMpdDownloadPayload,
} from './embeddedBrowserMainTypes'
import type {
  EmbeddedBrowserCookie,
  EmbeddedBrowserCookieFilter,
} from './embeddedBrowserCookieService'
import type { EmbeddedBrowserSavedPasswordEntry } from './embeddedBrowserPasswordTypes'
import type { EmbeddedBrowserCatchToolkitStatePayload } from './embeddedBrowserCatchToolkitPageBridge'
import type {
  EmbeddedBrowserExtractedResourcePayload,
  EmbeddedBrowserResourcePreviewPayload,
} from './embeddedBrowserResourcePageBridge'

type EmbeddedBrowserMainIpcHandlers = {
  activateTab: (sender: Electron.WebContents, tabId: string | null) => void | Promise<void>
  cleanupDownloadFile: (tempPath: string) => Promise<boolean>
  clearCapturedResources: (tabId: string) => unknown
  clearBrowserCache: (tabId: string) => Promise<boolean>
  clearCatchMediaCache: (tabId: string) => Promise<boolean>
  closeAll: (sender: Electron.WebContents) => void | Promise<void>
  closeTab: (sender: Electron.WebContents, tabId: string) => void | Promise<void>
  deactivate: (sender: Electron.WebContents) => void | Promise<void>
  downloadCatchMedia: (tabId: string) => Promise<boolean>
  downloadHlsManifest: (
    tabId: string,
    payload: EmbeddedBrowserHlsDownloadPayload,
  ) => Promise<unknown>
  downloadMpdManifest: (
    tabId: string,
    payload: EmbeddedBrowserMpdDownloadPayload,
  ) => Promise<unknown>
  exportResource: (tabId: string, resourceKey: string) => Promise<boolean>
  getCatchToolkitState: (tabId: string) => Promise<unknown>
  goBack: (tabId: string) => Promise<void>
  goForward: (tabId: string) => Promise<void>
  listCapturedResources: (tabId: string) => unknown
  mergeMseResources: (
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceMergePayload,
  ) => Promise<unknown>
  navigate: (sender: Electron.WebContents, tabId: string, url: string) => Promise<void>
  openMappedFile: (
    sender: Electron.WebContents,
    tabId: string,
    pageUrl: string,
    sourceUrl: string,
    fileName: string,
  ) => Promise<void>
  openResource: (tabId: string, resourceKey: string) => Promise<boolean>
  openTab: (sender: Electron.WebContents, tabId: string, url?: string) => Promise<void>
  previewResource: (tabId: string, payload: EmbeddedBrowserResourcePreviewPayload) => Promise<boolean>
  readResource: (tabId: string, resourceKey: string) => Promise<EmbeddedBrowserExtractedResourcePayload | null>
  reload: (tabId: string) => Promise<void>
  resetPageStorage: (tabId: string) => Promise<boolean>
  resolveFavicon: (payload: EmbeddedBrowserFaviconResolvePayload) => Promise<unknown>
  restartCatchMediaCapture: (tabId: string) => Promise<boolean>
  saveResource: (
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceSavePayload,
  ) => Promise<unknown>
  setBounds: (sender: Electron.WebContents, bounds: EmbeddedBrowserBounds) => void | Promise<void>
  startCapturedResources: (tabId: string) => unknown
  startDeepResourceCapture: (tabId: string) => Promise<unknown>
  stopCapturedResources: (tabId: string) => unknown
  transcodeResource: (
    tabId: string,
    payload: EmbeddedBrowserCapturedResourceTranscodePayload,
  ) => Promise<unknown>
  updateCatchToolkitState: (
    tabId: string,
    payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>,
  ) => Promise<unknown>
  getCookies: (filter?: EmbeddedBrowserCookieFilter) => Promise<EmbeddedBrowserCookie[]>
  removeCookie: (url: string, name: string) => Promise<void>
  removeCookiesByDomain: (domain: string) => Promise<void>
  removeAllCookies: () => Promise<void>
  listPasswords: () => EmbeddedBrowserSavedPasswordEntry[]
  getDecryptedPassword: (id: string) => Promise<string>
  saveCapturedCredential: (credentialRequestId: string) => Promise<EmbeddedBrowserSavedPasswordEntry>
  deletePassword: (id: string) => boolean
  deleteAllPasswords: () => void
  blacklistDomain: (domain: string) => void
  isBlacklistedDomain: (domain: string) => boolean
}

export function registerEmbeddedBrowserMainIpcHandlers(handlers: EmbeddedBrowserMainIpcHandlers) {
  ipcMain.handle('embedded-browser:open-tab', async (event, tabId: string, url?: string) => (
    handlers.openTab(event.sender, tabId, url)
  ))

  ipcMain.handle('embedded-browser:activate-tab', (event, tabId: string | null) => (
    handlers.activateTab(event.sender, tabId)
  ))

  ipcMain.handle('embedded-browser:navigate', async (event, tabId: string, url: string) => (
    handlers.navigate(event.sender, tabId, url)
  ))

  ipcMain.handle('embedded-browser:resolve-favicon', async (_event, payload: EmbeddedBrowserFaviconResolvePayload) => (
    handlers.resolveFavicon(payload)
  ))

  ipcMain.handle(
    'embedded-browser:open-mapped-file',
    async (event, tabId: string, pageUrl: string, sourceUrl: string, fileName: string) => (
      handlers.openMappedFile(event.sender, tabId, pageUrl, sourceUrl, fileName)
    ),
  )

  ipcMain.handle('embedded-browser:reload', async (_event, tabId: string) => handlers.reload(tabId))
  ipcMain.handle('embedded-browser:clear-cache-reload', async (_event, tabId: string) => handlers.clearBrowserCache(tabId))
  ipcMain.handle('embedded-browser:reset-page-storage', async (_event, tabId: string) => handlers.resetPageStorage(tabId))
  ipcMain.handle('embedded-browser:go-back', async (_event, tabId: string) => handlers.goBack(tabId))
  ipcMain.handle('embedded-browser:go-forward', async (_event, tabId: string) => handlers.goForward(tabId))

  ipcMain.handle('embedded-browser:resource:list', (_event, tabId: string) => handlers.listCapturedResources(tabId))
  ipcMain.handle('embedded-browser:resource:start', (_event, tabId: string) => handlers.startCapturedResources(tabId))
  ipcMain.handle('embedded-browser:resource:stop', (_event, tabId: string) => handlers.stopCapturedResources(tabId))
  ipcMain.handle('embedded-browser:resource:clear', (_event, tabId: string) => handlers.clearCapturedResources(tabId))

  ipcMain.handle('embedded-browser:resource:open', async (_event, tabId: string, resourceKey: string) => (
    handlers.openResource(tabId, resourceKey)
  ))
  ipcMain.handle('embedded-browser:resource:export', async (_event, tabId: string, resourceKey: string) => (
    handlers.exportResource(tabId, resourceKey)
  ))
  ipcMain.handle('embedded-browser:resource:read', async (_event, tabId: string, resourceKey: string) => (
    handlers.readResource(tabId, resourceKey)
  ))
  ipcMain.handle(
    'embedded-browser:resource:preview',
    async (_event, tabId: string, payload: EmbeddedBrowserResourcePreviewPayload) => (
      handlers.previewResource(tabId, payload)
    ),
  )
  ipcMain.handle('embedded-browser:resource:catch-toolkit:get-state', async (_event, tabId: string) => (
    handlers.getCatchToolkitState(tabId)
  ))
  ipcMain.handle(
    'embedded-browser:resource:catch-toolkit:update-state',
    async (_event, tabId: string, payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>) => (
      handlers.updateCatchToolkitState(tabId, payload)
    ),
  )
  ipcMain.handle('embedded-browser:resource:catch-toolkit:clear-cache', async (_event, tabId: string) => (
    handlers.clearCatchMediaCache(tabId)
  ))
  ipcMain.handle('embedded-browser:resource:catch-toolkit:download', async (_event, tabId: string) => (
    handlers.downloadCatchMedia(tabId)
  ))
  ipcMain.handle('embedded-browser:resource:catch-toolkit:restart', async (_event, tabId: string) => (
    handlers.restartCatchMediaCapture(tabId)
  ))
  ipcMain.handle(
    'embedded-browser:resource:merge-mse',
    async (_event, tabId: string, payload: EmbeddedBrowserCapturedResourceMergePayload) => (
      handlers.mergeMseResources(tabId, payload)
    ),
  )
  ipcMain.handle(
    'embedded-browser:resource:save',
    async (_event, tabId: string, payload: EmbeddedBrowserCapturedResourceSavePayload) => (
      handlers.saveResource(tabId, payload)
    ),
  )
  ipcMain.handle(
    'embedded-browser:resource:transcode',
    async (_event, tabId: string, payload: EmbeddedBrowserCapturedResourceTranscodePayload) => (
      handlers.transcodeResource(tabId, payload)
    ),
  )
  ipcMain.handle(
    'embedded-browser:resource:download-hls',
    async (_event, tabId: string, payload: EmbeddedBrowserHlsDownloadPayload) => (
      handlers.downloadHlsManifest(tabId, payload)
    ),
  )
  ipcMain.handle(
    'embedded-browser:resource:download-mpd',
    async (_event, tabId: string, payload: EmbeddedBrowserMpdDownloadPayload) => (
      handlers.downloadMpdManifest(tabId, payload)
    ),
  )
  ipcMain.handle('embedded-browser:resource:start-deep-capture', async (_event, tabId: string) => (
    handlers.startDeepResourceCapture(tabId)
  ))
  ipcMain.handle('embedded-browser:set-bounds', (event, bounds: EmbeddedBrowserBounds) => (
    handlers.setBounds(event.sender, bounds)
  ))
  ipcMain.handle('embedded-browser:close-tab', (event, tabId: string) => (
    handlers.closeTab(event.sender, tabId)
  ))
  ipcMain.handle('embedded-browser:cleanup-download-file', async (_event, tempPath: string) => (
    handlers.cleanupDownloadFile(tempPath)
  ))
  ipcMain.handle('embedded-browser:deactivate', (event) => handlers.deactivate(event.sender))
  ipcMain.handle('embedded-browser:close-all', (event) => handlers.closeAll(event.sender))

  ipcMain.handle('embedded-browser:cookie:get', async (_event, filter?: EmbeddedBrowserCookieFilter) => (
    handlers.getCookies(filter)
  ))
  ipcMain.handle('embedded-browser:cookie:remove', async (_event, url: string, name: string) => (
    handlers.removeCookie(url, name)
  ))
  ipcMain.handle('embedded-browser:cookie:remove-domain', async (_event, domain: string) => (
    handlers.removeCookiesByDomain(domain)
  ))
  ipcMain.handle('embedded-browser:cookie:remove-all', async () => (
    handlers.removeAllCookies()
  ))

  ipcMain.handle('embedded-browser:password:list', () => (
    handlers.listPasswords()
  ))
  ipcMain.handle('embedded-browser:password:get-decrypted', async (_event, id: string) => (
    handlers.getDecryptedPassword(id)
  ))
  ipcMain.handle('embedded-browser:password:save-captured', async (_event, credentialRequestId: string) => (
    handlers.saveCapturedCredential(credentialRequestId)
  ))
  ipcMain.handle('embedded-browser:password:delete', (_event, id: string) => (
    handlers.deletePassword(id)
  ))
  ipcMain.handle('embedded-browser:password:delete-all', () => (
    handlers.deleteAllPasswords()
  ))
  ipcMain.handle('embedded-browser:password:blacklist-domain', (_event, domain: string) => (
    handlers.blacklistDomain(domain)
  ))
  ipcMain.handle('embedded-browser:password:is-blacklisted', (_event, domain: string) => (
    handlers.isBlacklistedDomain(domain)
  ))
}

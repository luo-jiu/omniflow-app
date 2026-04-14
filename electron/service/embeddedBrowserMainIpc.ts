import { ipcMain } from 'electron'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserCapturedResourceMergePayload,
  EmbeddedBrowserFaviconResolvePayload,
} from './embeddedBrowserMainTypes'
import type { EmbeddedBrowserCatchToolkitStatePayload } from './embeddedBrowserCatchToolkitPageBridge'
import type { EmbeddedBrowserResourcePreviewPayload } from './embeddedBrowserResourcePageBridge'

type EmbeddedBrowserMainIpcHandlers = {
  activateTab: (sender: Electron.WebContents, tabId: string | null) => void | Promise<void>
  cleanupDownloadFile: (tempPath: string) => Promise<boolean>
  clearCapturedResources: (tabId: string) => unknown
  clearCatchMediaCache: (tabId: string) => Promise<boolean>
  closeAll: (sender: Electron.WebContents) => void | Promise<void>
  closeTab: (sender: Electron.WebContents, tabId: string) => void | Promise<void>
  deactivate: (sender: Electron.WebContents) => void | Promise<void>
  downloadCatchMedia: (tabId: string) => Promise<boolean>
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
  reload: (tabId: string) => Promise<void>
  resolveFavicon: (payload: EmbeddedBrowserFaviconResolvePayload) => Promise<unknown>
  restartCatchMediaCapture: (tabId: string) => Promise<boolean>
  setBounds: (sender: Electron.WebContents, bounds: EmbeddedBrowserBounds) => void | Promise<void>
  startCapturedResources: (tabId: string) => unknown
  startDeepResourceCapture: (tabId: string) => Promise<unknown>
  stopCapturedResources: (tabId: string) => unknown
  updateCatchToolkitState: (
    tabId: string,
    payload: Partial<EmbeddedBrowserCatchToolkitStatePayload>,
  ) => Promise<unknown>
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
}

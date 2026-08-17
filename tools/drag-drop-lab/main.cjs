const { app, BrowserWindow, WebContentsView, ipcMain, nativeImage, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const LAB_ROOT = __dirname
const HOST_PAGE_PATH = path.join(LAB_ROOT, 'host.html')
const PAGE_PATH = path.join(LAB_ROOT, 'page.html')
const SAMPLE_TEXT_PATH = path.join(LAB_ROOT, 'fixtures', 'sample.txt')
const SAMPLE_JSON_PATH = path.join(LAB_ROOT, 'fixtures', 'sample.json')
const DRAG_ICON_PATH = path.join(LAB_ROOT, '..', '..', 'build', 'icons', 'icon.png')
const SMOKE_MODE = process.argv.includes('--smoke')
const SPLIT_RATIO = 0.5

let mainWindow = null
let embeddedView = null
let navigateOnDragDrop = false
let downloadUrl = ''
let downloadServer = null

async function startDownloadServer() {
  const fixture = fs.readFileSync(SAMPLE_TEXT_PATH)
  const token = crypto.randomUUID()
  downloadServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    const expectedPath = `/download/${token}/omniflow-download-url-sample.txt`
    if ((request.method !== 'GET' && request.method !== 'HEAD') || requestUrl.pathname !== expectedPath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="omniflow-download-url-sample.txt"',
      'Content-Length': fixture.byteLength,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : fixture)
  })
  await new Promise((resolve, reject) => {
    downloadServer.once('error', reject)
    downloadServer.listen(0, '127.0.0.1', resolve)
  })
  const address = downloadServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('drag lab download server did not expose a TCP port')
  }
  downloadUrl = `http://127.0.0.1:${address.port}/download/${token}/omniflow-download-url-sample.txt`
}

function createDragIcon() {
  return nativeImage.createFromPath(DRAG_ICON_PATH).resize({ width: 24, height: 24 })
}

function emitBrowserEvent(type, detail = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('drag-drop-lab:browser-event', {
    at: new Date().toISOString(),
    detail,
    type,
  })
}

function syncEmbeddedViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || !embeddedView) return
  const [width, height] = mainWindow.getContentSize()
  const splitX = Math.max(360, Math.round(width * SPLIT_RATIO))
  embeddedView.setBounds({
    x: splitX,
    y: 0,
    width: Math.max(0, width - splitX),
    height: Math.max(0, height),
  })
}

function destroyEmbeddedView() {
  if (!embeddedView) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.removeChildView(embeddedView)
  }
  if (!embeddedView.webContents.isDestroyed()) {
    embeddedView.webContents.close({ waitForBeforeUnload: false })
  }
  embeddedView = null
}

function createEmbeddedView() {
  destroyEmbeddedView()
  embeddedView = new WebContentsView({
    webPreferences: {
      devTools: true,
      navigateOnDragDrop,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.contentView.addChildView(embeddedView)
  syncEmbeddedViewBounds()

  embeddedView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  embeddedView.webContents.on('did-finish-load', () => {
    emitBrowserEvent('did-finish-load', {
      navigateOnDragDrop,
      url: embeddedView?.webContents.getURL() || '',
    })
  })
  embeddedView.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    emitBrowserEvent('did-fail-load', {
      code,
      description,
      url: validatedURL,
    })
  })
  embeddedView.webContents.on('will-navigate', (_event, url) => {
    emitBrowserEvent('will-navigate', { url })
  })
  void embeddedView.webContents.loadFile(PAGE_PATH)
}

function registerIpc() {
  ipcMain.handle('drag-drop-lab:get-environment', () => ({
    electron: process.versions.electron,
    navigateOnDragDrop,
    platform: process.platform,
    downloadUrl,
    sampleFiles: [path.basename(SAMPLE_TEXT_PATH), path.basename(SAMPLE_JSON_PATH)],
  }))

  ipcMain.handle('drag-drop-lab:set-navigate-on-drop', (_event, enabled) => {
    navigateOnDragDrop = Boolean(enabled)
    createEmbeddedView()
    return { navigateOnDragDrop }
  })

  ipcMain.handle('drag-drop-lab:reset-page', () => {
    createEmbeddedView()
    return true
  })

  ipcMain.handle('drag-drop-lab:reveal-fixture', () => {
    shell.showItemInFolder(SAMPLE_TEXT_PATH)
    return true
  })

  ipcMain.on('drag-drop-lab:start-native-drag', (event) => {
    event.sender.startDrag({
      file: SAMPLE_TEXT_PATH,
      files: [SAMPLE_TEXT_PATH, SAMPLE_JSON_PATH],
      icon: createDragIcon(),
    })
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 920,
    minHeight: 560,
    show: !SMOKE_MODE,
    title: 'OmniFlow Drag & Drop Lab',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(LAB_ROOT, 'preload.cjs'),
      sandbox: false,
    },
  })

  mainWindow.on('resize', syncEmbeddedViewBounds)
  mainWindow.on('closed', () => {
    destroyEmbeddedView()
    mainWindow = null
  })

  await mainWindow.loadFile(HOST_PAGE_PATH)
  createEmbeddedView()

  if (SMOKE_MODE) {
    const hostReady = mainWindow.webContents.getURL().startsWith('file:')
    const dragIconReady = !createDragIcon().isEmpty()
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('embedded page smoke timeout')), 10_000)
      embeddedView.webContents.once('did-finish-load', () => {
        clearTimeout(timeoutId)
        resolve()
      })
      embeddedView.webContents.once('did-fail-load', (_event, code, description) => {
        clearTimeout(timeoutId)
        reject(new Error(`embedded page failed: ${code} ${description}`))
      })
    })
    const hostChecks = await mainWindow.webContents.executeJavaScript(`({
      bridgeReady: typeof window.dragDropLab?.startNativeDrag === 'function',
      downloadUrlReady: document.querySelector('#download-url-card')?.dataset.ready === 'true',
      dropZoneReady: Boolean(document.querySelector('#drop-zone')),
      sourceCount: document.querySelectorAll('[draggable="true"]').length,
    })`)
    const embeddedChecks = await embeddedView.webContents.executeJavaScript(`({
      blobReady: String(document.querySelector('#blob-source')?.href || '').startsWith('blob:'),
      dropZoneReady: Boolean(document.querySelector('#drop-zone')),
      sourceCount: document.querySelectorAll('[draggable="true"]').length,
    })`)
    const checksPassed = (
      dragIconReady
      && hostReady
      && hostChecks.bridgeReady
      && hostChecks.downloadUrlReady
      && hostChecks.dropZoneReady
      && hostChecks.sourceCount === 3
      && embeddedChecks.blobReady
      && embeddedChecks.dropZoneReady
      && embeddedChecks.sourceCount === 4
    )
    if (!checksPassed) {
      throw new Error(`drag lab smoke checks failed: ${JSON.stringify({ embeddedChecks, hostChecks })}`)
    }
    process.stdout.write(`${JSON.stringify({
      embeddedChecks,
      embeddedUrl: embeddedView.webContents.getURL(),
      dragIconReady,
      hostChecks,
      hostReady,
      navigateOnDragDrop,
      platform: process.platform,
      status: 'ok',
    })}\n`)
    app.quit()
  }
}

app.whenReady().then(async () => {
  await startDownloadServer()
  registerIpc()
  await createWindow()
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  downloadServer?.close()
  downloadServer = null
})

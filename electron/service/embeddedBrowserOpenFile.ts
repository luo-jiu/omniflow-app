import { app, type WebContentsView } from 'electron'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { downloadUrlToFile } from './fileTransfer'
import { normalizeDownloadFileName } from '../../src/features/file-transfer/model/download-file-name'
import {
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_ACCEPTANCE_KEY,
  EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID,
} from './embeddedBrowserLibraryFileDropScript'

const EMBEDDED_BROWSER_OPEN_FILE_DIRNAME = 'embedded-browser-open-files'
export const EMBEDDED_BROWSER_LIBRARY_FILE_DROP_MAX_BYTES = 1024 * 1024 * 1024
const EMBEDDED_BROWSER_OPEN_FILE_STALE_MS = 24 * 60 * 60 * 1000
const FALLBACK_FILE_INPUT_SELECTOR = 'input[data-omniflow-browser-open-fallback="true"]'

function getEmbeddedBrowserOpenFileRoot() {
  return path.join(app.getPath('userData'), EMBEDDED_BROWSER_OPEN_FILE_DIRNAME)
}

function ensureEmbeddedBrowserOpenFileRoot() {
  const root = getEmbeddedBrowserOpenFileRoot()
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }
  return root
}

function buildStagedFileName(fileName: string) {
  return normalizeDownloadFileName(fileName)
}

function isPathInsideDirectory(filePath: string, directoryPath: string) {
  const resolvedFilePath = path.resolve(filePath)
  const resolvedDirectoryPath = path.resolve(directoryPath)
  if (resolvedFilePath === resolvedDirectoryPath) return true
  return resolvedFilePath.startsWith(`${resolvedDirectoryPath}${path.sep}`)
}

async function ensureInputSelector(view: WebContentsView): Promise<string | null> {
  const selector = await view.webContents.executeJavaScript(`
    (() => {
      const existingInput = document.querySelector('input[type="file"]:not([disabled])')
      if (existingInput instanceof HTMLInputElement) {
        existingInput.setAttribute('data-omniflow-browser-open-target', 'true')
        return 'input[data-omniflow-browser-open-target="true"]'
      }

      let fallback = document.querySelector('${FALLBACK_FILE_INPUT_SELECTOR}')
      if (!(fallback instanceof HTMLInputElement)) {
        fallback = document.createElement('input')
        fallback.type = 'file'
        fallback.multiple = false
        fallback.setAttribute('data-omniflow-browser-open-fallback', 'true')
        fallback.style.position = 'fixed'
        fallback.style.left = '-9999px'
        fallback.style.top = '-9999px'
        fallback.style.width = '1px'
        fallback.style.height = '1px'
        fallback.style.opacity = '0'
        fallback.style.pointerEvents = 'none'
        document.body.appendChild(fallback)
      }
      return '${FALLBACK_FILE_INPUT_SELECTOR}'
    })()
  `, true)

  return typeof selector === 'string' && selector.trim() ? selector.trim() : null
}

async function setFileInputFiles(view: WebContentsView, selector: string, filePaths: string[]): Promise<boolean> {
  if (!selector || filePaths.length === 0) {
    return false
  }

  await ensureDebuggerAttached(view)

  const documentNode = await view.webContents.debugger.sendCommand('DOM.getDocument', {
    depth: 1,
  })
  const nodeID = Number(documentNode?.root?.nodeId || 0)
  if (!Number.isFinite(nodeID) || nodeID <= 0) {
    return false
  }

  const queryResult = await view.webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: nodeID,
    selector,
  })
  const inputNodeID = Number(queryResult?.nodeId || 0)
  if (!Number.isFinite(inputNodeID) || inputNodeID <= 0) {
    return false
  }

  await view.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
    nodeId: inputNodeID,
    files: filePaths,
  })
  return true
}

async function dispatchFileToPage(view: WebContentsView, selector: string): Promise<boolean> {
  const result = await view.webContents.executeJavaScript(`
    (() => {
      const inputSelector = ${JSON.stringify(selector)}
      const input = document.querySelector(inputSelector)
      if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
        return { ok: false }
      }

      const dataTransfer = new DataTransfer()
      Array.from(input.files).forEach((file) => dataTransfer.items.add(file))

      const centerX = Math.max(1, Math.floor(window.innerWidth / 2))
      const centerY = Math.max(1, Math.floor(window.innerHeight / 2))
      const centerTarget = document.elementFromPoint(centerX, centerY)

      const candidates = []
      const pushCandidate = (candidate) => {
        if (!(candidate instanceof Element)) {
          return
        }
        if (candidates.includes(candidate)) {
          return
        }
        candidates.push(candidate)
      }

      pushCandidate(input)
      pushCandidate(input.closest('label'))
      pushCandidate(centerTarget)
      pushCandidate(document.querySelector('[data-testid*="drop"], [class*="drop"], [class*="upload"], [data-upload], main, [role="main"]'))
      pushCandidate(document.body)
      pushCandidate(document.documentElement)

      candidates.forEach((target) => {
        ['dragenter', 'dragover', 'drop'].forEach((eventType) => {
          const event = new DragEvent(eventType, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
          target.dispatchEvent(event)
        })
      })

      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))

      return {
        ok: true,
        candidateCount: candidates.length,
      }
    })()
  `, true)

  return Boolean(result?.ok)
}

export async function stageEmbeddedBrowserOpenFile(
  sourceUrl: string,
  fileName: string,
  headers: Record<string, string> = {},
  options: {
    maxBytes?: number
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const openFileRoot = ensureEmbeddedBrowserOpenFileRoot()
  const stagingDirectory = await fs.mkdtemp(path.join(openFileRoot, 'file-'))
  const stagedPath = path.join(stagingDirectory, buildStagedFileName(fileName))
  try {
    await downloadUrlToFile(
      sourceUrl,
      stagedPath,
      headers,
      0,
      options.maxBytes ?? Number.POSITIVE_INFINITY,
      options.signal,
    )
    return stagedPath
  } catch (error) {
    await fs.rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

export async function cleanupStaleEmbeddedBrowserOpenFiles(now = Date.now()): Promise<number> {
  const openFileRoot = getEmbeddedBrowserOpenFileRoot()
  const entries = await fs.readdir(openFileRoot, { withFileTypes: true }).catch(() => [])
  let cleanupCount = 0
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(openFileRoot, entry.name)
    const entryStat = await fs.stat(entryPath).catch(() => null)
    if (!entryStat || now - entryStat.mtimeMs < EMBEDDED_BROWSER_OPEN_FILE_STALE_MS) return
    await fs.rm(entryPath, { force: true, recursive: entry.isDirectory() }).catch(() => undefined)
    cleanupCount += 1
  }))
  return cleanupCount
}

export async function cleanupEmbeddedBrowserOpenFile(stagedPath?: string): Promise<boolean> {
  const normalizedPath = path.resolve(String(stagedPath || '').trim())
  if (!normalizedPath) {
    return false
  }

  const openFileRoot = path.resolve(getEmbeddedBrowserOpenFileRoot())
  if (!isPathInsideDirectory(normalizedPath, openFileRoot)) {
    return false
  }

  const parentDirectory = path.dirname(normalizedPath)
  const parentName = path.basename(parentDirectory)
  if (path.dirname(parentDirectory) === openFileRoot && parentName.startsWith('file-')) {
    await fs.rm(parentDirectory, { force: true, recursive: true })
    return true
  }

  await fs.rm(normalizedPath, { force: true })
  return true
}

export function cleanupEmbeddedBrowserOpenFileSync(stagedPath?: string): boolean {
  const normalizedPath = path.resolve(String(stagedPath || '').trim())
  if (!normalizedPath) return false
  const openFileRoot = path.resolve(getEmbeddedBrowserOpenFileRoot())
  if (!isPathInsideDirectory(normalizedPath, openFileRoot)) return false

  const parentDirectory = path.dirname(normalizedPath)
  const parentName = path.basename(parentDirectory)
  if (path.dirname(parentDirectory) === openFileRoot && parentName.startsWith('file-')) {
    rmSync(parentDirectory, { force: true, recursive: true })
    return true
  }
  rmSync(normalizedPath, { force: true })
  return true
}

async function ensureDebuggerAttached(view: WebContentsView) {
  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
    }
  } catch (error) {
    if (!String(error).includes('Already attached')) {
      throw error
    }
  }
}

async function setEmbeddedBrowserFileDropAcceptance(
  view: WebContentsView,
  value: boolean,
): Promise<void> {
  const script = `(() => { window[${JSON.stringify(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_ACCEPTANCE_KEY)}] = ${value}; return true })()`
  await view.webContents.executeJavaScriptInIsolatedWorld(
    EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID,
    [{ code: script }],
    true,
  )
}

async function didEmbeddedBrowserAcceptFileDrop(view: WebContentsView): Promise<boolean> {
  const script = `Boolean(window[${JSON.stringify(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_ACCEPTANCE_KEY)}])`
  return Boolean(
    await view.webContents.executeJavaScriptInIsolatedWorld(
      EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID,
      [{ code: script }],
      true,
    ).catch(() => false),
  )
}

export async function dispatchEmbeddedBrowserFileDrop(
  view: WebContentsView,
  stagedPath: string,
  point: { x: number; y: number },
): Promise<boolean> {
  if (!view || view.webContents.isDestroyed()) {
    return false
  }
  await ensureDebuggerAttached(view)
  const bounds = view.getBounds()
  const x = Math.max(0, Math.min(Math.round(Number(point.x) || 0), Math.max(0, bounds.width - 1)))
  const y = Math.max(0, Math.min(Math.round(Number(point.y) || 0), Math.max(0, bounds.height - 1)))
  const data = {
    dragOperationsMask: 1,
    files: [stagedPath],
    items: [],
  }

  let dragEntered = false
  try {
    await setEmbeddedBrowserFileDropAcceptance(view, false)
    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      data,
      type: 'dragEnter',
      x,
      y,
    })
    dragEntered = true
    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      data,
      type: 'dragOver',
      x,
      y,
    })
    if (!await didEmbeddedBrowserAcceptFileDrop(view)) {
      await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        data,
        type: 'dragCancel',
        x,
        y,
      })
      return false
    }
    await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
      data,
      type: 'drop',
      x,
      y,
    })
    return true
  } catch (error) {
    if (dragEntered && !view.webContents.isDestroyed()) {
      await view.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
        data,
        type: 'dragCancel',
        x,
        y,
      }).catch(() => undefined)
    }
    throw error
  }
}

export async function injectEmbeddedBrowserOpenFile(
  view: WebContentsView,
  stagedPath: string,
): Promise<boolean> {
  if (!view || view.webContents.isDestroyed()) {
    return false
  }
  const selector = await ensureInputSelector(view)
  if (!selector) {
    return false
  }
  const filesSet = await setFileInputFiles(view, selector, [stagedPath])
  if (!filesSet) {
    return false
  }
  return dispatchFileToPage(view, selector)
}

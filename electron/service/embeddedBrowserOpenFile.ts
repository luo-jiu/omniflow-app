import { app, type WebContentsView } from 'electron'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { downloadUrlToFile } from './fileTransfer'

const EMBEDDED_BROWSER_OPEN_FILE_DIRNAME = 'embedded-browser-open-files'
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
  const safeName = String(fileName || 'file')
    .replace(/[/\\]/g, '_')
    .trim() || 'file'
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
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

  try {
    if (!view.webContents.debugger.isAttached()) {
      view.webContents.debugger.attach('1.3')
    }
  } catch (error) {
    if (!String(error).includes('Already attached')) {
      throw error
    }
  }

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
): Promise<string> {
  const openFileRoot = ensureEmbeddedBrowserOpenFileRoot()
  const stagedPath = path.join(openFileRoot, buildStagedFileName(fileName))
  await downloadUrlToFile(sourceUrl, stagedPath, headers)
  return stagedPath
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

  await fs.rm(normalizedPath, { force: true })
  return true
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

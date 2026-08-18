import http from 'node:http'
import { readFile, rm, stat, utimes } from 'node:fs/promises'
import path from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const { testUserDataRoot } = vi.hoisted(() => ({
  testUserDataRoot: `${String(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp')
    .replace(/[\\/]$/, '')}/omniflow-browser-open-file-test-${process.pid}`,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataRoot,
  },
}))

import {
  cleanupEmbeddedBrowserOpenFile,
  cleanupStaleEmbeddedBrowserOpenFiles,
  dispatchEmbeddedBrowserFileDrop,
  stageEmbeddedBrowserOpenFile,
} from './embeddedBrowserOpenFile'

const sourceServers: http.Server[] = []

async function createSourceServer(body: string): Promise<string> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'application/octet-stream',
    })
    response.end(body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  sourceServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('source server missing port')
  return `http://127.0.0.1:${address.port}/source`
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(async () => {
  await Promise.all(sourceServers.splice(0).map(closeServer))
  await rm(testUserDataRoot, { recursive: true, force: true })
})

afterAll(async () => {
  await rm(testUserDataRoot, { recursive: true, force: true })
})

describe('embeddedBrowserOpenFile', () => {
  it('preserves the original file name inside an isolated staging directory', async () => {
    const sourceUrl = await createSourceServer('audio-fixture')
    const stagedPath = await stageEmbeddedBrowserOpenFile(sourceUrl, 'song.mp3')
    const stagingDirectory = path.dirname(stagedPath)

    expect(path.basename(stagedPath)).toBe('song.mp3')
    expect(path.basename(stagingDirectory)).toMatch(/^file-/)
    expect(await readFile(stagedPath, 'utf8')).toBe('audio-fixture')

    await expect(cleanupEmbeddedBrowserOpenFile(stagedPath)).resolves.toBe(true)
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('only applies a size limit when the caller requests one', async () => {
    const sourceUrl = await createSourceServer('larger-than-four-bytes')

    await expect(stageEmbeddedBrowserOpenFile(
      sourceUrl,
      'limited.bin',
      {},
      { maxBytes: 4 },
    )).rejects.toThrow('大小上限')

    const stagedPath = await stageEmbeddedBrowserOpenFile(sourceUrl, 'unlimited.bin')
    await expect(readFile(stagedPath, 'utf8')).resolves.toBe('larger-than-four-bytes')
  })

  it('removes staging entries left stale by an earlier process', async () => {
    const sourceUrl = await createSourceServer('stale')
    const stagedPath = await stageEmbeddedBrowserOpenFile(sourceUrl, 'stale.bin')
    const stagingDirectory = path.dirname(stagedPath)
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(stagingDirectory, staleDate, staleDate)

    await expect(cleanupStaleEmbeddedBrowserOpenFiles()).resolves.toBe(1)
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('dispatches a native file drop sequence at a clamped page coordinate', async () => {
    const sendCommand = vi.fn().mockResolvedValue({})
    const attach = vi.fn()
    const executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue(true)
    const view = {
      getBounds: () => ({ height: 600, width: 800, x: 0, y: 0 }),
      webContents: {
        executeJavaScriptInIsolatedWorld,
        debugger: {
          attach,
          isAttached: () => false,
          sendCommand,
        },
        mainFrame: {
          framesInSubtree: [],
        },
        isDestroyed: () => false,
      },
    } as unknown as Electron.WebContentsView

    await expect(dispatchEmbeddedBrowserFileDrop(
      view,
      '/tmp/song.mp3',
      { x: 999, y: -20 },
    )).resolves.toBe(true)

    expect(attach).toHaveBeenCalledWith('1.3')
    expect(sendCommand.mock.calls.map((call) => call[1].type)).toEqual([
      'dragEnter',
      'dragOver',
      'drop',
    ])
    expect(sendCommand.mock.calls[0][1]).toMatchObject({
      data: {
        dragOperationsMask: 1,
        files: ['/tmp/song.mp3'],
        items: [],
      },
      x: 799,
      y: 0,
    })
  })

  it('cancels the native drag when the page does not accept file dragover', async () => {
    const sendCommand = vi.fn().mockResolvedValue({})
    const view = {
      getBounds: () => ({ height: 600, width: 800, x: 0, y: 0 }),
      webContents: {
        executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(false),
        debugger: {
          attach: vi.fn(),
          isAttached: () => true,
          sendCommand,
        },
        mainFrame: {
          framesInSubtree: [],
        },
        isDestroyed: () => false,
      },
    } as unknown as Electron.WebContentsView

    await expect(dispatchEmbeddedBrowserFileDrop(
      view,
      '/tmp/song.mp3',
      { x: 100, y: 120 },
    )).resolves.toBe(false)
    expect(sendCommand.mock.calls.map((call) => call[1].type)).toEqual([
      'dragEnter',
      'dragOver',
      'dragCancel',
    ])
  })
})

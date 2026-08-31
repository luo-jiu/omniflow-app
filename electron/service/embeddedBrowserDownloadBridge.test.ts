import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { defaultSession, partitionSession, testUserDataRoot } = vi.hoisted(() => ({
  defaultSession: { on: vi.fn() },
  partitionSession: { on: vi.fn() },
  testUserDataRoot: `${String(process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp')
    .replace(/[\\/]$/, '')}/omniflow-download-bridge-test-${process.pid}`,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataRoot,
  },
  session: {
    defaultSession,
    fromPartition: () => partitionSession,
  },
}))

import {
  initializeEmbeddedBrowserDownloadBridge,
} from './embeddedBrowserService'
import { defaultProcessingTaskRegistry } from './embedded-browser/processing/task-registry'

type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'failed'

function createDownloadItem() {
  const listeners = new Map<string, (_event: unknown, state: string) => void>()
  let savePath = ''
  const item = {
    cancel: vi.fn(() => {
      listeners.get('done')?.({}, 'cancelled')
    }),
    getFilename: () => 'capture.mp4',
    getMimeType: () => 'video/mp4',
    getReceivedBytes: () => 7,
    getTotalBytes: () => 7,
    getURL: () => 'https://media.example/capture.mp4',
    on: vi.fn((event: 'updated', listener: (_event: unknown, state: string) => void) => {
      listeners.set(event, listener)
    }),
    once: vi.fn((event: 'done', listener: (_event: unknown, state: string) => void) => {
      listeners.set(event, listener)
    }),
    setSavePath: vi.fn((nextPath: string) => {
      savePath = nextPath
    }),
  }
  return {
    emitDone: (state: DownloadState) => listeners.get('done')?.({}, state),
    emitUpdated: (state: 'progressing') => listeners.get('updated')?.({}, state),
    getSavePath: () => savePath,
    item,
  }
}

afterEach(async () => {
  await defaultProcessingTaskRegistry.cancel({ all: true })
  defaultSession.on.mockClear()
  partitionSession.on.mockClear()
  await rm(testUserDataRoot, { force: true, recursive: true })
})

describe('embedded browser native download bridge', () => {
  it('wires will-download through the native session and registry terminal paths', async () => {
    const emitDownload = vi.fn()
    const resolveTabIdByWebContents = vi.fn(() => 'tab-bridge')
    initializeEmbeddedBrowserDownloadBridge({ emitDownload, resolveTabIdByWebContents })

    expect(defaultSession.on).toHaveBeenCalledWith('will-download', expect.any(Function))
    expect(partitionSession.on).toHaveBeenCalledWith('will-download', expect.any(Function))
    const handleWillDownload = defaultSession.on.mock.calls[0]?.[1] as (
      event: unknown,
      item: ReturnType<typeof createDownloadItem>['item'],
      webContents: { getURL: () => string },
    ) => void
    const webContents = { getURL: () => 'https://media.example/watch' }

    const completed = createDownloadItem()
    handleWillDownload({}, completed.item, webContents)
    expect(resolveTabIdByWebContents).toHaveBeenCalledWith(webContents)
    expect(completed.getSavePath()).toContain(path.join(testUserDataRoot, 'embedded-browser-downloads'))
    expect(defaultProcessingTaskRegistry.getSnapshot()).toMatchObject([{
      kind: 'native-download',
      tabId: 'tab-bridge',
    }])
    expect(emitDownload).toHaveBeenCalledWith(expect.objectContaining({ state: 'started', tabId: 'tab-bridge' }))

    completed.emitUpdated('progressing')
    expect(emitDownload).toHaveBeenCalledWith(expect.objectContaining({ state: 'progress', tabId: 'tab-bridge' }))
    completed.emitDone('completed')
    await Promise.resolve()
    expect(emitDownload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'capture.mp4',
      receivedBytes: 7,
      state: 'completed',
      totalBytes: 7,
      url: 'https://media.example/capture.mp4',
    }))
    expect(defaultProcessingTaskRegistry.getSnapshot()).toEqual([])

    const cancelled = createDownloadItem()
    handleWillDownload({}, cancelled.item, webContents)
    await mkdir(path.dirname(cancelled.getSavePath()), { recursive: true })
    await writeFile(cancelled.getSavePath(), 'partial')
    await expect(defaultProcessingTaskRegistry.cancel({ tabId: 'tab-bridge' })).resolves.toBe(1)
    expect(cancelled.item.cancel).toHaveBeenCalledOnce()
    await expect(readFile(cancelled.getSavePath())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(emitDownload).toHaveBeenCalledWith(expect.objectContaining({ state: 'cancelled', tabId: 'tab-bridge' }))
    expect(defaultProcessingTaskRegistry.getSnapshot()).toEqual([])
  })
})

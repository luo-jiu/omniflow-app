import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  createMseDownloadStagingPath,
  emitMseDownloadCompleted,
  stageMseDownloadResource,
  type MseDownloadOutputResource,
} from './mse-download-output'

describe('MSE download output', () => {
  it('mse.auto-download-output', async () => {
    const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-output-'))
    const events: Array<Record<string, unknown>> = []
    try {
      const filePath = await createMseDownloadStagingPath({
        fileName: '../episode:01.mp4',
        stagingRootPath,
      })
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, Buffer.from([1, 2, 3]))

      const payload = await emitMseDownloadCompleted({
        emitDownload: (event) => {
          events.push(event)
        },
        fileName: 'episode:01.mp4',
        filePath,
        mimeType: 'video/mp4',
        pageUrl: 'https://page.example/watch',
        resourceKey: 'mse-stream:video',
        streamType: 'video',
        tabId: 'tab-output',
      })

      expect(payload).toMatchObject({
        fileName: 'episode_01.mp4',
        mimeType: 'video/mp4',
        pageUrl: 'https://page.example/watch',
        receivedBytes: 3,
        state: 'completed',
        tabId: 'tab-output',
        tempPath: filePath,
        totalBytes: 3,
        url: 'mse://mse-stream:video',
      })
      expect(events).toEqual([payload])
      await expect(readFile(filePath)).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally {
      await rm(stagingRootPath, { force: true, recursive: true })
    }
  })

  it('rejects an empty staging root before creating files', async () => {
    await expect(createMseDownloadStagingPath({
      fileName: 'media.mp4',
      stagingRootPath: '',
    })).rejects.toThrow('无效的下载暂存目录')
  })

  it('does not require a directory per staged file', async () => {
    const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-output-'))
    try {
      const filePath = await createMseDownloadStagingPath({
        fileName: 'media.mp4',
        stagingRootPath,
      })
      expect(path.dirname(filePath)).toBe(stagingRootPath)
      await expect(access(stagingRootPath)).resolves.toBeUndefined()
    } finally {
      await rm(stagingRootPath, { force: true, recursive: true })
    }
  })

  it('cleans a staged file when the completion event fails', async () => {
    const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-output-'))
    const filePath = path.join(stagingRootPath, 'failed.mp4')
    try {
      await expect(stageMseDownloadResource({
        emitCompleted: async () => {
          throw new Error('renderer unavailable')
        },
        filePath,
        resource: {
          fileName: 'failed.mp4',
          resourceKey: 'mse-stream:failed',
        },
        writeResourceToFile: async (_resource, targetPath) => {
          await writeFile(targetPath, 'partial')
        },
      })).rejects.toThrow('renderer unavailable')
      await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(stagingRootPath, { force: true, recursive: true })
    }
  })

  it('treats an unavailable renderer event sink as a delivery failure', async () => {
    const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-output-'))
    const filePath = path.join(stagingRootPath, 'undelivered.mp4')
    try {
      await writeFile(filePath, 'partial')
      await expect(emitMseDownloadCompleted({
        emitDownload: () => false,
        fileName: 'undelivered.mp4',
        filePath,
        resourceKey: 'mse-stream:undelivered',
        tabId: 'tab-undelivered',
      })).rejects.toThrow('could not be delivered')
    } finally {
      await rm(stagingRootPath, { force: true, recursive: true })
    }
  })

  it('does not write or retain output after cancellation', async () => {
    const stagingRootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-mse-output-'))
    const filePath = path.join(stagingRootPath, 'cancelled.mp4')
    const controller = new AbortController()
    controller.abort()
    const writeResourceToFile = vi.fn(async (_resource: MseDownloadOutputResource, targetPath: string) => {
      await writeFile(targetPath, 'unexpected')
    })
    try {
      await expect(stageMseDownloadResource({
        emitCompleted: vi.fn(),
        filePath,
        resource: {
          fileName: 'cancelled.mp4',
          resourceKey: 'mse-stream:cancelled',
        },
        signal: controller.signal,
        writeResourceToFile,
      })).rejects.toMatchObject({ name: 'AbortError' })
      expect(writeResourceToFile).not.toHaveBeenCalled()
      await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(stagingRootPath, { force: true, recursive: true })
    }
  })
})

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createMseDownloadStagingPath,
  emitMseDownloadCompleted,
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
        emitDownload: (event) => events.push(event),
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
})

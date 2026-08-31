import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DownloadHandoffStore,
  type DownloadHandoffPayload,
} from './download-handoff-store'

function completedDownload(tempPath: string, downloadId = 'download-1'): DownloadHandoffPayload {
  return {
    downloadId,
    fileName: 'video.mp4',
    receivedBytes: 4,
    state: 'completed',
    tempPath,
    totalBytes: 4,
    url: 'https://media.example/video.mp4',
  }
}

describe('DownloadHandoffStore', () => {
  it('download-handoff.replays completed outputs and acknowledges them', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-download-handoff-'))
    const stagingRootPath = path.join(rootPath, 'staging')
    const journalPath = path.join(rootPath, 'handoff.json')
    const filePath = path.join(stagingRootPath, 'video.mp4')
    try {
      await mkdir(stagingRootPath, { recursive: true })
      await writeFile(filePath, 'media', 'utf8')
      const store = new DownloadHandoffStore({ journalPath, stagingRootPath, now: () => 10_000 })
      expect(store.record(completedDownload(filePath))).toBe(true)
      await store.flush()

      const restarted = new DownloadHandoffStore({ journalPath, stagingRootPath, now: () => 10_001 })
      await expect(restarted.list()).resolves.toEqual([completedDownload(filePath)])
      await expect(restarted.acknowledge('download-1')).resolves.toBe(true)
      await expect(restarted.list()).resolves.toEqual([])
      await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('download-handoff.rejects unsafe or non-completed payloads', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-download-handoff-'))
    const stagingRootPath = path.join(rootPath, 'staging')
    const journalPath = path.join(rootPath, 'handoff.json')
    try {
      const store = new DownloadHandoffStore({ journalPath, stagingRootPath })
      expect(store.record({ ...completedDownload(path.join(stagingRootPath, 'outside.mp4')), state: 'progress' })).toBe(false)
      expect(store.record(completedDownload(path.join(rootPath, 'outside.mp4'), 'outside'))).toBe(false)
      await expect(store.list()).resolves.toEqual([])
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('download-handoff.removes missing and expired records during replay', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-download-handoff-'))
    const stagingRootPath = path.join(rootPath, 'staging')
    const journalPath = path.join(rootPath, 'handoff.json')
    const cleanup = vi.fn(async () => undefined)
    try {
      const store = new DownloadHandoffStore({
        cleanup,
        journalPath,
        maxAgeMs: 100,
        now: () => 10_000,
        stagingRootPath,
      })
      expect(store.record(completedDownload(path.join(stagingRootPath, 'missing.mp4')))).toBe(true)
      await store.flush()
      const restarted = new DownloadHandoffStore({
        cleanup,
        journalPath,
        maxAgeMs: 100,
        now: () => 10_200,
        stagingRootPath,
      })
      await expect(restarted.list()).resolves.toEqual([])
      expect(cleanup).toHaveBeenCalledWith(path.join(stagingRootPath, 'missing.mp4'))
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('download-handoff.prunes expired records during startup before renderer replay', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-download-handoff-'))
    const stagingRootPath = path.join(rootPath, 'staging')
    const journalPath = path.join(rootPath, 'handoff.json')
    const filePath = path.join(stagingRootPath, 'expired.mp4')
    const cleanup = vi.fn(async () => undefined)
    try {
      await mkdir(stagingRootPath, { recursive: true })
      await writeFile(filePath, 'media', 'utf8')
      const store = new DownloadHandoffStore({
        journalPath,
        maxAgeMs: 100,
        now: () => 10_000,
        stagingRootPath,
      })
      expect(store.record(completedDownload(filePath, 'expired'))).toBe(true)
      await store.flush()

      const restarted = new DownloadHandoffStore({
        cleanup,
        journalPath,
        maxAgeMs: 100,
        now: () => 10_200,
        stagingRootPath,
      })
      await restarted.ensureReady()

      expect(cleanup).toHaveBeenCalledWith(filePath)
      await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(restarted.list()).resolves.toEqual([])
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })
})

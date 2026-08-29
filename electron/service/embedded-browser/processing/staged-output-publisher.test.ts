import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { StagedOutputLeaseStore } from './staged-output-lease'
import { publishStagedOutput } from './staged-output-publisher'

describe('staged output publisher', () => {
  it('publishes a claimed lease without exposing the staging path', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-output-publisher-'))
    const targetDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-output-target-'))
    const store = new StagedOutputLeaseStore({ rootPath, ttlMs: 100 })
    const targetPath = path.join(targetDirectory, 'episode.mp4')
    try {
      const result = await publishStagedOutput({
        fileName: 'episode.mp4',
        mimeType: 'video/mp4',
        ownerTaskId: 'processing-task-1',
        purpose: 'direct-file-download',
        store,
        targetPath,
        write: async (stagedPath) => {
          await writeFile(stagedPath, 'payload')
        },
      })

      expect(result).toEqual({
        leaseId: expect.stringMatching(/^output-lease-/),
        outputPath: targetPath,
      })
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('payload')
      expect(store.getSnapshot()).toEqual([])
    } finally {
      await rm(rootPath, { force: true, recursive: true })
      await rm(targetDirectory, { force: true, recursive: true })
    }
  })

  it('releases the lease and keeps the previous target when processing fails', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'omniflow-output-publisher-'))
    const targetDirectory = await mkdtemp(path.join(os.tmpdir(), 'omniflow-output-target-'))
    const store = new StagedOutputLeaseStore({ rootPath })
    const targetPath = path.join(targetDirectory, 'episode.mp4')
    await writeFile(targetPath, 'previous')
    try {
      await expect(publishStagedOutput({
        ownerTaskId: 'processing-task-1',
        purpose: 'direct-file-download',
        store,
        targetPath,
        write: async (stagedPath) => {
          await writeFile(stagedPath, 'partial')
          throw new Error('processing failed')
        },
      })).rejects.toThrow('processing failed')
      await expect(readFile(targetPath, 'utf8')).resolves.toBe('previous')
      expect(store.getSnapshot()).toEqual([])
    } finally {
      await rm(rootPath, { force: true, recursive: true })
      await rm(targetDirectory, { force: true, recursive: true })
    }
  })
})
